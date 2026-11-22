"""Open-ended runs: a new seed per run, one canonical result, and no game routes."""

import sys
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / "services" / "simulation"), str(ROOT / "services" / "director")]

from worldsim_sim import Simulation  # noqa: E402

try:
    from fastapi.testclient import TestClient
    from worldsim_sim.scenarios import ScenarioRegistry, director_generator
    from worldsim_sim.server import create_app
except ImportError:  # pragma: no cover
    TestClient = None

JAPAN = ROOT / "contracts" / "fixtures" / "japan-earthquake.json"


@unittest.skipIf(TestClient is None, "needs simulation requirements")
class OpenEndedRunTests(unittest.TestCase):
    def setUp(self, seeds=None):
        import json
        self.registry = ScenarioRegistry(director_generator, timeout_s=5, max_runs=40, seeds=seeds)
        demo = Simulation.from_batch(json.loads(JAPAN.read_text(encoding="utf-8")), state="paused")
        self.client = TestClient(create_app(demo, tick_seconds=3600, scenarios=self.registry))
        self.client.__enter__()
        self.addCleanup(self.client.__exit__, None, None, None)

    def ready(self, **body):
        response = self.client.post("/scenarios", json={"prompt": "A tsunami crosses the Pacific", "fixture": "tsunami", **body})
        self.assertEqual(response.status_code, 202, response.text)
        run_id = response.json()["id"]
        for _ in range(500):
            run = self.client.get(f"/scenarios/{run_id}").json()
            if run["status"] != "generating":
                break
            time.sleep(.01)
        self.assertEqual(run["status"], "ready", run)
        return run

    def test_each_run_gets_its_own_seed_and_a_different_future(self):
        runs = [self.ready() for _ in range(4)]
        self.assertEqual(len({r["seed"] for r in runs}), 4)
        timelines = set()
        for run in runs:
            events = self.client.get(f"/scenarios/{run['id']}/timeline").json()["events"]
            timelines.add(tuple((e["type"], e["sim_time_minutes"], e["severity"]) for e in events))
        self.assertEqual(len(timelines), 4)

    def test_a_client_cannot_choose_or_repeat_a_seed(self):
        first = self.ready(seed=123)
        second = self.ready(seed=123)
        self.assertNotEqual(first["seed"], second["seed"])

    def test_result_is_the_canonical_run(self):
        run = self.ready(tone="satirical")
        result = self.client.get(f"/scenarios/{run['id']}/result").json()
        timeline = self.client.get(f"/scenarios/{run['id']}/timeline").json()
        self.assertEqual(result["seed"], run["seed"])
        self.assertEqual(result["simulation_id"], run["id"])
        self.assertEqual(result["prompt"], "A tsunami crosses the Pacific")
        self.assertEqual(result["tone"], "satirical")
        self.assertEqual(result["events"], timeline["events"])
        self.assertEqual(result["end_minutes"], timeline["end_minutes"])

    def test_result_includes_events_the_clock_has_not_reached(self):
        run = self.ready()
        result = self.client.get(f"/scenarios/{run['id']}/result").json()
        snapshot = self.client.get(f"/scenarios/{run['id']}/snapshot").json()
        self.assertGreater(len(result["events"]), len(snapshot["events"]))

    def test_result_waits_for_a_ready_run(self):
        self.assertEqual(self.client.get("/scenarios/run-missing/result").status_code, 404)

    def test_starters(self):
        body = self.client.get("/starters").json()
        self.assertEqual(len(body["starters"]), 10)
        self.assertEqual(body["label"], "FICTIONAL SIMULATION")

    def test_game_routes_are_gone(self):
        run = self.ready()
        for path in ("/player/scenarios", f"/scenarios/{run['id']}/player", f"/scenarios/{run['id']}/summary"):
            self.assertEqual(self.client.get(path).status_code, 404, path)
        self.assertEqual(self.client.post(f"/scenarios/{run['id']}/decisions", json={}).status_code, 404)
        self.assertNotIn("mode", run)
        self.assertNotIn("role", run)


@unittest.skipIf(TestClient is None, "needs simulation requirements")
class FixedReplayTests(OpenEndedRunTests):
    """`seeds=lambda: None` replays fixtures exactly (deterministic browser tests only)."""

    def setUp(self):
        super().setUp(seeds=lambda: None)

    def test_each_run_gets_its_own_seed_and_a_different_future(self):
        runs = [self.ready() for _ in range(2)]
        self.assertEqual([r["seed"] for r in runs], [None, None])

    def test_a_client_cannot_choose_or_repeat_a_seed(self):
        self.assertIsNone(self.ready(seed=5)["seed"])


if __name__ == "__main__":
    unittest.main()
