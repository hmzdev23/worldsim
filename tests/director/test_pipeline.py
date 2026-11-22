"""Director output through everyone else's code.

Director (fixture) -> stand-in simulation marks events applied ->
tests/integration/mock_stream (SIM-001 stand-in) -> stream contract ->
WORLD//WIRE news cards with map focus. Schema checks need jsonschema.
"""

import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "services" / "director"))
sys.path.insert(0, str(ROOT / "services" / "newsroom"))
sys.path.insert(0, str(ROOT / "tests" / "integration"))

import mock_stream  # noqa: E402
from worlddirector import generate  # noqa: E402
from worldwire import SIMULATED_LABEL, news_from_stream  # noqa: E402

try:
    from jsonschema import Draft202012Validator
    from referencing import Registry, Resource
except ImportError:  # pragma: no cover
    Draft202012Validator = None


def apply_all(batch):
    """What the simulation will do once it accepts the Director's proposals."""
    return {**batch, "events": [{**e, "status": "applied"} for e in batch["events"]]}


class DirectorPipelineTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.batch = generate(fixture="japan-earthquake")
        cls.messages = list(mock_stream.replay(apply_all(cls.batch), speed=4))

    @unittest.skipIf(Draft202012Validator is None, "pip install jsonschema for schema checks")
    def test_director_batch_and_stream_match_contracts(self):
        schemas = [json.loads((ROOT / "contracts" / n).read_text()) for n in ("events.schema.json", "stream.schema.json")]
        registry = Registry().with_resources((s["$id"], Resource.from_contents(s)) for s in schemas)
        events_v = Draft202012Validator(schemas[0], registry=registry)
        stream_v = Draft202012Validator(schemas[1], registry=registry)
        self.assertEqual([e.message for e in events_v.iter_errors(self.batch)], [])
        for msg in self.messages:
            self.assertEqual([e.message for e in stream_v.iter_errors(msg)], [], msg["kind"])

    @unittest.skipIf(Draft202012Validator is None, "pip install jsonschema for schema checks")
    def test_new_hazard_types_validate_and_get_headlines(self):
        from worlddirector import build_batch, load_fixture

        base = load_fixture("japan-earthquake")["events"][0]
        details = {
            "disease_outbreak": {"pathogen": "novel influenza", "radius_km": 400},
            "nuclear_detonation": {"yield_kt": 15, "origin": "unknown"},
            "volcanic_eruption": {"vei": 6, "location": {**base["location"], "name": "Zao", "lat": 38.14, "lon": 140.44}},
            "meteor_impact": {"diameter_m": 150},
            "cyber_attack": {"target": "power grid"},
            "alien_contact": {},
            "other_hazard": {"label": "solar superstorm"},
        }
        events = []
        for i, (kind, extra) in enumerate(details.items()):
            ev = {**base, "type": kind, "sim_time_minutes": i * 60, "magnitude": None, "depth_km": None, "caused_by": []}
            ev.update(extra)
            events.append(ev)
        batch = build_batch({"events": events}, simulation_id="new-types")
        schema = json.loads((ROOT / "contracts" / "events.schema.json").read_text())
        self.assertEqual([e.message for e in Draft202012Validator(schema).iter_errors(batch)], [])
        feed = news_from_stream(mock_stream.replay(apply_all(batch)))
        self.assertEqual(len(feed), len(details))
        for item in feed:
            self.assertNotIn("Details are developing", item["dek"])

    def test_proposed_events_never_reach_the_wire(self):
        raw = list(mock_stream.replay(self.batch))
        self.assertEqual(news_from_stream(raw), [])

    def test_every_event_becomes_a_specific_news_card_with_focus(self):
        feed = news_from_stream(self.messages)
        by_event = {item["event_id"]: item for item in feed}
        self.assertEqual(set(by_event), {e["id"] for e in self.batch["events"]})
        for event in self.batch["events"]:
            card = by_event[event["id"]]
            self.assertEqual(card["label"], SIMULATED_LABEL)
            self.assertNotIn("Details are developing", card["dek"], event["type"])  # no generic fallback
            self.assertEqual((card["focus"]["lat"], card["focus"]["lon"]), (event["location"]["lat"], event["location"]["lon"]))

    def test_aid_headline_names_origin(self):
        feed = news_from_stream(self.messages)
        aid = next(i for i in feed if i["event_id"] == "evt-0010")
        self.assertIn("United States", aid["headline"])
        self.assertIn("180 personnel", aid["headline"])
        self.assertIn("60 tonnes of aid", aid["headline"])


if __name__ == "__main__":
    unittest.main()
