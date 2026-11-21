"""Director <-> simulation: --sim reads /snapshot and posts to /events.

Uses a tiny stdlib HTTP server that behaves like services/simulation, and,
when SIM-001 is present, the real engine.
"""

import json
import socket
import subprocess
import sys
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DIRECTOR = ROOT / "services" / "director"
SIMULATION = ROOT / "services" / "simulation"
sys.path.insert(0, str(DIRECTOR))

from worlddirector import DirectorError, generate, get_snapshot, post_batch  # noqa: E402

try:
    sys.path.insert(0, str(SIMULATION))
    from worldsim_sim import Simulation  # noqa: E402
except Exception:  # pragma: no cover - SIM-001 not merged yet, or its deps missing
    Simulation = None


def applied(batch):
    return {**batch, "events": [{**e, "status": "applied"} for e in batch["events"]]}


class FakeSim:
    """Holds a snapshot; /events marks every event applied and appends it."""

    def __init__(self, snapshot):
        self.snapshot = snapshot
        self.posted = []
        sim = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def _send(self, code, body):
                data = json.dumps(body).encode()
                self.send_response(code)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def do_GET(self):
                if self.path == "/snapshot":
                    self._send(200, sim.snapshot)
                else:
                    self._send(404, {"detail": "not found"})

            def do_POST(self):
                batch = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                sim.posted.append(batch)
                if batch.get("simulation_id") != sim.snapshot["simulation_id"]:
                    self._send(422, {"detail": "simulation_id mismatch"})
                    return
                out = applied(batch)
                sim.snapshot["events"].extend(out["events"])
                self._send(200, {"batch": out, "rejections": []})

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def close(self):
        self.server.shutdown()
        self.server.server_close()


def day1_snapshot():
    batch = applied(generate(fixture="japan-earthquake"))
    return {
        "schema_version": "0.1",
        "simulation_id": batch["simulation_id"],
        "branch_id": batch["branch_id"],
        "sim_time_minutes": 2040,
        "kind": "snapshot",
        "playback": {"state": "paused", "speed": 1},
        "events": batch["events"],
    }


class SimClientTest(unittest.TestCase):
    def setUp(self):
        self.sim = FakeSim(day1_snapshot())
        self.addCleanup(self.sim.close)

    def test_continue_from_snapshot_and_post(self):
        batch = generate(fixture="japan-earthquake-day3", history=get_snapshot(self.sim.url))
        result = post_batch(batch, self.sim.url)
        self.assertEqual([e["id"] for e in result["batch"]["events"]], ["evt-0007", "evt-0008", "evt-0009", "evt-0010"])
        self.assertTrue(all(e["status"] == "applied" for e in result["batch"]["events"]))

    def test_cli_sim_flag(self):
        proc = subprocess.run(
            [sys.executable, "-m", "worlddirector", "--fixture", "japan-earthquake-day3", "--sim", self.sim.url],
            cwd=DIRECTOR, capture_output=True, text=True,
        )
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("simulation applied 4 of 4 events", proc.stderr)
        self.assertEqual(json.loads(proc.stdout)["batch"]["simulation_id"], "demo-japan-earthquake")
        self.assertEqual(len(self.sim.posted), 1)

    def test_http_error_is_reported(self):
        batch = generate(fixture="global-pandemic")  # different simulation_id -> 422
        with self.assertRaises(DirectorError) as ctx:
            post_batch(batch, self.sim.url)
        self.assertEqual(ctx.exception.code, "sim_error")
        self.assertIn("mismatch", ctx.exception.detail)

    def test_unreachable(self):
        with socket.socket() as s:
            s.bind(("127.0.0.1", 0))
            port = s.getsockname()[1]  # closed again before use, so nothing listens
        with self.assertRaises(DirectorError) as ctx:
            get_snapshot(f"http://127.0.0.1:{port}", timeout_s=2)
        self.assertEqual(ctx.exception.code, "sim_unreachable")


@unittest.skipIf(Simulation is None, "needs services/simulation (SIM-001) and its requirements")
class RealEngineTest(unittest.TestCase):
    def test_director_batches_apply_in_the_engine(self):
        day1 = generate(fixture="japan-earthquake")
        sim = Simulation(simulation_id=day1["simulation_id"], branch_id=day1["branch_id"])
        _, rejected = sim.ingest(day1)
        self.assertEqual(rejected, [])
        while sim.now < 2040:
            sim.advance(60)
        _, rejected = sim.ingest(generate(fixture="japan-earthquake-day3", history=sim.snapshot()))
        self.assertEqual(rejected, [])
        self.assertEqual(len(sim.timeline), 10)

    def test_pandemic_applies_in_the_engine(self):
        batch = generate(fixture="global-pandemic")
        sim = Simulation(simulation_id=batch["simulation_id"], branch_id=batch["branch_id"])
        _, rejected = sim.ingest(batch)
        self.assertEqual(rejected, [])


if __name__ == "__main__":
    unittest.main()
