"""DIR-004: a non-Japan scenario runs through the same pipeline as the demo.

tests/director/fixtures/iceland-eruption.json is a raw Director response for a
fictional Reykjanes eruption (Iceland, with knock-on effects in the UK and aid
from Norway and Denmark). It goes through the real Director validator, the
simulation engine, and WORLD//WIRE with nothing Japan-specific involved.
Test-only: it is not a demo fixture and does not touch the canonical one.
"""

import copy
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FIXTURE = Path(__file__).resolve().parent / "fixtures" / "iceland-eruption.json"
sys.path.insert(0, str(ROOT / "services" / "director"))
sys.path.insert(0, str(ROOT / "services" / "newsroom"))
sys.path.insert(0, str(ROOT / "tests" / "integration"))

import mock_stream  # noqa: E402
from worlddirector import DirectorError, build_batch  # noqa: E402
from worlddirector.contract import IMPACT_BASIS, IMPACT_FIELDS  # noqa: E402
from worlddirector.director import MAX_FIXTURE_EVENTS  # noqa: E402
from worldwire import SIMULATED_LABEL, news_from_stream  # noqa: E402

try:
    from jsonschema import Draft202012Validator
except ImportError:  # pragma: no cover
    Draft202012Validator = None

try:
    sys.path.insert(0, str(ROOT / "services" / "simulation"))
    from worldsim_sim import Simulation
    from worldsim_sim.engine import replay as engine_replay
except Exception:  # pragma: no cover - simulation deps (jsonschema, fastapi) missing
    Simulation = None

SIM_ID = "test-iceland-eruption"
CUMULATIVE = [k for k, (_, _, cumulative) in IMPACT_FIELDS.items() if cumulative]


def raw():
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


def build(data=None):
    return build_batch(data or raw(), simulation_id=SIM_ID, source="fixture", max_events=MAX_FIXTURE_EVENTS)


def applied(batch):
    return {**batch, "events": [{**e, "status": "applied"} for e in batch["events"]]}


class NonJapanBatchTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.batch = build()
        cls.events = cls.batch["events"]

    def test_nothing_in_the_scenario_is_japanese(self):
        text = json.dumps(self.batch).lower()
        self.assertNotIn("japan", text)
        self.assertNotIn("jpn", text)
        self.assertEqual({e["location"]["country_code"] for e in self.events}, {"ISL", "GBR"})

    def test_generic_event_types_and_visuals(self):
        self.assertEqual(self.events[0]["type"], "volcanic_eruption")
        self.assertEqual(self.events[0]["visual"], "ash_plume")
        self.assertEqual(self.events[0]["payload"]["vei"], 4)
        self.assertFalse({"earthquake", "aftershock", "tsunami_warning"} & {e["type"] for e in self.events})
        self.assertEqual(
            {e["type"] for e in self.events},
            {"volcanic_eruption", "evacuation", "infrastructure_failure", "contamination",
             "economic_shock", "international_aid", "recovery"},
        )

    def test_canonical_order_and_ids(self):
        keys = [(e["sim_time_minutes"], e["sequence"]) for e in self.events]
        self.assertEqual(keys, sorted(keys))
        self.assertEqual(len(set(keys)), len(keys))
        self.assertEqual([e["id"] for e in self.events], [f"evt-{i:04d}" for i in range(1, len(self.events) + 1)])
        self.assertTrue(all(e["status"] == "proposed" and e["provenance"] == {"source": "fixture"} for e in self.events))

    def test_parent_links_resolve_to_earlier_events(self):
        at = {e["id"]: e["sim_time_minutes"] for e in self.events}
        self.assertEqual(self.events[0]["parent_ids"], [])
        for ev in self.events[1:]:
            self.assertTrue(ev["parent_ids"], ev["id"])
            for parent in ev["parent_ids"]:
                self.assertIn(parent, at)
                self.assertLessEqual(at[parent], ev["sim_time_minutes"])
        self.assertEqual(self.events[-1]["parent_ids"], ["evt-0003", "evt-0005", "evt-0006", "evt-0007"])

    def test_impact_snapshots_are_cumulative(self):
        for ev in self.events:
            self.assertEqual(ev["payload"]["impacts"]["basis"], IMPACT_BASIS)
            self.assertNotIn(None, ev["payload"]["impacts"].values())  # nulls are dropped, not sent
        for prev, cur in zip(self.events, self.events[1:]):
            a, b = prev["payload"]["impacts"], cur["payload"]["impacts"]
            for key in CUMULATIVE:
                if key in a and key in b:
                    self.assertGreaterEqual(b[key], a[key], f"{cur['id']} {key}")
            before = {c["country"]: c for c in a.get("aid_contributors", [])}
            after = {c["country"]: c for c in b.get("aid_contributors", [])}
            self.assertLessEqual(set(before), set(after), cur["id"])
            for country, c in before.items():
                self.assertGreaterEqual(after[country]["personnel"], c["personnel"])
                self.assertGreaterEqual(after[country]["cargo_tonnes"], c["cargo_tonnes"])
        final = self.events[-1]["payload"]["impacts"]
        self.assertEqual([c["country"] for c in final["aid_contributors"]], ["Norway", "Denmark"])
        self.assertLessEqual(final["sheltered"], final["displaced"])

    def test_falling_running_total_is_rejected(self):
        data = raw()
        data["events"][-1]["impacts"]["economic_loss_usd"] = 1
        with self.assertRaises(DirectorError) as ctx:
            build(data)
        self.assertEqual(ctx.exception.code, "invalid_events")
        self.assertIn("economic_loss_usd", ctx.exception.detail)

    def test_dropped_aid_country_is_rejected(self):
        data = copy.deepcopy(raw())
        data["events"][-1]["impacts"]["aid_contributors"] = data["events"][-1]["impacts"]["aid_contributors"][:1]
        with self.assertRaises(DirectorError) as ctx:
            build(data)
        self.assertIn("Denmark", ctx.exception.detail)

    @unittest.skipIf(Draft202012Validator is None, "pip install jsonschema for schema checks")
    def test_validates_against_contract(self):
        schema = json.loads((ROOT / "contracts" / "events.schema.json").read_text(encoding="utf-8"))
        validator = Draft202012Validator(schema)
        for batch in (self.batch, applied(self.batch)):
            self.assertEqual([e.message for e in validator.iter_errors(batch)], [])


class NonJapanNewsroomTest(unittest.TestCase):
    def test_every_event_gets_a_specific_wire_card(self):
        batch = build()
        feed = news_from_stream(mock_stream.replay(applied(batch)))
        by_event = {item["event_id"]: item for item in feed}
        self.assertEqual(set(by_event), {e["id"] for e in batch["events"]})
        for ev in batch["events"]:
            card = by_event[ev["id"]]
            self.assertEqual(card["label"], SIMULATED_LABEL)
            self.assertNotIn("Details are developing", card["dek"], ev["type"])
            self.assertEqual((card["focus"]["lat"], card["focus"]["lon"]), (ev["location"]["lat"], ev["location"]["lon"]))
        self.assertTrue(by_event["evt-0001"]["headline"].startswith("Volcano erupts near Reykjanes Peninsula"))
        self.assertIn("Norway", by_event["evt-0006"]["headline"])
        self.assertIn("Denmark", by_event["evt-0007"]["headline"])
        self.assertNotIn("japan", json.dumps(feed).lower())


@unittest.skipIf(Simulation is None, "needs services/simulation and its requirements")
class NonJapanSimulationTest(unittest.TestCase):
    def test_engine_applies_every_event_in_order(self):
        batch = build()
        sim = Simulation(simulation_id=SIM_ID, branch_id="main")
        _, rejected = sim.ingest(batch)
        self.assertEqual(rejected, [])
        while sim.now < batch["events"][-1]["sim_time_minutes"]:
            sim.advance(60)
        snap = sim.snapshot()
        self.assertEqual([e["id"] for e in snap["events"]], [e["id"] for e in batch["events"]])
        self.assertTrue(all(e["status"] == "applied" for e in snap["events"]))

    def test_engine_stream_feeds_the_newsroom(self):
        batch = build()
        feed = news_from_stream(engine_replay(batch, step_minutes=60))
        self.assertEqual(len(feed), len(batch["events"]))
        self.assertEqual(feed[0]["event_id"], batch["events"][-1]["id"])  # newest first


if __name__ == "__main__":
    unittest.main()
