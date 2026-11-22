"""Satire layer (local experiment): tones, fictional posts, absurdity index.

Presentation only: it must never change events or impacts, must follow the
clock (released events only), and must be deterministic for seek/replay.
"""

import copy
import json
import re
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / "services" / "newsroom"), str(ROOT / "services" / "director")]

from worldwire import TONES, derive_news, satire_for_events, satire_response  # noqa: E402
from worldwire.satire import ENTITIES, POST_LABEL, SATIRE_LABEL  # noqa: E402
from worlddirector import EVENT_TYPES, generate  # noqa: E402

FIXTURES = ("iceland-eruption", "japan-earthquake", "global-pandemic")


def applied(name):
    return [{**e, "status": "applied"} for e in generate(fixture=name)["events"]]


def snapshot(events, now, sim="satire-test"):
    return {"schema_version": "0.1", "simulation_id": sim, "branch_id": "main", "sim_time_minutes": now, "events": events}


class ToneTest(unittest.TestCase):
    def test_straight_is_the_original_experience(self):
        events = applied("iceland-eruption")
        self.assertEqual(satire_for_events(events, "straight"), {"items": [], "posts": [], "absurdity": []})

    def test_unknown_tone(self):
        with self.assertRaises(ValueError):
            satire_for_events(applied("iceland-eruption"), "spicy")
        self.assertEqual(TONES, ("straight", "satirical"))
        with self.assertRaises(ValueError):
            satire_for_events(applied("iceland-eruption"), "unhinged")

    def test_every_event_gets_labelled_satire_and_posts(self):
        for name in FIXTURES:
            events = applied(name)
            for tone in ("satirical",):
                with self.subTest(fixture=name, tone=tone):
                    layer = satire_for_events(events, tone)
                    self.assertEqual({i["event_id"] for i in layer["items"]}, {e["id"] for e in events})
                    for item in layer["items"]:
                        self.assertEqual(item["label"], SATIRE_LABEL)
                        self.assertTrue(item["headline"] and item["dek"])
                        self.assertNotIn("{", item["headline"] + item["dek"])  # every placeholder filled
                    per_event = {e["id"]: 0 for e in events}
                    for post in layer["posts"]:
                        per_event[post["event_id"]] += 1
                        self.assertEqual(post["label"], POST_LABEL)
                        self.assertNotIn("{", post["text"])
                    self.assertTrue(all(n >= 2 for n in per_event.values()), per_event)

    def test_original_report_is_kept_next_to_the_joke(self):
        events = applied("iceland-eruption")
        facts = {i["event_id"]: i["headline"] for i in derive_news(events)}
        for item in satire_for_events(events, "satirical")["items"]:
            self.assertEqual(item["original_headline"], facts[item["event_id"]])
            self.assertNotEqual(item["headline"], item["original_headline"])

    def test_every_event_type_has_copy(self):
        base = applied("iceland-eruption")[0]
        for i, kind in enumerate(EVENT_TYPES):
            event = {**copy.deepcopy(base), "id": f"evt-{i + 1:04d}", "type": kind, "sim_time_minutes": i}
            for tone in ("satirical",):
                item = satire_for_events([event], tone)["items"][0]
                self.assertNotIn("{", item["headline"], kind)

    def test_only_invented_authors(self):
        handles = {h for _, h, _ in ENTITIES.values()}
        for name in FIXTURES:
            for post in satire_for_events(applied(name), "satirical")["posts"]:
                self.assertIn(post["handle"], handles)


class SafetyTest(unittest.TestCase):
    def test_events_and_impacts_are_never_modified(self):
        for name in FIXTURES:
            events = applied(name)
            before = copy.deepcopy(events)
            for tone in TONES:
                satire_for_events(events, tone)
            self.assertEqual(events, before)

    def test_jokes_never_quote_casualty_figures(self):
        for name in FIXTURES:
            events = applied(name)
            figures = set()
            for e in events:
                for key in ("deaths", "injuries", "missing", "displaced"):
                    value = e["payload"].get("impacts", {}).get(key)
                    if isinstance(value, int) and value > 9:
                        figures.add(f"{value:,}")
                        figures.add(str(value))
            layer = satire_for_events(events, "satirical")
            text = json.dumps([[i["headline"], i["dek"]] for i in layer["items"]] + [p["text"] for p in layer["posts"]])
            for figure in figures:  # whole numbers only: "15" in "15:00" or "SORRY15" is not a casualty figure
                self.assertIsNone(re.search(rf"(?<![\w:]){re.escape(figure)}(?![\w:%])", text), figure)
            self.assertNotIn("dead", text.lower())


class ClockTest(unittest.TestCase):
    def test_response_withholds_future_events(self):
        events = applied("iceland-eruption")
        now = events[2]["sim_time_minutes"]
        body = satire_response(snapshot(events, now), "satirical")
        self.assertEqual(body["tone"], "satirical")
        self.assertEqual({i["event_id"] for i in body["items"]}, {e["id"] for e in events[:3]})
        self.assertTrue(all(p["sim_time_minutes"] <= now for p in body["posts"]))

    def test_earlier_satire_never_changes_as_time_moves_on(self):
        """Seek and replay: the layer at time T is the same however you got there."""
        events = applied("iceland-eruption")
        for tone in ("satirical",):
            full = satire_for_events(events, tone)
            for k in range(1, len(events)):
                part = satire_for_events(events[:k], tone)
                self.assertEqual(part["items"], full["items"][-k:], (tone, k))
                ids = {e["id"] for e in events[:k]}
                self.assertEqual(part["posts"], [p for p in full["posts"] if p["event_id"] in ids])

    def test_deterministic(self):
        events = applied("global-pandemic")
        self.assertEqual(satire_for_events(events, "satirical"), satire_for_events(copy.deepcopy(events), "satirical"))

    def test_bad_snapshot(self):
        with self.assertRaises(ValueError):
            satire_response({"simulation_id": "x", "branch_id": "main"}, "satirical")
        with self.assertRaises(ValueError):
            satire_response(snapshot([], -1), "satirical")


class AbsurdityTest(unittest.TestCase):
    def test_metrics_are_derived_from_posts_and_events(self):
        events = applied("iceland-eruption")
        layer = satire_for_events(events, "satirical")
        posts = layer["posts"]
        values = {m["key"]: m["value"] for m in layer["absurdity"]}
        self.assertEqual(values["committees"], sum("committee" in p["tags"] for p in posts))
        self.assertEqual(values["apologies"], sum("apology" in p["tags"] for p in posts))
        self.assertEqual(values["fluid"], sum("fluid" in p["tags"] for p in posts))
        self.assertEqual(values["profiteers"], len({p["handle"] for p in posts if "profiteer" in p["tags"]}))
        self.assertEqual(values["press_conferences"],
                         sum("press_conference" in p["tags"] for p in posts) + sum(e["type"] == "government_response" for e in events))
        self.assertEqual([m["key"] for m in layer["absurdity"]], ["press_conferences", "committees", "apologies", "fluid", "profiteers"])

    def test_metrics_never_decrease_during_playback(self):
        events = applied("japan-earthquake")
        previous = None
        for k in range(1, len(events) + 1):
            values = {m["key"]: m["value"] for m in satire_for_events(events[:k], "satirical")["absurdity"]}
            if previous:
                for key, value in values.items():
                    self.assertGreaterEqual(value, previous[key], key)
            previous = values


class DirectorSatireTest(unittest.TestCase):
    def test_director_written_satire_is_used_verbatim(self):
        events = applied("iceland-eruption")
        events[0]["payload"]["satire"] = {
            "headline": "Volcano issues statement through its lawyer",
            "dek": "The lawyer is also a volcano.",
            "posts": [{"author": "Glacier Weekly", "handle": "@GlacierWeekly", "kind": "anchor",
                       "text": "Our subcommittee on lava has apologised for the lava."}],
        }
        layer = satire_for_events(events, "satirical")
        first = layer["items"][-1]
        self.assertEqual((first["headline"], first["dek"], first["provenance"]),
                         ("Volcano issues statement through its lawyer", "The lawyer is also a volcano.", "director"))
        post = next(p for p in layer["posts"] if p["event_id"] == "evt-0001")
        self.assertEqual(post["handle"], "@GlacierWeekly")
        self.assertEqual(post["tags"], ["committee", "apology"])  # detected, so the index still counts it


if __name__ == "__main__":
    unittest.main()
