"""INT-001 smoke check: fixture -> stream -> WORLD//WIRE -> map focus.

Runs offline with no model login. Schema validation runs when jsonschema is
installed; the rest needs only the standard library.
"""

import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CONTRACTS = ROOT / "contracts"
sys.path.insert(0, str(ROOT / "services" / "newsroom"))
sys.path.insert(0, str(ROOT / "services" / "simulation"))

from worldsim_sim import Simulation, replay  # noqa: E402
from worldwire import SIMULATED_LABEL, WireFeed, news_from_stream  # noqa: E402
from worldwire.__main__ import main as worldwire_cli  # noqa: E402

try:
    from jsonschema import Draft202012Validator
    from referencing import Registry, Resource
except ImportError:  # pragma: no cover
    Draft202012Validator = None


def load(path):
    return json.loads(path.read_text(encoding="utf-8"))


class EarthquakeDemoTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.batch = load(CONTRACTS / "fixtures" / "japan-earthquake.json")
        cls.messages = replay(cls.batch, speed=4)
        cls.quake = next(e for e in cls.batch["events"] if e["type"] == "earthquake")

    def test_stream_starts_with_snapshot_and_is_ordered(self):
        self.assertEqual(self.messages[0]["kind"], "snapshot")
        events = [m["event"] for m in self.messages if m["kind"] == "event"]
        keys = [(e["sim_time_minutes"], e["sequence"]) for e in events]
        self.assertEqual(keys, sorted(keys))
        self.assertIn(self.quake["id"], [e["id"] for e in events])

    @unittest.skipIf(Draft202012Validator is None, "pip install jsonschema for schema checks")
    def test_stream_messages_match_contract(self):
        schemas = [load(CONTRACTS / n) for n in ("events.schema.json", "stream.schema.json")]
        registry = Registry().with_resources((s["$id"], Resource.from_contents(s)) for s in schemas)
        validator = Draft202012Validator(schemas[1], registry=registry)
        for message in self.messages:
            self.assertEqual([e.message for e in validator.iter_errors(message)], [], message["kind"])

    def test_earthquake_reaches_wire_with_focus_on_event(self):
        feed = news_from_stream(self.messages)
        card = next(item for item in feed if item["event_id"] == self.quake["id"])
        self.assertEqual(card["label"], SIMULATED_LABEL)
        self.assertIn("earthquake", card["headline"].lower())
        self.assertTrue(card["sim_time_label"].startswith("DAY "))
        loc = self.quake["location"]
        self.assertEqual((card["focus"]["lat"], card["focus"]["lon"]), (loc["lat"], loc["lon"]))
        self.assertEqual(card["focus"]["event_id"], self.quake["id"])

    def test_preview_page_wires_card_click_to_focus(self):
        with tempfile.TemporaryDirectory() as tmp:
            page = Path(tmp) / "wire.html"
            fixture = str(CONTRACTS / "fixtures" / "japan-earthquake.json")
            self.assertEqual(worldwire_cli([fixture, "--html", str(page)]), 0)
            html = page.read_text(encoding="utf-8")
        self.assertIn(f'"event_id": "{self.quake["id"]}"', html)
        self.assertIn('dispatchEvent(new CustomEvent("worldsim:focus"', html)


class MultiEventChainTests(unittest.TestCase):
    """NEWS-003 (#28): the real engine drives WORLD//WIRE one applied event at a time."""

    def setUp(self):
        batch = load(ROOT / "tests" / "newsroom" / "fixtures" / "impact-chain.json")
        self.sim = Simulation.from_batch(batch, state="paused")
        self.sim.seek(0)
        self.timeline = self.sim.timeline
        self.feed = WireFeed()
        self.feed.apply(self.sim.snapshot())

    def test_wire_follows_engine_event_by_event_and_seek(self):
        self.assertNotIn("evt-0007", [e["id"] for e in self.timeline], "engine skips rejected events")
        self.sim.play()
        seen = []
        last = self.timeline[-1]["sim_time_minutes"]
        while self.sim.now < last:
            for message in self.sim.advance(60):
                if message["kind"] == "event":
                    seen.append(message["event"]["id"])
                    self.feed.apply(message)
                    self.assertEqual(self.feed.items[0]["event_id"], message["event"]["id"])
                    self.assertEqual(len(self.feed.items), len(seen))
                    # Nothing from the future is on the wire yet.
                    self.assertTrue(all(i["sim_time_minutes"] <= self.sim.now for i in self.feed.items))
        self.assertEqual(seen, [e["id"] for e in self.timeline])

        self.feed.apply(self.sim.seek(600))
        self.assertEqual({i["event_id"] for i in self.feed.items},
                         {e["id"] for e in self.timeline if e["sim_time_minutes"] <= 600})
        self.feed.apply(self.sim.seek(0))
        self.assertEqual(self.feed.items, [])


if __name__ == "__main__":
    unittest.main()
