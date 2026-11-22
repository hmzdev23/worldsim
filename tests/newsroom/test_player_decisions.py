"""Player mode (prototype): WORLD//WIRE writes one clearly fictional story per decision."""

import copy
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "services" / "newsroom"))

from worldwire import derive_news  # noqa: E402
from worldwire.wire import DEK_MAX, HEADLINE_MAX, player_decision  # noqa: E402

JAPAN = ROOT / "contracts" / "fixtures" / "japan-earthquake.json"


def events_with_decision():
    events = copy.deepcopy(json.loads(JAPAN.read_text(encoding="utf-8"))["events"])[:3]
    trigger = events[0]
    decision = {
        **copy.deepcopy(trigger), "id": "evt-d1", "type": "evacuation", "sequence": 1, "severity": 0.4,
        "visual": "evacuation_flow", "parent_ids": [trigger["id"]], "provenance": {"source": "user"},
        "payload": {"description": "Simulated decision: the national crisis coordinator chose to widen coastal "
                                   "evacuation orders.",
                    "decision": {"id": "d1", "option_id": "widen_evacuation", "role": "crisis_coordinator",
                                 "role_title": "National crisis coordinator", "label": "Widen coastal evacuation orders"}},
    }
    consequence = {
        **copy.deepcopy(trigger), "id": "evt-d1-c1", "type": "evacuation", "sim_time_minutes": 500, "sequence": 0,
        "severity": 0.3, "visual": "evacuation_flow", "parent_ids": ["evt-d1"], "provenance": {"source": "numeric"},
        "payload": {"description": "Simulated: inland shelters fill beyond planned capacity.",
                    "decision_effect": "side_effect"},
    }
    return events + [decision, consequence]


class DecisionStoryTests(unittest.TestCase):
    def setUp(self):
        self.items = {i["event_id"]: i for i in derive_news(events_with_decision())}

    def test_one_fictional_story_names_the_decision(self):
        item = self.items["evt-d1"]
        self.assertEqual(item["headline"], "National crisis coordinator decides: widen coastal evacuation orders")
        self.assertIn("Simulated player decision", item["dek"])
        self.assertIn("fictional model", item["dek"])
        self.assertEqual(item["label"], "SIMULATED")
        self.assertLessEqual(len(item["headline"]), HEADLINE_MAX)
        self.assertLessEqual(len(item["dek"]), DEK_MAX)
        self.assertEqual(sum("decides:" in i["headline"] for i in self.items.values()), 1)

    def test_consequences_cite_the_decision(self):
        self.assertTrue(self.items["evt-d1-c1"]["dek"].endswith("Follows the decision to widen coastal evacuation orders."))

    def test_a_decision_is_not_a_repeat_of_its_event_type(self):
        # The later fixture evacuation still reads as the first evacuation at its place.
        self.assertEqual(self.items["evt-0003"]["headline"], "Evacuations ordered in Ishinomaki, Japan")

    def test_only_user_events_with_a_decision_count(self):
        event = events_with_decision()[3]
        self.assertIsNotNone(player_decision(event))
        self.assertIsNone(player_decision({**event, "provenance": {"source": "fixture"}}))
        self.assertIsNone(player_decision({**event, "payload": {"description": "x"}}))


if __name__ == "__main__":
    unittest.main()
