"""NEWS-004 (#41): WORLD//WIRE copy is short enough to show as an in-game alert."""

import copy
import json
import re
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "services" / "newsroom"))

from worldwire import derive_news, news_for_event  # noqa: E402
from worldwire.wire import DEK_MAX, HEADLINE_MAX  # noqa: E402

FIXTURE = ROOT / "contracts" / "fixtures" / "japan-earthquake.json"
STABLE_FIELDS = {"event_id", "headline", "dek", "event_type", "severity", "focus"}


def events():
    return copy.deepcopy(json.loads(FIXTURE.read_text(encoding="utf-8"))["events"])


def numbers(text):
    return {int(n.replace(",", "")) for n in re.findall(r"\d[\d,]*", text)}


class AlertCopyTests(unittest.TestCase):
    def setUp(self):
        self.events = events()
        self.items = derive_news(self.events)
        self.by_id = {item["event_id"]: item for item in self.items}

    def test_every_fixture_event_gets_a_distinct_alert(self):
        applied = [e for e in self.events if e["status"] == "applied"]
        self.assertEqual(len(self.items), len(applied))
        headlines = [item["headline"] for item in self.items]
        self.assertEqual(len(set(headlines)), len(headlines), headlines)

    def test_headlines_and_deks_are_alert_length(self):
        for item in self.items:
            self.assertLessEqual(len(item["headline"]), HEADLINE_MAX, item["headline"])
            self.assertLessEqual(len(item["dek"]), DEK_MAX, item["dek"])
            self.assertTrue(item["headline"][0].isupper(), item["headline"])
            self.assertFalse(item["headline"].endswith("."), item["headline"])
            self.assertTrue(item["dek"].endswith("."), item["dek"])

    def test_headline_says_where(self):
        for event in self.events:
            headline = self.by_id[event["id"]]["headline"]
            self.assertIn(event["location"]["name"], headline)

    def test_feed_item_shape_is_unchanged(self):
        for event, item in ((e, self.by_id[e["id"]]) for e in self.events):
            self.assertLessEqual(STABLE_FIELDS, set(item))
            self.assertEqual(item["event_type"], event["type"])
            self.assertEqual(item["severity"], event["severity"])

    def test_figures_are_labeled_estimates_and_never_summed(self):
        for event in self.events:
            dek = self.by_id[event["id"]]["dek"]
            if "dead" in dek or "displaced" in dek or "households" in dek:
                self.assertIn("Simulated estimates so far:", dek)
            self.assertNotIn(" 0 ", f" {dek} ", "zero figures are not news")
        deaths = [e["payload"]["impacts"]["deaths"] for e in self.events]
        all_text = " ".join(i["headline"] + " " + i["dek"] for i in self.items)
        self.assertNotIn(sum(deaths), numbers(all_text))
        self.assertIn("905 dead", self.by_id["evt-0014"]["dek"], "the snapshot as given")

    def test_dek_leads_with_what_this_event_changed(self):
        self.assertTrue(self.by_id["evt-0004"]["dek"].startswith(
            "Simulated estimates so far: 2.3 million households without power."))
        self.assertTrue(self.by_id["evt-0008"]["dek"].startswith(
            "Simulated estimates so far: 640,000 households without water."))

    def test_aid_alerts_name_contributor_and_quantities(self):
        for event in self.events:
            if event["type"] != "international_aid":
                continue
            origin = event["payload"]["origin"]
            [entry] = [c for c in event["payload"]["impacts"]["aid_contributors"] if c["country"] == origin]
            headline = self.by_id[event["id"]]["headline"]
            self.assertTrue(headline.startswith(origin), headline)
            self.assertIn(f"{entry['personnel']:,} personnel", headline)
            self.assertIn(f"{entry['cargo_tonnes']:,} tonnes", headline)

    def test_follow_up_events_read_as_follow_ups(self):
        self.assertTrue(self.by_id["evt-0014"]["headline"].startswith("Another M6.1 aftershock"))
        self.assertTrue(self.by_id["evt-0009"]["headline"].startswith("Japan steps up emergency response"))
        self.assertNotEqual(self.by_id["evt-0019"]["headline"], self.by_id["evt-0020"]["headline"])

    def test_seek_never_rewrites_earlier_stories(self):
        full = {i["event_id"]: i for i in derive_news(self.events)}
        for cut in range(1, len(self.events)):
            for item in derive_news(self.events[:cut]):
                self.assertEqual(item, full[item["event_id"]])

    def test_unknown_event_type_gets_a_clear_generic_alert(self):
        event = self.events[0]
        event.update(type="solar_flare", payload={})
        item = news_for_event(event)
        self.assertEqual(item["headline"], "Solar flare reported in off the coast of Miyagi, Japan")
        self.assertTrue(item["dek"].startswith("Simulated"))

    def test_long_place_names_drop_the_country(self):
        event = self.events[9]
        event["location"]["name"] = "Yamagata Airport Emergency Logistics Hub"
        headline = news_for_event(event)["headline"]
        self.assertNotIn("Japan", headline)
        self.assertIn("Yamagata Airport Emergency Logistics Hub", headline)


if __name__ == "__main__":
    unittest.main()
