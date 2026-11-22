"""DIR-006 (#61): run batches carry everything the map renderer needs, and stage timings.

Map-ready means each event has a known type, a valid location, a time, the
visual for its type, an origin where the type has one, and parent links that
point to earlier events. The renderer draws only from those fields: outbreak
pulses at reported locations, shockwaves at disaster locations, and an aid
route only when both ends are event locations. Nothing here invents spread
geometry or flight paths.
"""

import io
import json
import subprocess
import sys
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "services" / "director"))

from worlddirector import (  # noqa: E402
    EVENT_TYPES, RUN_FIXTURES, VISUALS, DirectorError, Stages, load_fixture, prepare_scenario,
)
from worlddirector.timing import main as timing_main  # noqa: E402

SHOCKWAVES = {"earthquake_shockwave", "ash_plume", "impact_blast", "missile_strike", "nuclear_blast",
              "weather_disaster"}


def batch(fixture):
    return prepare_scenario("A fictional scenario", simulation_id=f"run-{fixture}", fixture=fixture)


def route_start(events, aid):
    """Where an aid route can start: the latest earlier event located in the sender's country, or None.

    The same rule as apps/web/components/map-effects.ts.
    """
    origin = str(aid["payload"].get("origin", "")).strip().lower()
    if not origin or origin == "unknown":
        return None
    key = (aid["sim_time_minutes"], aid["sequence"])
    earlier = [e for e in events if (e["sim_time_minutes"], e["sequence"]) < key
               and e["location"]["country"].strip().lower() == origin]
    return earlier[-1] if earlier else None


class MapReadyTests(unittest.TestCase):
    def test_every_run_fixture_event_is_map_ready(self):
        for fixture in RUN_FIXTURES:
            events = batch(fixture)["events"]
            seen = {}
            for event in events:
                with self.subTest(fixture=fixture, event=event["id"]):
                    self.assertIn(event["type"], EVENT_TYPES)
                    self.assertEqual(event["visual"], VISUALS[event["type"]])
                    loc = event["location"]
                    self.assertTrue(-90 <= loc["lat"] <= 90 and -180 <= loc["lon"] <= 180)
                    self.assertTrue(loc["name"] and loc["country"] and len(loc["country_code"]) == 3)
                    self.assertIsInstance(event["sim_time_minutes"], int)
                    for parent in event["parent_ids"]:  # causal links point back in time
                        self.assertIn(parent, seen)
                        self.assertLess((seen[parent]["sim_time_minutes"], seen[parent]["sequence"]),
                                        (event["sim_time_minutes"], event["sequence"]))
                    if event["type"] == "international_aid":
                        self.assertTrue(event["payload"].get("origin"))
                    seen[event["id"]] = event

    def test_pandemic_gives_outbreak_pulses_at_reported_places_only(self):
        events = batch("global-pandemic")["events"]
        outbreaks = [e for e in events if e["visual"] == "contagion_spread"]
        self.assertEqual([e["location"]["name"] for e in outbreaks], ["Singapore", "London", "New York City"])
        for event in outbreaks:
            self.assertGreater(event["payload"]["radius_km"], 0)  # pulse scale comes from the event
            self.assertEqual(event["payload"]["pathogen"], "novel respiratory virus")
        # Later outbreaks name the first one as their cause, so "spread" is in the data.
        self.assertTrue(all(outbreaks[0]["id"] in e["parent_ids"] for e in outbreaks[1:]))

    def test_aid_route_only_when_both_ends_are_event_locations(self):
        pandemic = batch("global-pandemic")["events"]
        aid = next(e for e in pandemic if e["type"] == "international_aid")
        start = route_start(pandemic, aid)
        self.assertEqual((aid["payload"]["origin"], start["location"]["name"]), ("Germany", "Frankfurt"))

        iceland = batch("iceland-eruption")["events"]
        for aid in (e for e in iceland if e["type"] == "international_aid"):
            # Norway and Denmark have no event of their own, so no route is drawn.
            self.assertIsNone(route_start(iceland, aid), aid["payload"]["origin"])

    def test_disasters_give_shockwaves(self):
        visuals = {e["visual"] for f in RUN_FIXTURES for e in batch(f)["events"]}
        self.assertTrue({"earthquake_shockwave", "ash_plume"} <= visuals & SHOCKWAVES)
        self.assertIn("animated_transport_route", visuals)
        self.assertIn("contagion_spread", visuals)


def codex_runner(output):
    def run(cmd, **kw):
        Path(cmd[cmd.index("--output-last-message") + 1]).write_text(output, encoding="utf-8")
        return subprocess.CompletedProcess(cmd, 0, stdout="", stderr="")
    return run


class FakeClock:
    def __init__(self):
        self.now = 0.0

    def __call__(self):
        self.now += 0.5
        return self.now


class StageTimingTests(unittest.TestCase):
    def test_fixture_run_records_prompt_fixture_and_validate(self):
        starts = []
        stages = Stages(on_stage=starts.append, clock=FakeClock())
        timed = prepare_scenario("A fictional scenario", simulation_id="run-t", fixture="iceland-eruption",
                                 stages=stages)
        self.assertEqual(starts, ["prompt", "fixture", "validate"])
        self.assertEqual(stages.seconds, {"prompt": 0.5, "fixture": 0.5, "validate": 0.5})
        self.assertEqual(stages.to_json()["total_seconds"], 1.5)
        # Timing never changes the result.
        self.assertEqual(timed, prepare_scenario("A fictional scenario", simulation_id="run-t",
                                                 fixture="iceland-eruption"))

    @mock.patch("shutil.which", return_value="/usr/local/bin/codex")
    def test_model_run_separates_prompt_model_parse_and_validate(self, _):
        starts = []
        stages = Stages(on_stage=starts.append)
        raw = json.dumps(load_fixture("global-pandemic"))
        prepare_scenario("A new flu strain spreads", simulation_id="run-m", runner=codex_runner(raw), stages=stages)
        self.assertEqual(starts, ["prompt", "model", "parse", "validate"])
        self.assertTrue(all(seconds >= 0 for seconds in stages.seconds.values()))

    @mock.patch("shutil.which", return_value="/usr/local/bin/codex")
    def test_failed_stage_is_recorded_and_the_error_is_unchanged(self, _):
        stages = Stages()
        with self.assertRaises(DirectorError) as caught:
            prepare_scenario("A new flu strain spreads", simulation_id="run-f", runner=codex_runner("not json"),
                             stages=stages)
        self.assertEqual(caught.exception.code, "invalid_json")
        self.assertEqual(list(stages.seconds), ["prompt", "model", "parse"])

    def test_timing_cli_reports_runs_and_medians(self):
        out = io.StringIO()
        with redirect_stdout(out):
            code = timing_main(["A fictional scenario", "--runs", "2", "--fixture", "global-pandemic"])
        report = json.loads(out.getvalue())
        self.assertEqual(code, 0)
        self.assertEqual(len(report["runs"]), 2)
        self.assertEqual(set(report["median_seconds"]), {"prompt", "fixture", "validate"})
        self.assertTrue(all(run["error"] is None for run in report["runs"]))


if __name__ == "__main__":
    unittest.main()
