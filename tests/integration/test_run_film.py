"""The run recap film follows its run: same events, same order, same places, nothing added.

experiments/recap-films/films/run/make-script.py turns a run's canonical result
(GET /scenarios/{id}/result) into the film's script. These checks hold for every
starter and many seeds, so they hold for whatever run a viewer just watched.
"""

import importlib.util
import re
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / "services" / "director"), str(ROOT / "services" / "newsroom")]

from worlddirector import RUN_FIXTURES, headline_events, prepare_scenario  # noqa: E402

spec = importlib.util.spec_from_file_location("run_film", ROOT / "experiments/recap-films/films/run/make-script.py")
film = importlib.util.module_from_spec(spec)
spec.loader.exec_module(film)

audio_spec = importlib.util.spec_from_file_location(
    "run_audio", ROOT / "experiments/recap-films/films/run/make-audio.py"
)
audio = importlib.util.module_from_spec(audio_spec)
audio_spec.loader.exec_module(audio)

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
                yield fixture, seed, result, film.build(result)

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
                    self.assertEqual(shot["country"], event["location"]["country"])

    def test_narration_names_countries_when_the_location_changes(self):
        for fixture, seed, _, script in self.cases():
            with self.subTest(fixture=fixture, seed=seed):
                previous_country = None
                for shot in script["shots"]:
                    country = shot["country"]
                    if country != previous_country:
                        self.assertRegex(shot["narration"], rf"^In (the )?{re.escape(country)}[,.]")
                    self.assertNotIn("notification", shot)
                    self.assertNotIn("prop", shot)
                    previous_country = country

    def test_no_casualty_figures_and_a_film_under_fifty_seconds(self):
        for fixture, seed, result, script in self.cases():
            with self.subTest(fixture=fixture, seed=seed):
                text = " ".join(s["narration"] for s in script["shots"])
                self.assertNotRegex(text.lower(), r"\b(dead|deaths|killed|injured|casualties)\b")
                headline_ids = {event["id"] for event in headline_events(result["events"])}
                self.assertTrue(all(shot["event_id"] in headline_ids for shot in script["shots"]))
                self.assertGreaterEqual(len(script["shots"]), min(5, len(headline_ids)))
                self.assertLessEqual(len(script["shots"]), 6)
                seconds = sum(len(s["narration"].split()) * film.SECONDS_PER_WORD + film.SHOT_OVERHEAD
                              for s in script["shots"]) + film.OUTRO
                self.assertLess(seconds, 50)
                self.assertTrue(all(len(s["narration"].split()) <= 38 for s in script["shots"]))

    def test_two_runs_of_the_same_starter_make_different_films(self):
        a = film.build(result_for("tsunami", 1))
        b = film.build(result_for("tsunami", 2))
        self.assertNotEqual([s["narration"] for s in a["shots"]], [s["narration"] for s in b["shots"]])

    def test_iceland_recap_pairs_the_ash_closure_with_departures(self):
        script = film.build(result_for("iceland-eruption", 42))
        departures = [s for s in script["shots"] if s["scene"] == "departures"]
        self.assertEqual(len(departures), 1)
        self.assertIn("closes North Atlantic airspace", departures[0]["narration"])
        self.assertEqual(departures[0]["country"], "United Kingdom")
        self.assertLessEqual(sum("Short read, long wait." in s["narration"] for s in script["shots"]), 1)
        contamination = next(e for e in result_for("iceland-eruption", 42)["events"] if e["type"] == "contamination")
        detail = film.event_detail(contamination)
        self.assertEqual(film.scene_for(contamination, detail)[0], "map")
        self.assertIn("volcanic gas plume", detail)

    def test_short_narration_gets_a_forty_second_cut_without_extra_shots(self):
        cuts = audio.shot_cuts([1.4, 2.2, 3.0, 4.2, 2.5], film.OUTRO)
        self.assertEqual(len(cuts), 6)
        self.assertGreaterEqual(cuts[-1] + film.OUTRO, 40.0)
        self.assertEqual(cuts, sorted(cuts))

    def test_seed_stays_in_the_run_metadata(self):
        script = film.build(result_for("iceland-eruption", 5))
        self.assertNotIn("disclaimer", script)
        self.assertEqual(script["source"]["seed"], 5)

    def test_the_map_shows_the_runs_places(self):
        result = result_for("global-pandemic", 8)
        script = film.build(result)
        self.assertEqual([p["name"] for p in script["map"]["places"]],
                         list(dict.fromkeys(e["location"]["name"] for e in result["events"])))
        self.assertTrue(script["map"]["countries"])


if __name__ == "__main__":
    unittest.main()
