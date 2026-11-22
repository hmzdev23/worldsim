"""Eruptions happen only at real volcanoes, and the hazard sample scenarios load offline."""

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "services" / "director"))

from worlddirector import DirectorError, build_batch, generate, load_fixture  # noqa: E402
from worlddirector.director import MAX_FIXTURE_EVENTS  # noqa: E402
from worlddirector.volcanoes import MAX_DISTANCE_KM, VOLCANOES, nearest_volcano, volcano_at  # noqa: E402

# The scenarios the web app offers as samples, and the hazard each one opens with.
SAMPLES = {
    "japan-earthquake": "earthquake",
    "pacific-tsunami": "earthquake",
    "vesuvius-eruption": "volcanic_eruption",
    "iceland-eruption": "volcanic_eruption",
    "global-pandemic": "disease_outbreak",
}


def eruption_at(lat, lon, name="Somewhere"):
    raw = load_fixture("vesuvius-eruption")
    raw["events"][0]["location"].update(name=name, lat=lat, lon=lon)
    return build_batch(raw, simulation_id="volcano-check", max_events=MAX_FIXTURE_EVENTS)


class VolcanoListTests(unittest.TestCase):
    def test_list_is_well_formed(self):
        names = [v.name for v in VOLCANOES]
        self.assertEqual(len(names), len(set(names)))
        for v in VOLCANOES:
            self.assertTrue(-90 <= v.lat <= 90 and -180 <= v.lon <= 180, v)

    def test_lookup(self):
        self.assertEqual(volcano_at(40.82, 14.43).name, "Vesuvius")
        self.assertEqual(volcano_at(63.88, -22.27).country, "Iceland")
        self.assertIsNone(volcano_at(51.51, -0.13), "London has no volcano")
        _, km = nearest_volcano(48.86, 2.35)
        self.assertGreater(km, MAX_DISTANCE_KM)


class EruptionPlacementTests(unittest.TestCase):
    def test_eruption_near_a_volcano_is_accepted(self):
        batch = eruption_at(40.85, 14.27, "Naples")  # about 15 km from the summit
        self.assertEqual(batch["events"][0]["type"], "volcanic_eruption")

    def test_eruption_away_from_any_volcano_is_rejected(self):
        for lat, lon, place in ((45.46, 9.19, "Milan"), (40.71, -74.01, "New York"), (0.0, -30.0, "mid-Atlantic")):
            with self.assertRaises(DirectorError) as caught:
                eruption_at(lat, lon, place)
            self.assertIn("must be a known volcano", caught.exception.detail)
            self.assertIn("the nearest is", caught.exception.detail)

    def test_other_hazards_may_happen_anywhere(self):
        raw = load_fixture("global-pandemic")
        self.assertIsNone(volcano_at(raw["events"][0]["location"]["lat"], raw["events"][0]["location"]["lon"]))
        build_batch(raw, simulation_id="pandemic", max_events=MAX_FIXTURE_EVENTS)


class SampleScenarioTests(unittest.TestCase):
    def test_every_sample_loads_and_opens_with_its_hazard(self):
        for name, hazard in SAMPLES.items():
            batch = generate(fixture=name)
            self.assertEqual(batch["events"][0]["type"], hazard, name)
            for event in batch["events"]:
                if event["type"] == "volcanic_eruption":
                    self.assertIsNotNone(volcano_at(event["location"]["lat"], event["location"]["lon"]), name)

    def test_tsunami_crosses_the_ocean(self):
        events = generate(fixture="pacific-tsunami")["events"]
        warnings = [e for e in events if e["type"] == "tsunami_warning"]
        self.assertGreaterEqual(len({e["location"]["country_code"] for e in warnings}), 3)
        floods = [e for e in events if e["type"] == "flooding"]
        self.assertTrue(all(e["parent_ids"] for e in floods), "each flood follows its warning")


if __name__ == "__main__":
    unittest.main()
