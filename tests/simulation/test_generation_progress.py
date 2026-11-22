"""Generation progress for scenario runs (#61 handoff to the simulation service).

While a run is `generating`, GET /scenarios/{id} reports the stage actually
running and how long it has taken. It never reports a percentage.
"""

import sys
import threading
import time
import types
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "services" / "simulation"))

from worldsim_sim import Simulation  # noqa: E402

try:
    from fastapi.testclient import TestClient
    from worldsim_sim import scenarios
    from worldsim_sim.scenarios import ScenarioRegistry, director_generator
    from worldsim_sim.server import create_app
except ImportError:  # pragma: no cover
    TestClient = None

FIXTURE = ROOT / "tests" / "simulation" / "fixtures" / "multi-day.json"


def batch_for(simulation_id):
    import json
    batch = json.loads(FIXTURE.read_text(encoding="utf-8"))
    return {**batch, "simulation_id": simulation_id}


class SteppingDirector:
    """Reports Director stages and waits at each one until the test lets it go on."""

    stages = ("prompt", "model", "parse", "validate")

    def __init__(self):
        self.go = {name: threading.Event() for name in self.stages}
        self.entered = {name: threading.Event() for name in self.stages}

    def __call__(self, prompt, *, fixture, simulation_id, branch_id, timeout_s, on_stage=None):
        for name in self.stages:
            on_stage(name)
            self.entered[name].set()
            self.go[name].wait(10)
        return batch_for(simulation_id)


def old_director(prompt, *, fixture, simulation_id, branch_id, timeout_s):
    """A generator without stage reporting, like the Director before #61."""
    if prompt == "fail":
        raise RuntimeError("boom")
    return batch_for(simulation_id)


@unittest.skipIf(TestClient is None, "fastapi/httpx not installed")
class GenerationProgressTests(unittest.TestCase):
    def client(self, generator):
        app = create_app(Simulation.from_batch(batch_for("demo"), state="paused"), tick_seconds=3600,
                         scenarios=ScenarioRegistry(generator, timeout_s=5))
        client = TestClient(app)
        client.__enter__()
        self.addCleanup(client.__exit__, None, None, None)
        return client

    def wait_for(self, client, run_id, check, timeout=5):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            status = client.get(f"/scenarios/{run_id}").json()
            if check(status):
                return status
            time.sleep(0.01)
        self.fail(f"never reached: {status}")

    def test_status_reports_each_real_stage_then_the_generation_time(self):
        director = SteppingDirector()
        client = self.client(director)
        created = client.post("/scenarios", json={"prompt": "A storm"}).json()
        self.assertEqual(created["status"], "generating")
        self.assertIn(created["stage"], ("queued", "starting", "prompt"))
        for name in director.stages:
            director.entered[name].wait(5)
            status = self.wait_for(client, created["id"], lambda s, n=name: s.get("stage") == n)
            self.assertEqual(status["status"], "generating")
            self.assertGreaterEqual(status["elapsed_s"], status["stage_elapsed_s"])
            self.assertNotIn("progress", status)  # no invented percentage
            director.go[name].set()
        ready = self.wait_for(client, created["id"], lambda s: s["status"] == "ready")
        self.assertNotIn("stage", ready)
        self.assertGreaterEqual(ready["generation_s"], 0)

    def test_generators_without_stages_still_work(self):
        client = self.client(old_director)
        run_id = client.post("/scenarios", json={"prompt": "A storm"}).json()["id"]
        ready = self.wait_for(client, run_id, lambda s: s["status"] != "generating")
        self.assertEqual(ready["status"], "ready")
        failed_id = client.post("/scenarios", json={"prompt": "fail"}).json()["id"]
        failed = self.wait_for(client, failed_id, lambda s: s["status"] != "generating")
        self.assertEqual(failed["status"], "failed")
        self.assertIn("generation_s", failed)
        self.assertNotIn("stage", failed)


@unittest.skipIf(TestClient is None, "fastapi/httpx not installed")
class DirectorGeneratorTests(unittest.TestCase):
    def fake_director(self, with_stages):
        seen = {}

        class Stages:
            def __init__(self, on_stage):
                self.on_stage = on_stage

        def prepare_scenario(prompt, *, fixture, simulation_id, branch_id, timeout_s, **kwargs):
            seen.update(kwargs)
            if "stages" in kwargs:
                kwargs["stages"].on_stage("model")
            return {"ok": True}

        module = types.SimpleNamespace(prepare_scenario=prepare_scenario)
        if with_stages:
            module.Stages = Stages
        return module, seen

    def test_passes_stages_when_the_director_supports_them(self):
        module, seen = self.fake_director(with_stages=True)
        heard = []
        with mock.patch.object(scenarios, "_import", return_value=module):
            director_generator("x", fixture=None, simulation_id="run-a", branch_id="main", timeout_s=5,
                               on_stage=heard.append)
        self.assertIn("stages", seen)
        self.assertEqual(heard, ["model"])

    def test_skips_stages_for_an_older_director(self):
        module, seen = self.fake_director(with_stages=False)
        with mock.patch.object(scenarios, "_import", return_value=module):
            director_generator("x", fixture=None, simulation_id="run-a", branch_id="main", timeout_s=5,
                               on_stage=lambda name: None)
        self.assertEqual(seen, {})


if __name__ == "__main__":
    unittest.main()
