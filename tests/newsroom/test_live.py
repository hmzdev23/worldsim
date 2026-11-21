"""NEWS-005 (#51): live WORLD//WIRE for any run, from its released snapshot."""

import copy
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "services" / "newsroom"))
sys.path.insert(0, str(ROOT / "services" / "director"))

from worlddirector import build_batch  # noqa: E402
from worlddirector.director import MAX_FIXTURE_EVENTS  # noqa: E402
from worldwire import WireFeed, derive_news, news_response  # noqa: E402
from worldwire.wire import DEK_MAX, HEADLINE_MAX  # noqa: E402

try:
    sys.path.insert(0, str(ROOT / "services" / "simulation"))
    from worldsim_sim import Simulation
except Exception:  # pragma: no cover - simulation deps (jsonschema, fastapi) missing
    Simulation = None

# #54 moves this Director fixture from tests/director/fixtures/ to services/director/fixtures/.
ICELAND_RAW = next(
    path
    for path in (
        ROOT / "services" / "director" / "fixtures" / "iceland-eruption.json",
        ROOT / "tests" / "director" / "fixtures" / "iceland-eruption.json",
    )
    if path.exists()
)
JAPAN = ROOT / "contracts" / "fixtures" / "japan-earthquake.json"
ITEM_FIELDS = {"id", "event_id", "event_type", "severity", "label", "headline", "dek",
               "sim_time_minutes", "sequence", "sim_time_label", "focus", "provenance"}


def iceland(simulation_id="run-iceland"):
    raw = json.loads(ICELAND_RAW.read_text(encoding="utf-8"))
    batch = build_batch(raw, simulation_id=simulation_id, source="fixture", max_events=MAX_FIXTURE_EVENTS)
    batch["events"] = [{**e, "status": "applied"} for e in batch["events"]]
    return batch


def japan():
    return json.loads(JAPAN.read_text(encoding="utf-8"))


def snapshot(batch, minutes):
    """A snapshot message as Simulation.snapshot() builds it: the released prefix only."""
    return {
        "schema_version": "0.1", "simulation_id": batch["simulation_id"], "branch_id": batch["branch_id"],
        "sim_time_minutes": minutes, "kind": "snapshot", "playback": {"state": "paused", "speed": 1},
        "events": [copy.deepcopy(e) for e in batch["events"] if e["sim_time_minutes"] <= minutes],
    }


def event_msg(batch, event):
    return {"schema_version": "0.1", "simulation_id": batch["simulation_id"], "branch_id": batch["branch_id"],
            "sim_time_minutes": event["sim_time_minutes"], "kind": "event", "event": copy.deepcopy(event)}


class NewsResponseTests(unittest.TestCase):
    def setUp(self):
        self.batch = iceland()
        self.end = self.batch["events"][-1]["sim_time_minutes"]

    def test_envelope_names_the_run_and_keeps_the_item_shape(self):
        body = news_response(snapshot(self.batch, self.end))
        self.assertEqual(set(body), {"schema_version", "simulation_id", "branch_id", "sim_time_minutes", "items"})
        self.assertEqual((body["simulation_id"], body["branch_id"]), ("run-iceland", "main"))
        self.assertEqual(body["sim_time_minutes"], self.end)
        self.assertEqual(len(body["items"]), len(self.batch["events"]))
        for item in body["items"]:
            self.assertEqual(set(item), ITEM_FIELDS)
            event = next(e for e in self.batch["events"] if e["id"] == item["event_id"])
            self.assertEqual(item["focus"]["lat"], event["location"]["lat"])
            self.assertEqual(item["focus"]["lon"], event["location"]["lon"])
            self.assertEqual(item["severity"], event["severity"])

    def test_future_events_are_withheld_even_if_passed_in(self):
        first = self.batch["events"][0]["sim_time_minutes"]
        self.assertEqual(news_response(snapshot(self.batch, first - 1))["items"], [])
        timeline_view = {**snapshot(self.batch, first), "events": self.batch["events"], "end_minutes": self.end}
        body = news_response(timeline_view)
        self.assertEqual([i["event_id"] for i in body["items"]], [self.batch["events"][0]["id"]])

    def test_unapplied_events_are_withheld(self):
        snap = snapshot(self.batch, self.end)
        snap["events"][1]["status"] = "rejected"
        snap["events"][2]["status"] = "proposed"
        ids = {i["event_id"] for i in news_response(snap)["items"]}
        self.assertNotIn(snap["events"][1]["id"], ids)
        self.assertNotIn(snap["events"][2]["id"], ids)

    def test_a_story_is_the_same_live_and_in_the_archive(self):
        archive = {i["event_id"]: i for i in news_response(snapshot(self.batch, self.end))["items"]}
        for event in self.batch["events"]:
            live = news_response(snapshot(self.batch, event["sim_time_minutes"]))["items"][0]
            self.assertEqual(live, archive[event["id"]], "the alert shows the newest item")

    def test_seek_and_replay_give_the_same_stories(self):
        middle = self.batch["events"][3]["sim_time_minutes"]
        forward = news_response(snapshot(self.batch, middle))
        news_response(snapshot(self.batch, self.end))
        self.assertEqual(news_response(snapshot(self.batch, 0))["items"], [])
        self.assertEqual(news_response(snapshot(self.batch, middle)), forward)

    def test_runs_that_reuse_event_ids_never_mix(self):
        japan_batch, iceland_batch = japan(), self.batch
        self.assertEqual(japan_batch["events"][0]["id"], iceland_batch["events"][0]["id"])
        jp = news_response(snapshot(japan_batch, 10_000))
        ic = news_response(snapshot(iceland_batch, 10_000))
        self.assertEqual(jp["simulation_id"], japan_batch["simulation_id"])
        self.assertNotEqual(jp["items"][-1]["headline"], ic["items"][-1]["headline"])
        self.assertEqual(news_response(snapshot(iceland_batch, 10_000)), ic, "no state carried between calls")
        self.assertNotIn("Japan", " ".join(i["headline"] + i["dek"] for i in ic["items"]))

    def test_iceland_copy_is_alert_ready(self):
        items = news_response(snapshot(self.batch, self.end))["items"]
        headlines = [i["headline"] for i in items]
        self.assertEqual(len(set(headlines)), len(headlines))
        for item in items:
            self.assertLessEqual(len(item["headline"]), HEADLINE_MAX)
            self.assertLessEqual(len(item["dek"]), DEK_MAX)
        text = {i["event_id"]: i["headline"] for i in items}
        self.assertEqual(text["evt-0001"], "Volcano erupts near Reykjanes Peninsula, Iceland (VEI 4)")
        self.assertTrue(text["evt-0006"].startswith("Norway sends 40 personnel, 25 tonnes of aid"))

    def test_unfamiliar_events_get_clear_generic_copy(self):
        snap = snapshot(self.batch, self.end)
        snap["events"][2].update(type="other_hazard", payload={"label": "solar superstorm"})
        snap["events"][3].update(type="space_weather", payload={})
        items = {i["event_id"]: i for i in news_response(snap)["items"]}
        self.assertEqual(items[snap["events"][2]["id"]]["headline"],
                         "Solar superstorm reported in Svartsengi Power Station, Iceland")
        self.assertEqual(items[snap["events"][3]["id"]]["headline"], "Space weather reported in Keflavik, Iceland")
        self.assertTrue(items[snap["events"][3]["id"]]["dek"].startswith("Simulated"))

    def test_rejects_a_snapshot_without_run_identity_or_time(self):
        for key in ("simulation_id", "branch_id", "sim_time_minutes"):
            snap = snapshot(self.batch, 0)
            del snap[key]
            with self.assertRaises(ValueError):
                news_response(snap)
        for bad in (-1, 1.5, True, "10"):
            with self.assertRaises(ValueError):
                news_response({**snapshot(self.batch, 0), "sim_time_minutes": bad})


class WireFeedRunTests(unittest.TestCase):
    def test_events_from_another_run_are_ignored(self):
        ic, jp = iceland(), japan()
        feed = WireFeed()
        feed.apply(snapshot(ic, 0))
        self.assertTrue(feed.apply(event_msg(ic, ic["events"][0])))
        self.assertFalse(feed.apply(event_msg(jp, jp["events"][1])), "same id space, different run")
        self.assertEqual([i["event_id"] for i in feed.items], [ic["events"][0]["id"]])
        other_branch = {**event_msg(ic, ic["events"][1]), "branch_id": "fork-1"}
        self.assertFalse(feed.apply(other_branch))

    def test_snapshot_from_a_new_run_starts_over(self):
        ic, jp = iceland(), japan()
        feed = WireFeed()
        for event in ic["events"]:
            feed.apply(event_msg(ic, event))
        feed.apply(snapshot(jp, 0))
        self.assertEqual(feed.items, [])
        feed.apply(event_msg(jp, jp["events"][0]))
        self.assertEqual(feed.items[0]["headline"], "M7.8 earthquake strikes off the coast of Miyagi, Japan")


@unittest.skipIf(Simulation is None, "pip install -r services/simulation/requirements.txt for engine checks")
class EngineSnapshotTests(unittest.TestCase):
    """The adapter on the real engine's snapshots, as Anthony's route will call it."""

    def setUp(self):
        self.batch = iceland()
        self.sim = Simulation.from_batch(self.batch, state="paused")

    def test_news_follows_the_engine_through_play_seek_and_replay(self):
        self.assertEqual(news_response(self.sim.snapshot())["items"], [])
        self.sim.play()
        self.sim.advance(self.sim.end_minutes + 10)
        end = news_response(self.sim.snapshot())
        self.assertEqual(len(end["items"]), len(self.batch["events"]))
        self.assertEqual(end["items"], derive_news(self.sim.timeline))

        middle = self.batch["events"][4]["sim_time_minutes"]
        seeked = news_response(self.sim.seek(middle))
        self.assertEqual({i["event_id"] for i in seeked["items"]},
                         {e["id"] for e in self.batch["events"] if e["sim_time_minutes"] <= middle})
        archive = {i["event_id"]: i for i in end["items"]}
        for item in seeked["items"]:
            self.assertEqual(item, archive[item["event_id"]])
        self.assertEqual(news_response(self.sim.seek(0))["items"], [])

    def test_timeline_view_never_leaks_future_stories(self):
        middle = self.batch["events"][2]["sim_time_minutes"]
        self.sim.seek(middle)
        view = self.sim.timeline_view()
        self.assertEqual(len(view["events"]), len(self.batch["events"]))
        self.assertEqual(news_response(view), news_response(self.sim.snapshot()))

    def test_two_engine_runs_stay_separate(self):
        other = Simulation.from_batch(iceland("run-iceland-2"), state="paused")
        self.sim.seek(self.sim.end_minutes)
        first, second = news_response(self.sim.snapshot()), news_response(other.snapshot())
        self.assertEqual(second["simulation_id"], "run-iceland-2")
        self.assertEqual(second["items"], [])
        self.assertEqual(len(first["items"]), len(self.batch["events"]))


if __name__ == "__main__":
    unittest.main()
