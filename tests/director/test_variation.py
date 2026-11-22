"""Seeded variation: every run is unique, and every variation is still a valid, causal chain."""

import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "services" / "director"))

from worlddirector import DirectorError, RUN_FIXTURES, build_prompt, generate, list_starters, new_seed, prepare_scenario  # noqa: E402
from worlddirector.variation import MAX_SEED, prompt_rules, vary_raw  # noqa: E402
from worlddirector.director import load_fixture  # noqa: E402

SEEDS = range(1, 41)


def events_of(fixture, seed=None):
    return generate(fixture=fixture, simulation_id="run-x", branch_id="main", seed=seed)["events"]


class SeedTests(unittest.TestCase):
    def test_new_seeds_are_in_range_and_differ(self):
        seeds = {new_seed() for _ in range(200)}
        self.assertTrue(all(1 <= s <= MAX_SEED for s in seeds))
        self.assertGreater(len(seeds), 190)

    def test_bad_seeds_are_rejected(self):
        for bad in (0, -1, MAX_SEED + 1, 1.5, "7", True):
            with self.subTest(seed=bad), self.assertRaises(DirectorError):
                generate(fixture="tsunami", simulation_id="run-x", seed=bad)


class FixtureVariationTests(unittest.TestCase):
    def test_without_a_seed_fixtures_replay_exactly(self):
        self.assertEqual(events_of("iceland-eruption"), events_of("iceland-eruption"))

    def test_every_seeded_run_is_unique_and_differs_from_the_fixture(self):
        for fixture in RUN_FIXTURES:
            with self.subTest(fixture=fixture):
                plain = json.dumps(events_of(fixture))
                runs = {json.dumps(events_of(fixture, seed)) for seed in SEEDS}
                self.assertEqual(len(runs), len(SEEDS))
                self.assertNotIn(plain, runs)

    def test_the_same_seed_gives_the_same_variation(self):
        self.assertEqual(events_of("japan-earthquake", 42), events_of("japan-earthquake", 42))

    def test_variations_stay_causal(self):
        for fixture in RUN_FIXTURES:
            for seed in SEEDS:
                with self.subTest(fixture=fixture, seed=seed):
                    events = events_of(fixture, seed)
                    by_id = {e["id"]: e for e in events}
                    keys = [(e["sim_time_minutes"], e["sequence"]) for e in events]
                    self.assertEqual(keys, sorted(keys))
                    for e in events:
                        self.assertTrue(0 <= e["severity"] <= 1)
                        for parent in e["parent_ids"]:
                            p = by_id[parent]
                            self.assertLess((p["sim_time_minutes"], p["sequence"]), (e["sim_time_minutes"], e["sequence"]))

    def test_the_triggering_event_and_the_ending_survive(self):
        raw = load_fixture("japan-earthquake")
        first = min(raw["events"], key=lambda e: e["sim_time_minutes"])
        last = max(raw["events"], key=lambda e: e["sim_time_minutes"])
        for seed in SEEDS:
            varied = vary_raw(raw, seed)["events"]
            self.assertIn(first["description"], [e["description"] for e in varied])
            self.assertIn(last["description"], [e["description"] for e in varied])
            self.assertEqual(min(e["sim_time_minutes"] for e in varied), first["sim_time_minutes"])

    def test_vary_raw_does_not_modify_its_input(self):
        raw = load_fixture("iceland-eruption")
        before = json.dumps(raw)
        vary_raw(raw, 7)
        self.assertEqual(json.dumps(raw), before)

    def test_prepare_scenario_passes_the_seed(self):
        a = prepare_scenario("A tsunami", simulation_id="run-a", fixture="tsunami", seed=1)
        b = prepare_scenario("A tsunami", simulation_id="run-a", fixture="tsunami", seed=2)
        self.assertNotEqual(a["events"], b["events"])


class PromptVariationTests(unittest.TestCase):
    def test_seeded_prompts_carry_directions_and_vary(self):
        prompts = {build_prompt("A blackout across Europe", seed=s) for s in SEEDS}
        self.assertGreater(len(prompts), 30)
        self.assertIn("run variation 5", build_prompt("A blackout", seed=5))
        self.assertNotIn("run variation", build_prompt("A blackout"))

    def test_directions_come_before_the_scenario_data(self):
        prompt = build_prompt("A blackout", seed=9)
        self.assertLess(prompt.index(prompt_rules(9).splitlines()[0]), prompt.index("<<<SCENARIO"))


class StarterTests(unittest.TestCase):
    def test_every_starter_has_a_run_fixture_and_a_prompt(self):
        starters = list_starters()
        self.assertEqual({s["fixture"] for s in starters}, set(RUN_FIXTURES))
        for s in starters:
            self.assertTrue(s["prompt"].strip() and s["title"] and s["summary"])

    def test_starters_describe_situations_not_games(self):
        text = json.dumps(list_starters()).lower()
        for word in ("your role", "you decide", "mission", "score", "player", "coordinate"):
            self.assertNotIn(word, text)


if __name__ == "__main__":
    unittest.main()
