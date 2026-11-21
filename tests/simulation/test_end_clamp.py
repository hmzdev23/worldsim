"""SIM-003 checks (#42): playback stops at the scenario end.

At high speed one tick can cover hundreds of sim minutes. The clock must stop
at `end_minutes` (the last applied event), pause there, and still release every
event exactly once, so the final clock and snapshot both read the scenario end.
"""

import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CONTRACTS = ROOT / "contracts"
sys.path.insert(0, str(ROOT / "services" / "simulation"))

from worldsim_sim import Simulation, replay  # noqa: E402

try:
    from fastapi.testclient import TestClient
    from worldsim_sim.server import create_app
except ImportError:  # pragma: no cover
    TestClient = None

FIXTURES = {
    "canonical": CONTRACTS / "fixtures" / "japan-earthquake.json",
    "multi-day": Path(__file__).resolve().parent / "fixtures" / "multi-day.json",
}


def load(path):
    return json.loads(path.read_text(encoding="utf-8"))


def single_event_batch():
    batch = load(FIXTURES["canonical"])
    return {**batch, "events": batch["events"][:1]}


def empty_batch():
    return {**load(FIXTURES["canonical"]), "events": []}


def batches():
    yield from ((name, load(path)) for name, path in FIXTURES.items())
    yield "single", single_event_batch()
    yield "empty", empty_batch()


def play_to_end(sim, step):
    """Advance until playback stops; return every message."""
    messages = []
    for _ in range(100_000):
        if sim.state != "playing":
            return messages
        messages.extend(sim.advance(step))
    raise AssertionError("playback never stopped")


class EndClampTests(unittest.TestCase):
    def test_advancing_never_passes_the_end_at_any_speed(self):
        # Steps chosen to overshoot: at 4× and 60 sim min per tick the Japan demo
        # used to stop at DAY 4 · 09:50 instead of 06:20 (minute 4700).
        for name, batch in batches():
            for speed in (1, 4, 16):
                for step in (1, 7, 60, 240):
                    with self.subTest(fixture=name, speed=speed, step=step):
                        sim = Simulation.from_batch(batch, speed=speed)
                        end = sim.end_minutes
                        messages = play_to_end(sim, step)
                        clocks = [m for m in messages if m["kind"] == "clock"]
                        self.assertTrue(all(m["sim_time_minutes"] <= end for m in messages))
                        released = [m["event"]["id"] for m in messages if m["kind"] == "event"]
                        self.assertEqual(released, [e["id"] for e in sim.timeline])
                        self.assertEqual(len(released), len(set(released)))
                        self.assertEqual(clocks[-1]["sim_time_minutes"], end)
                        self.assertEqual(clocks[-1]["playback"]["state"], "paused")
                        self.assertEqual((sim.now, sim.sim_time), (end, float(end)))
                        snap = sim.snapshot()
                        self.assertEqual(snap["sim_time_minutes"], end)
                        self.assertEqual([e["id"] for e in snap["events"]], released)
                        # More ticks change nothing.
                        self.assertEqual(sim.advance(1440), [sim.clock()])

    def test_end_values(self):
        self.assertEqual(Simulation.from_batch(load(FIXTURES["canonical"])).end_minutes, 4700)
        self.assertEqual(Simulation.from_batch(single_event_batch()).end_minutes, 402)
        self.assertEqual(Simulation.from_batch(empty_batch()).end_minutes, 0)

    def test_empty_timeline_stays_at_zero(self):
        sim = Simulation.from_batch(empty_batch())
        self.assertEqual(sim.advance(500), [sim.clock()])
        self.assertEqual((sim.now, sim.state), (0, "paused"))

    def test_play_at_the_end_pauses_again_without_moving(self):
        sim = Simulation.from_batch(load(FIXTURES["multi-day"]))
        play_to_end(sim, 240)
        sim.play()
        self.assertEqual(sim.advance(60), [sim.clock()])
        self.assertEqual((sim.now, sim.state), (sim.end_minutes, "paused"))

    def test_replay_after_the_end_plays_through_again(self):
        sim = Simulation.from_batch(load(FIXTURES["multi-day"]))
        first = [m["event"]["id"] for m in play_to_end(sim, 240) if m["kind"] == "event"]
        self.assertEqual(sim.seek(0)["events"], [])
        sim.play()
        again = [m["event"]["id"] for m in play_to_end(sim, 240) if m["kind"] == "event"]
        self.assertEqual(again, first)
        self.assertEqual(sim.now, sim.end_minutes)

    def test_seek_past_the_end_is_kept_and_does_not_move_back(self):
        sim = Simulation.from_batch(load(FIXTURES["multi-day"]))
        end = sim.end_minutes
        snap = sim.seek(end + 60)
        self.assertEqual(snap["sim_time_minutes"], end + 60)
        self.assertEqual(len(snap["events"]), len(sim.timeline))
        self.assertEqual(sim.advance(60), [sim.clock()])
        self.assertEqual((sim.now, sim.state), (end + 60, "paused"))

    def test_applying_a_later_event_extends_the_end(self):
        batch = single_event_batch()
        sim = Simulation.from_batch(batch)
        play_to_end(sim, 60)
        later = {**batch["events"][0], "id": "evt-later", "sim_time_minutes": 900,
                 "parent_ids": [batch["events"][0]["id"]]}
        _, rejected = sim.ingest({**batch, "events": [later]})
        self.assertEqual(rejected, [])
        self.assertEqual(sim.end_minutes, 900)
        sim.play()
        messages = play_to_end(sim, 60)
        self.assertEqual([m["event"]["id"] for m in messages if m["kind"] == "event"], ["evt-later"])
        self.assertEqual(sim.now, 900)

    def test_offline_replay_ends_at_the_end(self):
        for name, batch in batches():
            for speed in (1, 4, 16):
                with self.subTest(fixture=name, speed=speed):
                    messages = replay(batch, speed=speed, step_minutes=60)
                    end = max((e["sim_time_minutes"] for e in batch["events"]), default=0)
                    self.assertEqual(max(m["sim_time_minutes"] for m in messages), end)
                    self.assertEqual(messages[-1]["sim_time_minutes"], end)


@unittest.skipIf(TestClient is None, "pip install -r services/simulation/requirements.txt")
class EndClampServerTests(unittest.TestCase):
    def test_stream_stops_at_the_end_at_demo_speed(self):
        batch = load(FIXTURES["canonical"])
        sim = Simulation.from_batch(batch, state="paused")
        sim.seek(401)
        # Demo settings at 4×: 60 sim min per second → ~240 sim min per wall second.
        client = TestClient(create_app(sim, tick_seconds=0.01, minutes_per_second=6000))
        with client, client.websocket_connect("/stream") as ws:
            ws.receive_json()
            ws.send_json({"action": "speed", "speed": 4})
            ws.send_json({"action": "play"})
            seen, last = [], None
            for _ in range(5000):
                message = ws.receive_json()
                self.assertLessEqual(message["sim_time_minutes"], 4700)
                if message["kind"] == "event":
                    seen.append(message["event"]["id"])
                elif message["kind"] == "clock":
                    last = message
                    if message["playback"]["state"] == "paused" and seen:
                        break
            self.assertEqual(seen, [e["id"] for e in sim.timeline])
            self.assertEqual(last["sim_time_minutes"], 4700)
            snap = client.get("/snapshot").json()
            self.assertEqual((snap["sim_time_minutes"], snap["playback"]["state"]), (4700, "paused"))
            self.assertEqual(len(snap["events"]), len(seen))


if __name__ == "__main__":
    unittest.main()
