import copy
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
NEWSROOM = ROOT / "services" / "newsroom"
FIXTURE = NEWSROOM / "fixtures" / "japan-earthquake.json"
sys.path.insert(0, str(NEWSROOM))

from worldwire import SIMULATED_LABEL, derive_news, format_sim_time, news_for_event  # noqa: E402


def quake():
    return copy.deepcopy(json.loads(FIXTURE.read_text())["events"][0])


class WorldWireTests(unittest.TestCase):
    def test_fixture_produces_labeled_headline(self):
        [item] = derive_news([quake()])
        self.assertEqual(item["label"], SIMULATED_LABEL)
        self.assertEqual(item["headline"], "M7.8 earthquake strikes off the coast of Miyagi, Japan")
        self.assertEqual(item["sim_time_label"], "DAY 1 · 06:42")
        self.assertEqual(item["event_id"], "evt-0001")

    def test_focus_points_at_originating_event(self):
        item = news_for_event(quake())
        self.assertEqual(item["focus"], {"event_id": "evt-0001", "lat": 38.3, "lon": 142.4, "zoom": 6.0})

    def test_unapplied_events_are_not_reported(self):
        event = quake()
        event["status"] = "proposed"
        self.assertIsNone(news_for_event(event))
        self.assertEqual(derive_news([event]), [])

    def test_output_is_deterministic_and_newest_first(self):
        later = quake()
        later.update(id="evt-0002", type="power_grid_failure", sim_time_minutes=1500)
        feed = derive_news([quake(), later])
        self.assertEqual([i["event_id"] for i in feed], ["evt-0002", "evt-0001"])
        self.assertEqual(feed[0]["headline"], "Power grid failure reported in off the coast of Miyagi, Japan")
        self.assertEqual(feed, derive_news([later, quake()]))

    def test_invalid_location_is_rejected(self):
        event = quake()
        event["location"]["lat"] = 120
        with self.assertRaises(ValueError):
            news_for_event(event)

    def test_sim_time_format(self):
        self.assertEqual(format_sim_time(0), "DAY 1 · 00:00")
        self.assertEqual(format_sim_time(24 * 60 + 75), "DAY 2 · 01:15")

    def test_cli_json_and_html(self):
        cmd = [sys.executable, "-m", "worldwire", str(FIXTURE)]
        out = subprocess.run(cmd, cwd=NEWSROOM, check=True, capture_output=True, text=True).stdout
        self.assertEqual(json.loads(out)[0]["event_id"], "evt-0001")
        with tempfile.TemporaryDirectory() as tmp:
            page = Path(tmp) / "wire.html"
            subprocess.run(cmd + ["--html", str(page)], cwd=NEWSROOM, check=True, capture_output=True)
            html = page.read_text()
            self.assertIn("M7.8 earthquake strikes", html)
            self.assertIn("worldsim:focus", html)
            self.assertNotIn("/*__WORLDWIRE_FEED__*/", html)


if __name__ == "__main__":
    unittest.main()
