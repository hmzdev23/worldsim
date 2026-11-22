"""SIM-005 checks (#58): scenario-relative playback pacing.

A scenario run moves 5% of its span (end_minutes - start_minutes) per clock
tick at 1x, so a seven-hour and a six-month scenario both play in 20 ticks.
Pacing only sets how far the clock moves: every event still releases at its
own sim_time_minutes, in canonical order, exactly once.
"""

import contextlib
import io
import json
import math
import sys
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FIXTURES = Path(__file__).resolve().parent / "fixtures"
sys.path.insert(0, str(ROOT / "services" / "simulation"))

from worldsim_sim import PACE_FRACTION, Simulation  # noqa: E402

try:
    from fastapi.testclient import TestClient
    from worldsim_sim.__main__ import build
    from worldsim_sim.scenarios import ScenarioRegistry
    from worldsim_sim.server import create_app
except ImportError:  # pragma: no cover
    TestClient = None


def load(name):
    return json.loads((FIXTURES / f"{name}.json").read_text(encoding="utf-8"))


PACED = ("multi-hour", "multi-month")


def paced(batch, *, start=None, pace=PACE_FRACTION, speed=1):
    """A playing, relatively paced simulation starting where a run would."""
    sim = Simulation.from_batch(batch, pace=pace, speed=speed, state="paused")
    first = sim.timeline[0]["sim_time_minutes"] if sim.timeline else 0
    sim.start_minutes = max(0, first - 1) if start is None else start
    sim.seek(sim.start_minutes)
    sim.play()
    return sim


def tick_to_end(sim, ticks=1.0, limit=10_000):
    """Tick until playback stops; return (messages, tick count)."""
    messages = []
    for count in range(limit):
        if sim.state != "playing":
            return messages, count
        messages.extend(sim.tick(ticks))
    raise AssertionError("playback never stopped")


def event_ids(messages):
    return [m["event"]["id"] for m in messages if m["kind"] == "event"]


class RelativePacingTests(unittest.TestCase):
    def test_any_length_plays_in_twenty_ticks_at_1x_and_fewer_when_faster(self):
        for name in PACED:
            for speed, expected in ((1, 20), (2, 10), (4, 5), (16, 2)):
                with self.subTest(fixture=name, speed=speed):
                    sim = paced(load(name), speed=speed)
                    span = sim.end_minutes - sim.start_minutes
                    self.assertAlmostEqual(sim.step_minutes, span * 0.05)
                    messages, ticks = tick_to_end(sim)
                    self.assertEqual(ticks, expected)
                    self.assertEqual((sim.now, sim.state), (sim.end_minutes, "paused"))
                    self.assertEqual(messages[-1], sim.clock())

    def test_events_keep_authored_times_order_and_release_once(self):
        for name in PACED:
            for speed in (1, 2, 4, 16):
                with self.subTest(fixture=name, speed=speed):
                    sim = paced(load(name), speed=speed)
                    timeline = sim.timeline
                    messages, _ = tick_to_end(sim)
                    released = [m for m in messages if m["kind"] == "event"]
                    # Every event, including same-minute ones crossed in one tick.
                    self.assertEqual(event_ids(released), [e["id"] for e in timeline])
                    for message in released:
                        self.assertEqual(message["sim_time_minutes"], message["event"]["sim_time_minutes"])
                    clocks = [m["sim_time_minutes"] for m in messages if m["kind"] == "clock"]
                    self.assertEqual(clocks, sorted(clocks))
                    self.assertLessEqual(max(clocks), sim.end_minutes)
                    # An event is emitted only once the clock has reached it.
                    clock = sim.start_minutes
                    for message in messages:
                        if message["kind"] == "clock":
                            clock = message["sim_time_minutes"]
                        else:
                            self.assertGreater(message["sim_time_minutes"], clock)

    def test_same_minute_events_cross_in_one_tick(self):
        sim = paced(load("multi-month"), speed=16)
        first = sim.tick()
        # Minute 1440 holds three events (sequence 0, 1, 2); all go in tick one.
        self.assertEqual(event_ids(first)[:3], ["evt-0001", "evt-0002", "evt-0003"])
        self.assertEqual([m["event"]["sequence"] for m in first[:3]], [0, 1, 2])

    def test_fractional_step_and_partial_ticks(self):
        sim = paced(load("multi-hour"))  # start 29, end 450: 5% of 421 = 21.05
        self.assertAlmostEqual(sim.step_minutes, 21.05)
        sim.tick()
        self.assertAlmostEqual(sim.sim_time, 50.05)
        self.assertEqual(sim.now, 50)
        halves = paced(load("multi-hour"))
        out = halves.tick(0.5) + halves.tick(0.5)
        self.assertEqual(halves.sim_time, sim.sim_time)
        self.assertEqual(event_ids(out), ["evt-0001", "evt-0002", "evt-0003"])
        self.assertEqual(halves.tick(0), [halves.clock()])
        self.assertAlmostEqual(halves.sim_time, 50.05)

    def test_late_wall_tick_counts_as_more_than_one_tick(self):
        once, twice = paced(load("multi-month")), paced(load("multi-month"))
        once.tick(2.5)
        twice.tick(1), twice.tick(1), twice.tick(0.5)
        self.assertAlmostEqual(once.sim_time, twice.sim_time)
        self.assertEqual(once.snapshot(), twice.snapshot())

    def test_pause_holds_the_clock(self):
        sim = paced(load("multi-hour"))
        sim.tick()
        sim.pause()
        before = sim.sim_time
        for _ in range(5):
            self.assertEqual(sim.tick(), [sim.clock()])
        self.assertEqual(sim.sim_time, before)

    def test_speed_change_mid_run(self):
        sim = paced(load("multi-month"))
        sim.tick(), sim.tick()  # 10% at 1x
        sim.set_speed(4)
        sim.tick()  # +20%
        self.assertAlmostEqual(sim.sim_time - sim.start_minutes, 0.30 * sim.span_minutes, places=3)
        _, ticks = tick_to_end(sim)
        self.assertEqual(ticks, 4)  # 70% left at 20% per tick

    def test_seek_and_replay_keep_the_pace_and_release_once(self):
        for name in PACED:
            with self.subTest(fixture=name):
                sim = paced(load(name))
                step = sim.step_minutes
                sim.tick(), sim.tick(), sim.tick()
                middle = sim.timeline[len(sim.timeline) // 2]["sim_time_minutes"]
                snapshot = sim.seek(middle)
                self.assertEqual(sim.step_minutes, step)  # the span ignores the clock
                seen = [e["id"] for e in snapshot["events"]]
                messages, _ = tick_to_end(sim)
                self.assertEqual(seen + event_ids(messages), [e["id"] for e in sim.timeline])

                replayed = sim.seek(0)  # replay
                sim.play()
                messages, ticks = tick_to_end(sim)
                self.assertEqual([e["id"] for e in replayed["events"]] + event_ids(messages),
                                 [e["id"] for e in sim.timeline])
                # From 0 the run is longer than its span, so it takes a few more ticks.
                self.assertEqual(ticks, math.ceil(sim.end_minutes / step - 1e-9))

    def test_seek_past_end_stays(self):
        sim = paced(load("multi-hour"))
        sim.seek(sim.end_minutes + 100)
        sim.play()
        self.assertEqual(sim.tick()[-1]["playback"]["state"], "paused")
        self.assertEqual(sim.now, sim.end_minutes + 100)

    def test_appended_later_event_lengthens_the_span(self):
        batch = load("multi-hour")
        sim = paced(batch)
        tick_to_end(sim)
        old_step = sim.step_minutes
        later = {**batch["events"][-1], "id": "evt-late", "sim_time_minutes": 871, "sequence": 0,
                 "status": "proposed", "parent_ids": ["evt-0001"]}
        _, rejected = sim.ingest({**batch, "events": [later]})
        self.assertEqual(rejected, [])
        self.assertAlmostEqual(sim.step_minutes, 0.05 * (871 - 29))
        self.assertGreater(sim.step_minutes, old_step)
        sim.play()
        messages, ticks = tick_to_end(sim)
        self.assertEqual(event_ids(messages), ["evt-late"])
        self.assertEqual((sim.now, ticks), (871, math.ceil((871 - 450) / sim.step_minutes)))

    def test_zero_length_and_empty_timelines(self):
        batch = load("multi-hour")
        same_minute = [{**e, "sim_time_minutes": 30, "sequence": i, "parent_ids": []}
                       for i, e in enumerate(batch["events"][:3])]
        cases = {  # label: (events, start_minutes)
            "empty": ([], None),
            "one event at minute 0": ([{**batch["events"][0], "sim_time_minutes": 0}], None),
            "all events at the start minute": (same_minute, 30),
        }
        for label, (events, start) in cases.items():
            with self.subTest(label):
                sim = paced({**batch, "events": events}, start=start)
                self.assertEqual(sim.span_minutes, 0)
                already = [e["id"] for e in sim.snapshot()["events"]]  # due at the start minute
                messages, ticks = tick_to_end(sim)
                self.assertLessEqual(ticks, 1)
                self.assertEqual(already + event_ids(messages), [e["id"] for e in sim.timeline])
                self.assertEqual((sim.now, sim.state), (sim.end_minutes, "paused"))

        # One minute of span still plays in 20 ticks; same-minute events go together.
        sim = paced({**batch, "events": same_minute})
        messages, ticks = tick_to_end(sim)
        self.assertEqual((sim.span_minutes, ticks), (1, 20))
        self.assertEqual(event_ids(messages), ["evt-0001", "evt-0002", "evt-0003"])

        # A span of 0 with the clock behind it (replay): one tick finishes it.
        sim = paced({**batch, "events": [{**batch["events"][0], "sim_time_minutes": 500}]}, start=500)
        sim.seek(0)
        sim.play()
        self.assertEqual(sim.span_minutes, 0)
        self.assertEqual(event_ids(sim.tick()), ["evt-0001"])
        self.assertEqual((sim.now, sim.state), (500, "paused"))

    def test_independent_runs_do_not_share_pacing(self):
        hour, month = paced(load("multi-hour")), paced(load("multi-month"), speed=4)
        for _ in range(3):
            hour.tick(), month.tick()
        self.assertAlmostEqual(hour.sim_time, 29 + 3 * 21.05)
        self.assertAlmostEqual(month.sim_time, 1439 + 3 * 4 * 0.05 * (259200 - 1439))
        alone = paced(load("multi-hour"))
        for _ in range(3):
            alone.tick()
        self.assertEqual(alone.snapshot(), hour.snapshot())

    def test_deterministic(self):
        def run():
            sim = paced(load("multi-month"), speed=2)
            out = sim.tick() + sim.tick(0.3) + [sim.seek(43200), sim.play()]
            return out + tick_to_end(sim)[0]
        self.assertEqual(run(), run())

    def test_fixed_rate_is_unchanged(self):
        batch = load("multi-hour")
        fixed = Simulation.from_batch(batch, minutes_per_tick=7)
        plain = Simulation.from_batch(batch)
        self.assertEqual(fixed.tick(3), plain.advance(21))
        self.assertEqual(fixed.pacing, {"mode": "fixed", "minutes_per_tick": 7})

    def test_pacing_view(self):
        sim = paced(load("multi-hour"))
        self.assertEqual(sim.timeline_view()["pacing"], {
            "mode": "relative", "fraction_per_tick": 0.05, "start_minutes": 29,
            "span_minutes": 421, "minutes_per_tick": sim.step_minutes,
        })

    def test_rejects_bad_pacing(self):
        for pace in (0, -0.1, 1.5, float("nan"), True, "5%"):
            with self.subTest(pace=pace), self.assertRaises(ValueError):
                Simulation(simulation_id="x", pace=pace)
        for minutes in (0, -1, float("inf")):
            with self.subTest(minutes=minutes), self.assertRaises(ValueError):
                Simulation(simulation_id="x", minutes_per_tick=minutes)
        sim = Simulation(simulation_id="x")
        for ticks in (-1, float("nan"), True):
            with self.subTest(ticks=ticks), self.assertRaises(ValueError):
                sim.tick(ticks)


def fixture_director(prompt, *, fixture, simulation_id, branch_id, timeout_s):
    return {**load(prompt), "simulation_id": simulation_id, "branch_id": branch_id}


@unittest.skipIf(TestClient is None, "fastapi/httpx not installed")
class ServerPacingTests(unittest.TestCase):
    def ready(self, client, run_id, until=None, timeout=10):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            status = client.get(f"/scenarios/{run_id}").json()
            if status["status"] == "ready" and (until is None or until(status)):
                return status
            time.sleep(0.02)
        self.fail(f"{run_id} not done: {status}")

    def test_runs_pace_relatively_and_the_demo_keeps_its_fixed_rate(self):
        demo = Simulation.from_batch(load("multi-day"), state="paused")
        registry = ScenarioRegistry(fixture_director, timeout_s=5)
        app = create_app(demo, tick_seconds=0.02, minutes_per_second=50, scenarios=registry)
        with TestClient(app) as client:
            hour = client.post("/scenarios", json={"prompt": "multi-hour"}).json()["id"]
            month = client.post("/scenarios", json={"prompt": "multi-month"}).json()["id"]
            status = self.ready(client, month)
            self.assertEqual(status["pacing"], {
                "mode": "relative", "fraction_per_tick": 0.05, "start_minutes": 1439,
                "span_minutes": 257761, "minutes_per_tick": 0.05 * 257761, "tick_seconds": 0.02,
            })
            self.ready(client, hour)
            self.assertEqual(client.get(f"/scenarios/{hour}/timeline").json()["pacing"]["span_minutes"], 421)
            self.assertEqual(client.get("/timeline").json()["pacing"],
                             {"mode": "fixed", "minutes_per_tick": 1.0, "tick_seconds": 0.02})

            with client.websocket_connect(f"/scenarios/{month}/stream") as ws:
                ws.receive_json()  # snapshot
                client.post(f"/scenarios/{month}/control", json={"action": "speed", "speed": 16})
                client.post(f"/scenarios/{month}/control", json={"action": "play"})
                ids = []
                while True:
                    message = ws.receive_json()
                    if message["kind"] == "event":
                        ids.append(message["event"]["id"])
                    elif message["playback"]["state"] == "paused" and message["sim_time_minutes"] == 259200:
                        break
            self.assertEqual(ids, [f"evt-{i:04d}" for i in range(1, 11)])

            client.post(f"/scenarios/{hour}/control", json={"action": "play"})
            done = self.ready(client, hour, until=lambda s: s["playback"]["state"] == "paused")
            self.assertEqual(done["sim_time_minutes"], 450)
            self.assertEqual(client.get("/snapshot").json()["sim_time_minutes"], 0)  # demo stayed paused

    def test_cli_sets_the_scenario_pace(self):
        app, _ = build(["--scenario-pace", "10"])
        self.assertEqual(app.state.scenarios.pace, 0.1)
        app, _ = build([])
        self.assertEqual(app.state.scenarios.pace, 0.05)
        for bad in ("0", "150"):
            with self.subTest(bad=bad), self.assertRaises(SystemExit),                     contextlib.redirect_stderr(io.StringIO()):
                build(["--scenario-pace", bad])


if __name__ == "__main__":
    unittest.main()
