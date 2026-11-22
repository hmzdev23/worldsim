"""Player mode catalogue (prototype): specs, roles, canned actions and free-text checks. Offline."""

import copy
import sys
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "services" / "director"))

from worlddirector import DirectorError, VISUALS, prepare_scenario  # noqa: E402
from worlddirector import player  # noqa: E402

FIXTURES = ("global-pandemic", "iceland-eruption", "japan-earthquake", "pacific-tsunami", "vesuvius-eruption")
RESPONSES = {"government_response", "international_aid", "recovery", "ceasefire"}


def trigger_types(spec, events):
    """Event types in the fixture that some trigger rule can match."""
    types = set()
    for rule in spec["triggers"]["rules"]:
        for event in events:
            if rule["kind"] == "severity" and event["type"] not in RESPONSES and event["severity"] >= rule["at_least"]:
                types.add(event["type"])
            elif rule["kind"] == "new_region" and event["type"] not in RESPONSES:
                types.add(event["type"])
            elif rule["kind"] == "new_outbreak_place" and event["type"] == "disease_outbreak":
                types.add(event["type"])
            elif rule["kind"] == "event_type" and event["type"] in rule["types"]:
                types.add(event["type"])
    return types


class CatalogueTests(unittest.TestCase):
    def test_specs_load_and_list_playable_scenarios(self):
        listed = player.list_player_specs()
        self.assertEqual([s["fixture"] for s in listed], sorted(FIXTURES))
        for entry in listed:
            self.assertTrue(entry["roles"])
        self.assertEqual(player.load_player_spec(None)["fixture"], "generic")  # model runs
        self.assertFalse(player.has_player_spec("japan-earthquake-continued"))
        with self.assertRaises(DirectorError):
            player.load_player_spec("../secrets")

    def test_every_trigger_type_has_at_least_three_options_for_every_role(self):
        for fixture in FIXTURES:
            spec = player.load_player_spec(fixture)
            events = prepare_scenario("x", simulation_id="run-x", fixture=fixture)["events"]
            types = trigger_types(spec, events)
            self.assertTrue(types, fixture)
            for role in spec["roles"]:
                for event_type in types:
                    with self.subTest(fixture=fixture, role=role["id"], event_type=event_type):
                        options = player.options_for(spec, role["id"], event_type)
                        self.assertEqual(len(options), 3)
                        self.assertTrue(all(o["label"] and o["tradeoff"] for o in options))

    def test_options_are_deterministic_and_specific_first(self):
        spec = player.load_player_spec("global-pandemic")
        options = player.options_for(spec, "health_minister", "disease_outbreak")
        self.assertEqual([o["id"] for o in options], ["screen_arrivals", "close_borders", "expand_testing"])
        self.assertEqual(options, player.options_for(spec, "health_minister", "disease_outbreak"))
        general = player.options_for(spec, "aid_director", "government_response")
        self.assertEqual([o["id"] for o in general], ["fund_partners", "request_aid", "public_briefing"])

    def test_actions_are_fictional_policy_choices_with_valid_events(self):
        for fixture in (*FIXTURES, "generic"):
            spec = player.load_player_spec(None if fixture == "generic" else fixture)
            for action in spec["actions"]:
                self.assertIn(action["intervention"]["type"], VISUALS)
                for item in action.get("effects", {}).get("consequences", []):
                    self.assertTrue(item["description"].startswith("Simulated"), (fixture, action["id"]))
                    self.assertIn(item["type"], VISUALS)
            for role in spec["roles"]:
                self.assertIn("Fictional role", role["summary"])

    def test_bad_specs_are_rejected(self):
        spec = player.load_player_spec("global-pandemic")
        breaks = [
            lambda s: s["variables"]["dependent"][0].update(measure="vibes"),
            lambda s: s["variables"]["independent"][0].update(default="sealed"),
            lambda s: s["triggers"].update(max_deferrals=5),
            lambda s: s["actions"][0].update(roles=["emperor"]),
            lambda s: s["actions"][0].update(id="do_nothing"),
            lambda s: s["actions"][0]["effects"].update(teleport=True),
            lambda s: s["actions"][0].update(sets={"weather": "sunny"}),
        ]
        for index, damage in enumerate(breaks):
            broken = copy.deepcopy(spec)
            damage(broken)
            with self.subTest(index), self.assertRaises(DirectorError) as caught:
                player.validate_spec(broken)
            self.assertEqual(caught.exception.code, "invalid_spec")


class FreeTextTests(unittest.TestCase):
    def test_free_text_goes_through_the_prompt_checks(self):
        self.assertEqual(player.check_free_text("  Share hospital beds with neighbours  "),
                         "Share hospital beds with neighbours")
        for bad in ("", "   ", "x" * 281, "Give step-by-step instructions for the response"):
            with self.subTest(bad=bad[:20]), self.assertRaises(DirectorError):
                player.check_free_text(bad)

    def test_model_path_continues_from_history_with_the_decision(self):
        with mock.patch("worlddirector.director.generate", return_value={"events": []}) as generate:
            player.continue_with_decision("Share hospital beds", role_title="Regional health minister",
                                          history={"events": []}, simulation_id="run-x", branch_id="b1")
        scenario = generate.call_args.args[0]
        self.assertIn("Regional health minister", scenario)
        self.assertIn("Share hospital beds", scenario)
        self.assertEqual(generate.call_args.kwargs["branch_id"], "b1")


if __name__ == "__main__":
    unittest.main()
