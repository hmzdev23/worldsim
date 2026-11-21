import copy
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
NEWSROOM = ROOT / "services" / "newsroom"
FIXTURE = ROOT / "contracts" / "fixtures" / "japan-earthquake.json"
sys.path.insert(0, str(NEWSROOM))

from worldwire import SIMULATED_LABEL, derive_news, format_sim_time, news_for_event, news_from_stream  # noqa: E402


def quake():
    return copy.deepcopy(json.loads(FIXTURE.read_text(encoding="utf-8"))["events"][0])


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
        later.update(id="evt-0002", type="infrastructure_failure", sim_time_minutes=1500)
        feed = derive_news([quake(), later])
        self.assertEqual([i["event_id"] for i in feed], ["evt-0002", "evt-0001"])
        self.assertEqual(feed[0]["headline"], "An estimated 900,000 households without power in off the coast of Miyagi, Japan")
        self.assertEqual(feed, derive_news([later, quake()]))

    def test_every_contract_event_type_has_a_template(self):
        schema = json.loads((ROOT / "contracts" / "events.schema.json").read_text(encoding="utf-8"))
        types = schema["$defs"]["event"]["properties"]["type"]["enum"]
        expected = {
            "earthquake": "M7.8 earthquake strikes",
            "aftershock": "M7.8 aftershock rattles",
            "tsunami_warning": "Tsunami warning issued for",
            "infrastructure_failure": "Major infrastructure failure hits",
            "government_response": "Japan mobilizes emergency response in",
            "international_aid": "International aid heads to",
            "volcanic_eruption": "Volcano erupts near",
            "meteor_impact": "Meteor strikes",
            "extreme_weather": "Extreme weather batters",
            "flooding": "Floodwaters swamp",
            "disease_outbreak": "Disease outbreak reported in",
            "military_strike": "Military strike hits",
            "nuclear_detonation": "Nuclear detonation reported near",
            "cyber_attack": "Cyberattack disrupts systems in",
            "alien_contact": "Unidentified craft reported over",
            "other_hazard": "Emergency declared in",
            "evacuation": "Evacuations ordered in",
            "contamination": "Contamination alert issued for",
            "economic_shock": "Economic shock hits",
            "civil_unrest": "Unrest erupts in",
            "conflict_escalation": "Conflict escalates near",
            "ceasefire": "Ceasefire declared in",
            "recovery": "Recovery under way in",
        }
        self.assertEqual(set(types), set(expected))
        for kind in types:
            event = quake()
            event["type"] = kind
            event["payload"].pop("impacts", None)
            item = news_for_event(event)
            self.assertTrue(item["headline"].startswith(expected[kind]), item["headline"])
            self.assertTrue(item["dek"].startswith("Simulated"), item["dek"])

    def test_new_hazard_templates_use_payload_details(self):
        cases = (
            ("disease_outbreak", {"pathogen": "novel influenza"}, "Novel influenza outbreak reported in"),
            ("military_strike", {"origin": "Ruritania"}, "Ruritania launches strike on"),
            ("military_strike", {"origin": "unknown"}, "Military strike hits"),
            ("cyber_attack", {"target": "the power grid"}, "Cyberattack hits the power grid in"),
            ("other_hazard", {"label": "solar superstorm"}, "Solar superstorm reported in"),
        )
        for kind, payload, start in cases:
            event = quake()
            event.update(type=kind, payload=payload)
            self.assertTrue(news_for_event(event)["headline"].startswith(start), (kind, payload))
        volcano = quake()
        volcano.update(type="volcanic_eruption", payload={"vei": 5})
        self.assertTrue(news_for_event(volcano)["headline"].endswith("(VEI 5)"))

    def test_aid_names_origin_and_severity_scales_wording(self):
        aid = quake()
        aid.update(type="international_aid", payload={"origin": "Canada"})
        self.assertTrue(news_for_event(aid)["headline"].startswith("Canada sends aid to"))
        outage = quake()
        outage.update(type="infrastructure_failure", severity=0.2, payload={})
        self.assertTrue(news_for_event(outage)["headline"].startswith("Partial infrastructure failure"))
        outage["severity"] = 0.5
        self.assertTrue(news_for_event(outage)["headline"].startswith("Infrastructure failure"))

    def test_sequence_breaks_ties_at_same_sim_time(self):
        second = quake()
        second.update(id="evt-0000", sequence=1)
        self.assertEqual([i["event_id"] for i in derive_news([quake(), second])], ["evt-0000", "evt-0001"])

    def test_stream_snapshot_replaces_feed(self):
        header = {"schema_version": "0.1", "simulation_id": "demo", "branch_id": "main"}
        later = quake()
        later.update(id="evt-0002", sim_time_minutes=500)
        messages = [
            {**header, "sim_time_minutes": 402, "kind": "event", "event": quake()},
            {**header, "sim_time_minutes": 500, "kind": "event", "event": later},
            {**header, "sim_time_minutes": 450, "kind": "snapshot", "events": [quake()],
             "playback": {"state": "paused", "speed": 1}},
        ]
        self.assertEqual([i["event_id"] for i in news_from_stream(messages)], ["evt-0001"])

    def test_invalid_location_is_rejected(self):
        event = quake()
        event["location"]["lat"] = 120
        with self.assertRaises(ValueError):
            news_for_event(event)

    def test_sim_time_format(self):
        self.assertEqual(format_sim_time(0), "DAY 1 · 00:00")
        self.assertEqual(format_sim_time(24 * 60 + 75), "DAY 2 · 01:15")

    def test_committed_web_feed_is_up_to_date(self):
        feed = json.loads((NEWSROOM / "feeds" / "japan-earthquake.json").read_text(encoding="utf-8"))
        events = json.loads(FIXTURE.read_text(encoding="utf-8"))["events"]
        self.assertEqual(
            feed, derive_news(events),
            "regenerate: cd services/newsroom && python3 -m worldwire "
            "../../contracts/fixtures/japan-earthquake.json > feeds/japan-earthquake.json",
        )

    def test_cli_json_and_html(self):
        cmd = [sys.executable, "-m", "worldwire", str(FIXTURE)]
        out = subprocess.run(cmd, cwd=NEWSROOM, check=True, capture_output=True, text=True).stdout
        self.assertEqual(json.loads(out)[-1]["event_id"], "evt-0001")  # newest first, so the quake is last
        with tempfile.TemporaryDirectory() as tmp:
            page = Path(tmp) / "wire.html"
            subprocess.run(cmd + ["--html", str(page)], cwd=NEWSROOM, check=True, capture_output=True)
            html = page.read_text(encoding="utf-8")
            self.assertIn("M7.8 earthquake strikes", html)
            self.assertIn("worldsim:focus", html)
            self.assertNotIn("/*__WORLDWIRE_FEED__*/", html)


if __name__ == "__main__":
    unittest.main()
