"""NEWS-003 (#28): WORLD//WIRE follows each applied event and reports impact estimates."""

import copy
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "services" / "newsroom"))

from worldwire import WireFeed, derive_news, news_for_event, news_from_stream  # noqa: E402
from worldwire.impacts import fmt_count, fmt_usd, read_impacts  # noqa: E402

try:
    from jsonschema import Draft202012Validator
except ImportError:  # pragma: no cover
    Draft202012Validator = None

CHAIN = ROOT / "tests" / "newsroom" / "fixtures" / "impact-chain.json"
HEADER = {"schema_version": "0.1", "simulation_id": "newsroom-impact-chain", "branch_id": "main"}


def chain():
    return copy.deepcopy(json.loads(CHAIN.read_text(encoding="utf-8")))


def event_msg(event):
    return {**HEADER, "kind": "event", "sim_time_minutes": event["sim_time_minutes"], "event": event}


def snapshot_msg(minutes, events):
    return {**HEADER, "kind": "snapshot", "sim_time_minutes": minutes,
            "playback": {"state": "paused", "speed": 1}, "events": events}


class ChainFixtureTests(unittest.TestCase):
    @unittest.skipIf(Draft202012Validator is None, "pip install jsonschema for schema checks")
    def test_fixture_matches_event_contract(self):
        schema = json.loads((ROOT / "contracts" / "events.schema.json").read_text(encoding="utf-8"))
        errors = [e.message for e in Draft202012Validator(schema).iter_errors(chain())]
        self.assertEqual(errors, [])

    def test_parent_ids_resolve(self):
        events = chain()["events"]
        ids = {e["id"] for e in events}
        for event in events:
            self.assertTrue(set(event["parent_ids"]) <= ids, event["id"])


class LiveFeedTests(unittest.TestCase):
    def setUp(self):
        self.events = chain()["events"]
        self.applied = [e for e in self.events if e["status"] == "applied"]

    def test_feed_grows_one_story_per_applied_event(self):
        feed = WireFeed()
        feed.apply(snapshot_msg(0, []))
        self.assertEqual(feed.items, [])
        for count, event in enumerate(self.applied, start=1):
            self.assertTrue(feed.apply(event_msg(event)))
            self.assertEqual(len(feed.items), count)
            self.assertEqual(feed.items[0]["event_id"], event["id"], "newest story leads")
            feed.apply({**HEADER, "kind": "clock", "sim_time_minutes": event["sim_time_minutes"],
                        "playback": {"state": "playing", "speed": 4}})
            self.assertEqual(len(feed.items), count, "clock ticks add no news")

    def test_rejected_and_proposed_events_never_appear(self):
        hidden = {e["id"] for e in self.events if e["status"] != "applied"}
        self.assertEqual(hidden, {"evt-0007", "evt-0012"})
        feed = news_from_stream([snapshot_msg(0, [])] + [event_msg(e) for e in self.events])
        self.assertFalse(hidden & {item["event_id"] for item in feed})
        self.assertEqual(len(feed), len(self.applied))
        snap = news_from_stream([snapshot_msg(20000, self.events)])
        self.assertFalse(hidden & {item["event_id"] for item in snap})

    def test_snapshot_replaces_feed_on_seek_and_replay(self):
        messages = [snapshot_msg(0, [])] + [event_msg(e) for e in self.applied]
        back_to_day_one = [e for e in self.applied if e["sim_time_minutes"] <= 600]
        feed = news_from_stream(messages + [snapshot_msg(600, back_to_day_one)])
        self.assertEqual({i["event_id"] for i in feed}, {e["id"] for e in back_to_day_one})
        self.assertEqual(news_from_stream(messages + [snapshot_msg(0, [])]), [], "replay clears the wire")
        forward = news_from_stream(messages + [snapshot_msg(600, back_to_day_one), snapshot_msg(20000, self.applied)])
        self.assertEqual(len(forward), len(self.applied))

    def test_duplicate_event_message_is_not_reported_twice(self):
        quake = self.applied[0]
        self.assertEqual(len(news_from_stream([event_msg(quake), event_msg(quake)])), 1)


class ImpactCopyTests(unittest.TestCase):
    def setUp(self):
        self.stories = {i["event_id"]: i for i in derive_news(chain()["events"])}

    def text(self, event_id):
        story = self.stories[event_id]
        return story["headline"] + " " + story["dek"]

    def test_every_applied_event_gets_a_specific_labeled_story(self):
        for story in self.stories.values():
            self.assertEqual(story["label"], "SIMULATED")
            self.assertNotIn("Details are developing", story["dek"], story["event_type"])
            self.assertIn("Simulated", story["dek"])
            self.assertIn("event_type", story)
        self.assertEqual(len({s["headline"] for s in self.stories.values()}), len(self.stories))

    def test_quantified_wording(self):
        self.assertEqual(self.stories["evt-0003"]["headline"], "Evacuations ordered in Sendai, Japan")
        self.assertIn("210,000 displaced, 145,000 in shelters", self.text("evt-0003"))
        self.assertIn("1.8 million households without power", self.text("evt-0004"))
        self.assertIn("420,000 households without water", self.text("evt-0004"))
        self.assertIn("$38 billion in economic losses", self.text("evt-0011"))
        self.assertIn("12 km² contaminated", self.text("evt-0010"))
        self.assertIn("310 km² flooded", self.text("evt-0010"))
        self.assertIn("2.5 million tonnes of debris", self.text("evt-0010"))
        self.assertIn("60,000 households without power", self.text("evt-0013"))

    def test_casualty_figures_are_labeled_estimates(self):
        self.assertIn("Simulated estimates so far: 40 dead, 310 injured, 120 missing.", self.text("evt-0001"))

    def test_cumulative_snapshots_are_reported_not_summed(self):
        self.assertIn("240 dead", self.text("evt-0006"))
        deaths_sum = 40 + 40 + 95 + 95 + 180 + 240 + 260 + 260
        all_text = " ".join(self.text(i) for i in self.stories)
        for total in (deaths_sum, 40 + 95 + 180 + 240):
            self.assertNotIn(fmt_count(total) + " dead", all_text)

    def test_aid_names_contributors_and_quantities(self):
        self.assertEqual(self.stories["evt-0008"]["headline"],
                         "United States sends 500 personnel, 120 tonnes of aid to Sendai Airport")
        self.assertIn("water purification units", self.text("evt-0008"))
        aus = self.text("evt-0009")
        self.assertIn("Australia sends 180 personnel, 45 tonnes of aid", aus)
        self.assertIn("search-and-rescue teams", aus)
        self.assertIn("2 countries have sent help so far", aus)
        self.assertNotIn("United States", aus, "each story reports its own sender")
        self.assertNotIn("680", aus, "contributors are never added together")

    def test_repeat_aid_from_same_country_reads_as_running_total(self):
        events = chain()["events"]
        repeat = copy.deepcopy(events[8])
        repeat.update(id="evt-0099", sim_time_minutes=repeat["sim_time_minutes"] + 60, payload={
            "origin": "United States",
            "impacts": {**events[8]["payload"]["impacts"], "aid_contributors": [
                {"country": "United States", "personnel": 900, "cargo_tonnes": 300}]},
        })
        story = next(i for i in derive_news(events + [repeat]) if i["event_id"] == "evt-0099")
        self.assertTrue(story["headline"].startswith("United States has now sent 900 personnel, 300 tonnes"))

    def test_aid_without_quantities_or_origin(self):
        event = chain()["events"][7]
        event["payload"] = {"origin": "Canada"}
        self.assertTrue(news_for_event(event)["headline"].startswith("Canada sends aid to"))
        event["payload"] = {"origin": "unknown"}
        self.assertTrue(news_for_event(event)["headline"].startswith("International aid heads to"))
        event["payload"] = {}
        self.assertTrue(news_for_event(event)["headline"].startswith("International aid heads to"))

    def test_zero_figures_are_left_out(self):
        event = chain()["events"][3]
        event["payload"]["impacts"]["households_without_water"] = 0
        self.assertNotIn("without water", news_for_event(event)["dek"])

    def test_stories_without_impacts_fall_back_to_plain_copy(self):
        for event in chain()["events"]:
            event["payload"].pop("impacts", None)
            event["status"] = "applied"
            story = news_for_event(event)
            self.assertNotIn("estimate", story["headline"].lower())
            self.assertNotIn("Simulated estimates", story["dek"])

    def test_recovery_headline_follows_what_improved(self):
        events = [e for e in chain()["events"] if e["status"] == "applied"]
        base = events[-1]["payload"]["impacts"]

        def recovery_after(**changes):
            event = copy.deepcopy(events[-1])
            event.update(id="evt-0099", sim_time_minutes=event["sim_time_minutes"] + 60)
            event["payload"]["impacts"] = {**base, **changes}
            return next(i for i in derive_news(events + [event]) if i["event_id"] == "evt-0099")["headline"]

        self.assertTrue(recovery_after(households_without_power=0).startswith("Power restored across Sendai"))
        self.assertTrue(recovery_after(households_without_power=1000).startswith("Power returning across Sendai"))
        self.assertTrue(recovery_after(displaced=1000).startswith("Displacement eases in Sendai"))
        self.assertTrue(recovery_after(households_without_water=10).startswith("Water service returning in Sendai"))
        self.assertTrue(recovery_after().startswith("Recovery continues in Sendai"))


class ReadImpactsTests(unittest.TestCase):
    def test_malformed_values_are_dropped(self):
        event = {"payload": {"impacts": {
            "basis": "fictional_estimate",
            "deaths": -3, "injuries": True, "missing": "many", "displaced": float("nan"),
            "sheltered": 12, "unknown_field": 5,
            "aid_contributors": [{"country": ""}, "x", {"country": " Chile ", "personnel": -1, "cargo_tonnes": 8}],
        }}}
        self.assertEqual(read_impacts(event), {
            "sheltered": 12, "aid_contributors": [{"country": "Chile", "cargo_tonnes": 8}]})
        self.assertEqual(read_impacts({"payload": {"impacts": [1, 2]}}), {})
        self.assertEqual(read_impacts({}), {})

    def test_impacts_without_fictional_basis_are_ignored(self):
        for basis in (None, "official", ""):
            impacts = {"deaths": 10}
            if basis is not None:
                impacts["basis"] = basis
            self.assertEqual(read_impacts({"payload": {"impacts": impacts}}), {}, basis)

    def test_number_formatting(self):
        self.assertEqual(fmt_count(999), "999")
        self.assertEqual(fmt_count(12_400), "12,400")
        self.assertEqual(fmt_count(1_000_000), "1 million")
        self.assertEqual(fmt_count(1_850_000), "1.9 million")
        self.assertEqual(fmt_usd(38_000_000_000), "$38 billion")
        self.assertEqual(fmt_usd(4_800_000_000_000), "$4.8 trillion")
        self.assertEqual(fmt_count(1_400_000_000), "1.4 billion")


if __name__ == "__main__":
    unittest.main()
