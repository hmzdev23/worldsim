"""Tone per run and the satire endpoints (local experiment).

GET /satire and GET /scenarios/{id}/satire follow the clock: pause, seek,
replay and reset always return the satire for released events only.
"""

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
    from worlddirector import load_fixture  # noqa: F401
except ImportError:  # pragma: no cover
    TestClient = None

JAPAN = ROOT / "contracts" / "fixtures" / "japan-earthquake.json"


class RecordingDirector:
    """The real Director with its offline Iceland fixture; records the tone it was asked for."""

    def __init__(self):
        self.tones = []

    def __call__(self, prompt, *, fixture, simulation_id, branch_id, timeout_s, tone="straight"):
        self.tones.append(tone)
        return director_generator(prompt, fixture="iceland-eruption", simulation_id=simulation_id,
                                  branch_id=branch_id, timeout_s=timeout_s, tone=tone)


@unittest.skipIf(TestClient is None, "needs simulation requirements")
class SatireRouteTests(unittest.TestCase):
    def setUp(self):
        import json
        self.director = RecordingDirector()
        self.registry = ScenarioRegistry(self.director, timeout_s=5)
        self.demo = Simulation.from_batch(json.loads(JAPAN.read_text(encoding="utf-8")), state="paused")
        self.demo.seek(401)
        self.client = TestClient(create_app(self.demo, tick_seconds=3600, scenarios=self.registry))
        self.client.__enter__()
        self.addCleanup(self.client.__exit__, None, None, None)

    def ready(self, **body):
        response = self.client.post("/scenarios", json={"prompt": "A fissure eruption near Grindavik", **body})
        self.assertEqual(response.status_code, 202, response.text)
        run_id = response.json()["id"]
        for _ in range(400):
            run = self.client.get(f"/scenarios/{run_id}").json()
            if run["status"] != "generating":
                break
            time.sleep(.01)
        self.assertEqual(run["status"], "ready", run)
        return run

    def test_tone_is_stored_and_passed_to_the_director(self):
        run = self.ready(tone="satirical")
        self.assertEqual(run["tone"], "satirical")
        self.assertEqual(self.director.tones, ["satirical"])
        self.assertEqual(self.ready()["tone"], "straight")  # default keeps the original experience

    def test_bad_tone_is_rejected(self):
        response = self.client.post("/scenarios", json={"prompt": "x", "tone": "spicy"})
        self.assertEqual(response.status_code, 422)

    def test_run_satire_follows_seek_and_replay(self):
        run = self.ready(tone="satirical")
        path = f"/scenarios/{run['id']}/satire"
        sim = self.registry.get(run["id"]).channel.sim
        self.assertEqual(self.client.get(path).json()["items"], [])  # paused before the first event
        sim.seek(sim.end_minutes)
        full = self.client.get(path).json()
        self.assertEqual((full["tone"], len(full["items"])), ("satirical", 8))
        self.assertEqual(full["simulation_id"], run["id"])
        sim.seek(sim.timeline[2]["sim_time_minutes"])
        partial = self.client.get(path).json()
        self.assertEqual(partial["items"], full["items"][-3:])  # same copy for the same moment
        self.client.post(f"/scenarios/{run['id']}/control", json={"action": "replay"})
        self.assertEqual(self.client.get(path).json()["items"], [])
        self.assertEqual(self.client.get(path, params={"tone": "straight"}).json()["items"], [])
        self.assertEqual(self.client.get(path, params={"tone": "nope"}).status_code, 422)

    def test_satire_does_not_change_the_simulation(self):
        run = self.ready(tone="satirical")
        sim = self.registry.get(run["id"]).channel.sim
        sim.seek(sim.end_minutes)
        before = self.client.get(f"/scenarios/{run['id']}/timeline").json()
        self.client.get(f"/scenarios/{run['id']}/satire")
        self.assertEqual(self.client.get(f"/scenarios/{run['id']}/timeline").json(), before)

    def test_demo_satire(self):
        body = self.client.get("/satire").json()
        self.assertEqual((body["tone"], body["items"]), ("satirical", []))  # demo starts before the quake
        self.demo.seek(self.demo.end_minutes)
        body = self.client.get("/satire", params={"tone": "satirical"}).json()
        self.assertEqual(len(body["items"]), len(self.demo.timeline))
        self.assertTrue(body["posts"] and body["absurdity"])


if __name__ == "__main__":
    unittest.main()
