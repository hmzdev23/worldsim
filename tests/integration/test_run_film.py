"""The run recap film follows its run: same events, same order, same places, nothing added.

experiments/recap-films/films/run/make-script.py turns a run's canonical result
(GET /scenarios/{id}/result) into the film's script. These checks hold for every
starter and many seeds, so they hold for whatever run a viewer just watched.
"""

import importlib.util
import json
import re
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / "services" / "director"), str(ROOT / "services" / "newsroom")]

from worlddirector import RUN_FIXTURES, prepare_scenario  # noqa: E402
from worldwire import satire_for_events  # noqa: E402

spec = importlib.util.spec_from_file_location("run_film", ROOT / "experiments/recap-films/films/run/make-script.py")
film = importlib.util.module_from_spec(spec)
spec.loader.exec_module(film)

SEEDS = (3, 17, 404, 9001)


def result_for(fixture, seed):
    batch = prepare_scenario(fixture, simulation_id="run-film", fixture=fixture, seed=seed)
    return {"simulation_id": "run-film", "seed": seed, "prompt": fixture,
            "events": [{**e, "status": "applied"} for e in batch["events"]]}


class RunFilmTests(unittest.TestCase):
    def cases(self):
        for fixture in RUN_FIXTURES:
            for seed in SEEDS:
                result = result_for(fixture, seed)
                yield fixture, seed, result, film.build(result, "satirical")

    def test_shots_are_the_runs_events_in_the_runs_order(self):
        for fixture, seed, result, script in self.cases():
            with self.subTest(fixture=fixture, seed=seed):
                order = [e["id"] for e in result["events"]]
                by_id = {e["id"]: e for e in result["events"]}
                shots = [s for s in script["shots"] if s["event_id"]]
                ids = [s["event_id"] for s in shots]
                self.assertEqual(ids, sorted(ids, key=order.index))
                self.assertEqual(ids[0], order[0])     # opens on the triggering event
                self.assertEqual(ids[-1], order[-1])   # ends where the run ends
                for shot in shots:
                    event = by_id[shot["event_id"]]
                    self.assertEqual(shot["place"], event["location"]["name"])
                    self.assertEqual(shot["event_type"], event["type"])
                    self.assertIn(event["location"]["name"], shot["narration"])

    def test_jokes_come_from_that_events_satire_and_are_never_repeated(self):
        for fixture, seed, result, script in self.cases():
            with self.subTest(fixture=fixture, seed=seed):
                posts = satire_for_events(result["events"], "satirical")["posts"]
                texts = []
                for shot in script["shots"]:
                    if "notification" not in shot:
                        continue
                    mine = [p["text"] for p in posts if p["event_id"] == shot["event_id"]]
                    self.assertIn(shot["notification"]["text"], mine)
                    texts.append(shot["notification"]["text"])
                self.assertEqual(len(texts), len(set(texts)))

    def test_strikes_and_detonations_carry_no_joke(self):
        for fixture, seed, _, script in self.cases():
            for shot in script["shots"]:
                if shot.get("event_type") in ("nuclear_detonation", "military_strike"):
                    self.assertNotIn("notification", shot, (fixture, seed))

    def test_no_casualty_figures_and_a_film_under_fifty_seconds(self):
        for fixture, seed, _, script in self.cases():
            with self.subTest(fixture=fixture, seed=seed):
                text = " ".join(s["narration"] for s in script["shots"])
                self.assertNotRegex(text.lower(), r"\b(dead|deaths|killed|injured|casualties)\b")
                self.assertLessEqual(len(script["shots"]), 1 + film.MAX_EVENT_SHOTS)
                seconds = sum(len(s["narration"].split()) * film.SECONDS_PER_WORD + film.SHOT_OVERHEAD
                              for s in script["shots"]) + film.OUTRO
                self.assertLess(seconds, 50)
                self.assertTrue(all(len(s["narration"].split()) <= 22 for s in script["shots"]))

    def test_two_runs_of_the_same_starter_make_different_films(self):
        a = film.build(result_for("tsunami", 1), "satirical")
        b = film.build(result_for("tsunami", 2), "satirical")
        self.assertNotEqual([s["narration"] for s in a["shots"]], [s["narration"] for s in b["shots"]])

    def test_the_film_is_labelled_fictional_and_names_its_seed(self):
        script = film.build(result_for("iceland-eruption", 5), "satirical")
        self.assertIn("seed 5", script["disclaimer"])
        self.assertIn("invented", script["disclaimer"])
        self.assertEqual(script["source"]["seed"], 5)

    def test_the_map_shows_the_runs_places(self):
        result = result_for("global-pandemic", 8)
        script = film.build(result, "satirical")
        self.assertEqual([p["name"] for p in script["map"]["places"]],
                         list(dict.fromkeys(e["location"]["name"] for e in result["events"])))
        self.assertTrue(script["map"]["countries"])


if __name__ == "__main__":
    unittest.main()
