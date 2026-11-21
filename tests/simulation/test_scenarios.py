"""SIM-004 checks (#49): isolated scenario runs created from a prompt.

Runs use a stub Director that returns the Iceland eruption test fixture
(tests/director/fixtures/iceland-eruption.json) through the real Director
validator, so no model or credentials are needed. One test uses the real
Director callable with its offline `global-pandemic` fixture.
"""

import json
import sys
import threading
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "services" / "simulation"))
sys.path.insert(0, str(ROOT / "services" / "director"))

from worldsim_sim import Simulation  # noqa: E402

try:
    from fastapi.testclient import TestClient
    from starlette.websockets import WebSocketDisconnect
    from worldsim_sim.scenarios import ScenarioRegistry
    from worldsim_sim.server import create_app
except ImportError:  # pragma: no cover
    TestClient = None

try:
    from worlddirector import DirectorError, build_batch
    from worlddirector.director import MAX_FIXTURE_EVENTS
except ImportError:  # pragma: no cover
    build_batch = None

# DIR-005 (#54) moves this fixture into services/director/fixtures.
ICELAND = next(p for p in (ROOT / "services" / "director" / "fixtures" / "iceland-eruption.json",
                           ROOT / "tests" / "director" / "fixtures" / "iceland-eruption.json") if p.exists())
JAPAN = ROOT / "contracts" / "fixtures" / "japan-earthquake.json"


def load(path):
    return json.loads(path.read_text(encoding="utf-8"))


class StubDirector:
    """Stands in for the Director callable (#50). The prompt picks the behavior."""

    def __init__(self):
        self.calls = []
        self.release = threading.Event()
        self.release.set()

    def __call__(self, prompt, *, fixture, simulation_id, branch_id, timeout_s):
        self.calls.append((prompt, fixture, simulation_id, branch_id))
        self.release.wait(10)
        if prompt == "fail":
            raise DirectorError("codex_failed", "Codex exited with status 1", "secret model log")
        if prompt == "bad prompt":
            raise DirectorError("invalid_scenario", "scenario text is required")
        if prompt == "slow":
            time.sleep(1)
        if prompt == "crash":
            raise RuntimeError("boom")
        batch = build_batch(load(ICELAND), simulation_id=simulation_id, branch_id=branch_id,
                            source="fixture", max_events=MAX_FIXTURE_EVENTS)
        if prompt == "partial":
            batch["events"][-1]["parent_ids"] = ["evt-9999"]  # unknown cause: engine rejects it
        if prompt == "wrong id":
            batch["simulation_id"] = "someone-else"
        return batch


ICELAND_EVENTS = len(load(ICELAND)["events"])


@unittest.skipIf(TestClient is None or build_batch is None, "needs simulation requirements and services/director")
class ScenarioRunTests(unittest.TestCase):
    def setUp(self):
        self.director = StubDirector()
        self.registry = ScenarioRegistry(self.director, timeout_s=0.3, max_generating=2, max_runs=4)
        self.demo = Simulation.from_batch(load(JAPAN), state="paused")
        self.demo.seek(401)
        app = create_app(self.demo, tick_seconds=3600, scenarios=self.registry)
        self.client = TestClient(app)
        self.client.__enter__()

    def tearDown(self):
        self.director.release.set()
        self.client.__exit__(None, None, None)

    def create(self, prompt="A fissure eruption near Grindavik", **body):
        response = self.client.post("/scenarios", json={"prompt": prompt, **body})
        self.assertEqual(response.status_code, 202, response.text)
        return response.json()

    def wait(self, run_id, until=("ready", "failed")):
        for _ in range(400):
            body = self.client.get(f"/scenarios/{run_id}").json()
            if body["status"] in until:
                return body
            time.sleep(0.01)
        self.fail(f"run {run_id} stuck in {body['status']}")

    def ready_run(self, prompt="A fissure eruption near Grindavik"):
        run = self.wait(self.create(prompt)["id"])
        self.assertEqual(run["status"], "ready", run)
        return run

    def play_to_end(self, ws, run):
        """Play over WebSocket with POST-driven ticks; return released event messages."""
        ws.send_json({"action": "speed", "speed": 16})
        self.assertEqual(ws.receive_json()["kind"], "clock")
        ws.send_json({"action": "play"})
        self.assertEqual(ws.receive_json()["playback"]["state"], "playing")
        sim = self.registry.get(run["id"]).channel.sim
        events = []
        while sim.state == "playing":
            for message in sim.advance(60):  # what the ticker does, deterministically
                if message["kind"] == "event":
                    events.append(message)
        return events

    # ---- lifecycle ---------------------------------------------------------

    def test_create_returns_generating_then_ready_and_paused(self):
        self.director.release.clear()
        created = self.create()
        self.assertEqual(created["status"], "generating")
        self.assertRegex(created["id"], r"^run-[0-9a-f]{10}$")
        self.assertEqual((created["simulation_id"], created["branch_id"]), (created["id"], "main"))
        self.assertEqual(self.client.get(f"/scenarios/{created['id']}/timeline").status_code, 409)
        self.director.release.set()
        run = self.wait(created["id"])
        self.assertEqual(run["status"], "ready")
        self.assertEqual(run["title"], "A fissure eruption near Grindavik")
        self.assertEqual(run["playback"], {"state": "paused", "speed": 1})
        self.assertEqual(run["event_count"], ICELAND_EVENTS)
        first = load(ICELAND)["events"][0]["sim_time_minutes"]
        self.assertEqual((run["start_minutes"], run["sim_time_minutes"]), (first - 1, first - 1))
        self.assertEqual(self.director.calls[0][2:], (created["id"], "main"))

    def test_timeline_is_this_runs_non_japan_events_in_canonical_order(self):
        run = self.ready_run()
        body = self.client.get(f"/scenarios/{run['id']}/timeline").json()
        self.assertEqual(body["simulation_id"], run["id"])
        self.assertEqual(len(body["events"]), ICELAND_EVENTS)
        keys = [(e["sim_time_minutes"], e["sequence"]) for e in body["events"]]
        self.assertEqual(keys, sorted(keys))
        self.assertEqual(body["end_minutes"], keys[-1][0])
        self.assertNotIn("JPN", {e["location"]["country_code"] for e in body["events"]})
        self.assertTrue(all(e["status"] == "applied" for e in body["events"]))
        self.assertEqual(self.client.get(f"/scenarios/{run['id']}/snapshot").json()["events"], [])

    def test_run_plays_clamps_at_its_end_seeks_and_replays(self):
        run = self.ready_run()
        timeline = self.client.get(f"/scenarios/{run['id']}/timeline").json()
        ids = [e["id"] for e in timeline["events"]]
        with self.client.websocket_connect(f"/scenarios/{run['id']}/stream") as ws:
            first = ws.receive_json()
            self.assertEqual((first["kind"], first["simulation_id"], first["events"]), ("snapshot", run["id"], []))
            released = self.play_to_end(ws, run)
            self.assertEqual([m["event"]["id"] for m in released], ids)
            self.assertTrue(all(m["simulation_id"] == run["id"] for m in released))
            end = self.client.get(f"/scenarios/{run['id']}/snapshot").json()
            self.assertEqual((end["sim_time_minutes"], end["playback"]["state"]), (timeline["end_minutes"], "paused"))
            self.assertEqual(len(end["events"]), len(ids))

            ws.send_json({"action": "seek", "sim_time_minutes": run["start_minutes"] + 1})
            snap = ws.receive_json()
            self.assertEqual([e["id"] for e in snap["events"]], ids[:1])
            ws.send_json({"action": "replay"})
            snap = ws.receive_json()
            self.assertEqual((snap["kind"], snap["sim_time_minutes"], snap["events"]), ("snapshot", 0, []))
            again = self.play_to_end(ws, run)
            self.assertEqual([m["event"]["id"] for m in again], ids)

    def test_two_runs_and_the_demo_are_isolated(self):
        a, b = self.ready_run("first"), self.ready_run("second")
        self.assertNotEqual(a["id"], b["id"])
        sim_b = self.registry.get(b["id"]).channel.sim
        with self.client.websocket_connect(f"/scenarios/{a['id']}/stream") as wa, \
                self.client.websocket_connect(f"/scenarios/{b['id']}/stream") as wb:
            wa.receive_json(), wb.receive_json()
            self.play_to_end(wa, a)
            # B never moved and never heard from A.
            self.assertEqual((sim_b.now, sim_b.state, sim_b.speed), (b["start_minutes"], "paused", 1))
            self.assertEqual(self.client.get(f"/scenarios/{b['id']}/snapshot").json()["events"], [])
            # Resetting B leaves A at its end.
            self.client.post(f"/scenarios/{b['id']}/control", json={"action": "replay"})
            snap_b = wb.receive_json()
            self.assertEqual((snap_b["simulation_id"], snap_b["sim_time_minutes"]), (b["id"], 0))
            a_now = self.client.get(f"/scenarios/{a['id']}").json()
            self.assertEqual(a_now["sim_time_minutes"], a_now["end_minutes"])
            # A's socket only ever sees A.
            self.client.post(f"/scenarios/{a['id']}/control", json={"action": "pause"})
            self.assertEqual(wa.receive_json()["simulation_id"], a["id"])
        # The Japan demo is untouched.
        self.assertEqual((self.demo.now, self.demo.state), (401, "paused"))
        self.assertEqual(self.client.get("/snapshot").json()["simulation_id"], "demo-japan-earthquake")

    # ---- news --------------------------------------------------------------

    def test_news_covers_released_events_only(self):
        run = self.ready_run()
        url = f"/scenarios/{run['id']}/news"
        body = self.client.get(url).json()
        self.assertEqual((body["simulation_id"], body["branch_id"], body["items"]), (run["id"], "main", []))
        self.assertEqual((body["schema_version"], body["sim_time_minutes"]), ("0.1", run["start_minutes"]))
        timeline = self.client.get(f"/scenarios/{run['id']}/timeline").json()["events"]
        middle = timeline[len(timeline) // 2]["sim_time_minutes"]
        self.client.post(f"/scenarios/{run['id']}/control", json={"action": "seek", "sim_time_minutes": middle})
        items = self.client.get(url).json()["items"]
        released = {e["id"] for e in timeline if e["sim_time_minutes"] <= middle}
        self.assertTrue(items)
        self.assertTrue({i["event_id"] for i in items} <= released)
        self.assertTrue(all(i["sim_time_minutes"] <= middle for i in items))
        self.assertNotIn("japan", json.dumps(items).lower())
        self.client.post(f"/scenarios/{run['id']}/control", json={"action": "seek", "sim_time_minutes": 99999})
        self.assertGreater(len(self.client.get(url).json()["items"]), len(items))

    # ---- failure and retry --------------------------------------------------

    def assert_failed(self, prompt, code, state, retryable=True):
        run = self.wait(self.create(prompt)["id"])
        self.assertEqual(run["status"], "failed")
        error = run["error"]
        self.assertEqual(set(error), {"error", "state", "retryable", "status", "message"})
        self.assertEqual((error["error"], error["state"], error["retryable"]), (code, state, retryable))
        self.assertTrue(error["message"])
        self.assertNotIn("secret", json.dumps(run))
        for path in ("timeline", "snapshot", "news"):
            self.assertEqual(self.client.get(f"/scenarios/{run['id']}/{path}").status_code, 409)
        with self.assertRaises(WebSocketDisconnect) as ctx:
            with self.client.websocket_connect(f"/scenarios/{run['id']}/stream") as ws:
                ws.receive_json()
        self.assertEqual(ctx.exception.code, 4409)
        return run

    def test_director_failure_is_friendly_and_retry_makes_a_new_run(self):
        failed = self.assert_failed("fail", "codex_failed", "unavailable")
        self.assertIn("Try again", failed["error"]["message"])
        retry = self.ready_run()
        self.assertNotEqual(retry["id"], failed["id"])
        self.assertEqual(self.client.get(f"/scenarios/{failed['id']}").json()["status"], "failed")

    def test_failure_kinds(self):
        self.assert_failed("bad prompt", "invalid_scenario", "invalid_prompt", retryable=False)
        self.assert_failed("partial", "invalid_events", "invalid_output")  # never a partial run
        self.assert_failed("wrong id", "invalid_events", "invalid_output")
        self.assert_failed("crash", "internal_error", "unavailable")

    def test_generator_that_overruns_its_timeout_fails_the_run(self):
        self.registry.grace_s = 0  # the stub ignores timeout_s=0.3 and sleeps 1s
        self.assert_failed("slow", "codex_timeout", "timeout")

    def test_bounded_jobs_and_runs(self):
        self.director.release.clear()
        pending = [self.create("one")["id"], self.create("two")["id"]]
        response = self.client.post("/scenarios", json={"prompt": "three"})
        self.assertEqual(response.status_code, 429)
        self.director.release.set()
        for run_id in pending:
            self.wait(run_id)
        ids = [self.wait(self.create(p)["id"])["id"] for p in ("a", "b", "c", "d", "e")]
        # max_runs=4: the oldest finished runs were dropped, the newest are kept.
        self.assertEqual(self.client.get(f"/scenarios/{ids[0]}").status_code, 404)
        self.assertEqual(self.client.get(f"/scenarios/{ids[-1]}").json()["status"], "ready")

    def test_request_validation_and_unknown_runs(self):
        self.assertEqual(self.client.post("/scenarios", json={"prompt": "  "}).status_code, 422)
        self.assertEqual(self.client.post("/scenarios", json={"prompt": "x" * 2001}).status_code, 422)
        self.assertEqual(self.client.post("/scenarios", json={"prompt": 5}).status_code, 422)
        self.assertEqual(self.client.get("/scenarios/run-missing").status_code, 404)
        self.assertEqual(self.client.get("/scenarios/run-missing/timeline").status_code, 404)
        with self.assertRaises(WebSocketDisconnect) as ctx:
            with self.client.websocket_connect("/scenarios/run-missing/stream") as ws:
                ws.receive_json()
        self.assertEqual(ctx.exception.code, 4404)
        run = self.ready_run()
        response = self.client.post(f"/scenarios/{run['id']}/control", json={"action": "speed", "speed": 3})
        self.assertEqual(response.status_code, 422)


@unittest.skipIf(TestClient is None or build_batch is None, "needs simulation requirements and services/director")
class RealDirectorFixtureTests(unittest.TestCase):
    def test_server_fixture_mode_uses_the_real_director_offline(self):
        demo = Simulation.from_batch(load(JAPAN), state="paused")
        registry = ScenarioRegistry(fixture="global-pandemic")  # real director_generator, no model call
        with TestClient(create_app(demo, tick_seconds=3600, scenarios=registry)) as client:
            self.assertEqual(client.post("/scenarios", json={"prompt": ""}).status_code, 422)
            run = client.post("/scenarios", json={"prompt": "A new flu strain spreads"}).json()
            for _ in range(400):
                run = client.get(f"/scenarios/{run['id']}").json()
                if run["status"] != "generating":
                    break
                time.sleep(0.01)
            self.assertEqual(run["status"], "ready", run)
            self.assertEqual(run["title"], "A new flu strain spreads")
            events = client.get(f"/scenarios/{run['id']}/timeline").json()["events"]
            self.assertTrue(events)
            self.assertTrue(all(e["provenance"]["source"] == "fixture" for e in events))
            self.assertNotIn("JPN", {e["location"]["country_code"] for e in events})


if __name__ == "__main__":
    unittest.main()
