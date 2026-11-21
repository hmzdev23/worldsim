"""NEWS-006 (#59): live WORLD//WIRE reads well for any scenario, even when events arrive fast.

Uses the Director's deterministic run fixtures (a global pandemic and an
Iceland eruption) plus small hand-built batches. Copy must stay grounded in
applied events: no transport routes or infection counts that the events
don't carry.
"""

import copy
import json
import re
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "services" / "newsroom"))
sys.path.insert(0, str(ROOT / "services" / "director"))

from worlddirector import prepare_scenario  # noqa: E402
from worldwire import WireFeed, derive_news, news_response  # noqa: E402
from worldwire.wire import DEK_MAX, HEADLINE_MAX  # noqa: E402

JAPAN = ROOT / "contracts" / "fixtures" / "japan-earthquake.json"
ITEM_FIELDS = {"id", "event_id", "event_type", "severity", "label", "headline", "dek",
               "sim_time_minutes", "sequence", "sim_time_label", "focus", "provenance"}


def run(fixture, simulation_id="run-story"):
    batch = prepare_scenario("A fictional scenario", simulation_id=simulation_id, fixture=fixture)
    batch["events"] = [{**e, "status": "applied"} for e in batch["events"]]
    return batch


def japan():
    return json.loads(JAPAN.read_text(encoding="utf-8"))


def by_event(items):
    return {item["event_id"]: item for item in items}


def snapshot(batch, minutes):
    return {"schema_version": "0.1", "simulation_id": batch["simulation_id"], "branch_id": batch["branch_id"],
            "sim_time_minutes": minutes, "kind": "snapshot", "playback": {"state": "paused", "speed": 1},
            "events": [copy.deepcopy(e) for e in batch["events"] if e["sim_time_minutes"] <= minutes]}


def event(eid, minute, kind, place, country="Testland", sequence=0, parents=(), **payload):
    return {"id": eid, "sim_time_minutes": minute, "sequence": sequence, "type": kind, "status": "applied",
            "severity": 0.5, "visual": "generic_alert", "parent_ids": list(parents), "payload": payload,
            "location": {"name": place, "country": country, "country_code": "TST", "lat": 10.0, "lon": 20.0},
            "provenance": {"source": "fixture"}}


class ScenarioCopyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pandemic = run("global-pandemic")
        cls.iceland = run("iceland-eruption")
        cls.runs = {"pandemic": cls.pandemic, "iceland": cls.iceland, "japan": japan()}

    def test_every_alert_is_distinct_alert_length_and_keeps_the_item_shape(self):
        for name, batch in self.runs.items():
            with self.subTest(name):
                items = derive_news(batch["events"])
                headlines = [i["headline"] for i in items]
                self.assertEqual(len(set(headlines)), len(headlines), headlines)
                for item in items:
                    self.assertEqual(set(item), ITEM_FIELDS)
                    self.assertLessEqual(len(item["headline"]), HEADLINE_MAX, item["headline"])
                    self.assertLessEqual(len(item["dek"]), DEK_MAX, item["dek"])
                    self.assertNotIn("  ", item["headline"] + item["dek"])

    def test_pandemic_spread_reads_as_spread_without_inventing_case_counts(self):
        items = by_event(derive_news(self.pandemic["events"]))
        outbreaks = [e for e in self.pandemic["events"] if e["type"] == "disease_outbreak"]
        first, *later = outbreaks
        self.assertEqual(items[first["id"]]["headline"], "Novel respiratory virus outbreak reported in Singapore")
        for n, outbreak in enumerate(later, start=2):
            item = items[outbreak["id"]]
            self.assertIn(first["id"], outbreak["parent_ids"])  # the fixture links them
            self.assertTrue(item["headline"].startswith("Novel respiratory virus spreads to "), item["headline"])
            self.assertIn(f"Outbreaks now reported in {n} places.", item["dek"])
        for item in items.values():
            text = item["headline"] + " " + item["dek"]
            # Places are counted; infections, prevalence and rates never are.
            self.assertNotRegex(text, r"%|\binfect(ed|ions)\b|\d[\d,]* (cases|patients|people)")

    def test_outbreak_wording_follows_the_events(self):
        events = [
            event("evt-1", 0, "disease_outbreak", "Port City", pathogen="test virus"),
            event("evt-2", 60, "disease_outbreak", "Port City", sequence=0, parents=["evt-1"], pathogen="test virus"),
            event("evt-3", 120, "disease_outbreak", "Hill Town", pathogen="test virus"),  # no causal link
            event("evt-4", 180, "disease_outbreak", "River Town", parents=["evt-1"], pathogen="test virus"),
        ]
        items = by_event(derive_news(events))
        self.assertEqual(items["evt-1"]["headline"], "Test virus outbreak reported in Port City, Testland")
        self.assertEqual(items["evt-2"]["headline"], "Test virus outbreak grows in Port City, Testland")
        self.assertEqual(items["evt-3"]["headline"], "Test virus cases confirmed in Hill Town, Testland")
        self.assertEqual(items["evt-4"]["headline"], "Test virus spreads to River Town, Testland")
        self.assertNotIn("Outbreaks now", items["evt-2"]["dek"])  # same place: no new reach
        self.assertIn("Outbreaks now reported in 3 places.", items["evt-4"]["dek"])

    def test_disaster_infrastructure_aid_and_recovery_copy(self):
        items = by_event(derive_news(self.iceland["events"]))
        kinds = {e["type"]: e["id"] for e in self.iceland["events"]}
        self.assertEqual(items[kinds["volcanic_eruption"]]["headline"],
                         "Volcano erupts near Reykjanes Peninsula, Iceland (VEI 4)")
        self.assertEqual(items[kinds["infrastructure_failure"]]["headline"],
                         "Geothermal plant knocked out in Svartsengi Power Station, Iceland")
        self.assertIn("Follows the eruption in Reykjanes Peninsula.", items[kinds["infrastructure_failure"]]["dek"])
        self.assertTrue(items[kinds["recovery"]]["headline"].startswith("Power returning across"))
        aid = [items[e["id"]] for e in self.iceland["events"] if e["type"] == "international_aid"]
        self.assertEqual([a["headline"] for a in aid], [
            "Norway sends 40 personnel, 25 tonnes of aid to Reykjavik, Iceland",
            "Denmark sends 35 personnel, 30 tonnes of aid to Reykjavik, Iceland",
        ])
        self.assertIn("2 countries have sent help so far.", aid[1]["dek"])

    def test_aid_never_asserts_a_route_the_events_do_not_give(self):
        route_words = r"\b(route|routes|flight|flights|flown|airlift|convoy|via|shipped from|by sea|by air)\b"
        for name, batch in self.runs.items():
            for ev in batch["events"]:
                if ev["type"] != "international_aid":
                    continue
                item = by_event(derive_news(batch["events"]))[ev["id"]]
                own_text = json.dumps(ev["payload"]).lower()
                for word in re.findall(route_words, (item["headline"] + " " + item["dek"]).lower()):
                    self.assertIn(word, own_text, f"{name} {ev['id']}: {item}")

    def test_repeats_read_as_follow_ups(self):
        events = [
            event("evt-1", 0, "volcanic_eruption", "Fire Mountain"),
            event("evt-2", 30, "volcanic_eruption", "Fire Mountain", parents=["evt-1"]),
            event("evt-3", 40, "infrastructure_failure", "Ash Valley", parents=["evt-1"]),
            event("evt-4", 50, "infrastructure_failure", "Ash Valley", parents=["evt-3"]),
            event("evt-5", 60, "civil_unrest", "Capital"),
            event("evt-6", 70, "civil_unrest", "Capital"),
            event("evt-7", 80, "military_strike", "Border Post", origin="Northland"),
            event("evt-8", 90, "military_strike", "Border Post", origin="Northland"),
        ]
        headlines = {i["event_id"]: i["headline"] for i in derive_news(events)}
        self.assertEqual(headlines["evt-2"], "New eruption near Fire Mountain, Testland")
        self.assertEqual(headlines["evt-4"], "More outages hit Ash Valley, Testland")
        self.assertEqual(headlines["evt-6"], "Unrest spreads in Capital, Testland")
        self.assertEqual(headlines["evt-8"], "Northland launches another strike on Border Post, Testland")

    def test_government_response_does_not_repeat_the_place(self):
        items = by_event(derive_news(self.pandemic["events"]))
        first = next(e for e in self.pandemic["events"] if e["type"] == "government_response")
        self.assertEqual(items[first["id"]]["headline"], "Singapore mobilizes emergency response")

    def test_cause_note_only_for_a_different_kind_of_parent(self):
        events = [
            event("evt-1", 0, "earthquake", "off the coast of Testland"),
            event("evt-2", 10, "aftershock", "Bay Town", parents=["evt-1"]),
            event("evt-3", 20, "aftershock", "Bay Town", parents=["evt-2"]),
            event("evt-4", 30, "evacuation", "Bay Town", parents=["evt-9"]),  # unknown parent: no note
        ]
        items = by_event(derive_news(events))
        self.assertTrue(items["evt-2"]["dek"].endswith("Follows the earthquake off the coast of Testland."))
        self.assertNotIn("Follows", items["evt-3"]["dek"])
        self.assertNotIn("Follows", items["evt-4"]["dek"])


class RapidEventTests(unittest.TestCase):
    def test_same_minute_events_at_one_place_stay_distinct(self):
        events = [event(f"evt-{i}", 300, "infrastructure_failure", "Grid Hub", sequence=i) for i in range(5)]
        items = derive_news(events)
        headlines = [i["headline"] for i in reversed(items)]
        self.assertEqual(headlines[:2], ["Infrastructure failure hits Grid Hub, Testland",
                                         "More outages hit Grid Hub, Testland"])
        self.assertEqual(headlines[2:], ["More outages hit Grid Hub, Testland (update 2)",
                                         "More outages hit Grid Hub, Testland (update 3)",
                                         "More outages hit Grid Hub, Testland (update 4)"])
        self.assertEqual(len(set(headlines)), 5)

    def test_long_names_stay_whole_and_distinct(self):
        # Like NEWS-004, a long place name is kept whole rather than cut.
        long_place = "An Extremely Long Industrial District Name For Testing"
        events = [event(f"evt-{i}", 0, "cyber_attack", long_place, sequence=i, target="power grid control systems")
                  for i in range(3)]
        headlines = [i["headline"] for i in derive_news(events)]
        self.assertEqual(len(set(headlines)), 3)
        for headline in headlines:
            self.assertIn(long_place, headline)


class LivePlaybackTests(unittest.TestCase):
    """The alert and the archive show the same story, at any point in playback."""

    def setUp(self):
        self.batch = run("iceland-eruption", "run-live")
        self.archive = by_event(derive_news(self.batch["events"]))
        self.times = sorted({e["sim_time_minutes"] for e in self.batch["events"]})

    def test_story_is_identical_in_alert_archive_seek_and_replay(self):
        # Forward play, then seeks backward and forward, then a replay from 0.
        for minute in self.times + [self.times[3], self.times[1], self.times[-1], 0] + self.times:
            body = news_response(snapshot(self.batch, minute))
            for item in body["items"]:
                self.assertLessEqual(item["sim_time_minutes"], minute)  # never future news
                self.assertEqual(item, self.archive[item["event_id"]])
            released = [e["id"] for e in self.batch["events"] if e["sim_time_minutes"] <= minute]
            self.assertEqual(sorted(i["event_id"] for i in body["items"]), sorted(released))

    def test_stream_feed_matches_the_news_response(self):
        feed = WireFeed()
        feed.apply(snapshot(self.batch, 0))
        for ev in self.batch["events"]:
            feed.apply({"schema_version": "0.1", "simulation_id": "run-live", "branch_id": "main",
                        "sim_time_minutes": ev["sim_time_minutes"], "kind": "event", "event": ev})
            self.assertEqual(feed.items, news_response(snapshot(self.batch, ev["sim_time_minutes"]))["items"])

    def test_runs_stay_isolated(self):
        other = run("global-pandemic", "run-other")  # reuses evt-0001… IDs
        mine = news_response(snapshot(self.batch, self.times[-1]))["items"]
        news_response(snapshot(other, 10**6))
        self.assertEqual(news_response(snapshot(self.batch, self.times[-1]))["items"], mine)
        self.assertNotEqual(by_event(mine)["evt-0001"]["headline"],
                            by_event(derive_news(other["events"]))["evt-0001"]["headline"])


if __name__ == "__main__":
    unittest.main()
