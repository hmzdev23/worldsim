"""SIM-002 checks: GET /timeline, and seek/replay/stream over multi-day fixtures.

Every check runs against each fixture in FIXTURES: the canonical demo fixture
and a multi-day test fixture with same-minute ties, out-of-order listing, and
causal chains. When the canonical fixture grows (DIR-003, #26), the same checks
cover it with no changes here.
"""

import json
import random
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CONTRACTS = ROOT / "contracts"
sys.path.insert(0, str(ROOT / "services" / "simulation"))

from worldsim_sim import Simulation, canonical_key, replay  # noqa: E402

try:
    from jsonschema import Draft202012Validator
    from referencing import Registry, Resource
except ImportError:  # pragma: no cover
    Draft202012Validator = None

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


def expected_order(batch):
    """IDs of a fixture's events in canonical order, computed independently of the engine."""
    events = [e for e in batch["events"] if e["status"] != "rejected"]
    return [e["id"] for e in sorted(events, key=lambda e: (e["sim_time_minutes"], e["sequence"]))]


class ClientState:
    """Folds stream messages the way a client must: a snapshot replaces, an event appends."""

    def __init__(self):
        self.ids = []
        self.now = None

    def apply(self, messages):
        for message in messages:
            if message["kind"] == "snapshot":
                self.ids = [e["id"] for e in message["events"]]
            elif message["kind"] == "event":
                self.ids.append(message["event"]["id"])
            if message["kind"] != "event":
                self.now = message["sim_time_minutes"]


def reached(sim):
    return [e["id"] for e in sim.timeline if e["sim_time_minutes"] <= sim.now]


class TimelineEngineTests(unittest.TestCase):
    def test_multi_day_fixture_spans_more_than_one_day(self):
        batch = load(FIXTURES["multi-day"])
        self.assertGreater(max(e["sim_time_minutes"] for e in batch["events"]), 2 * 1440)
        times = [(e["sim_time_minutes"]) for e in batch["events"]]
        self.assertNotEqual(times, sorted(times), "fixture should list events out of order")

    def test_timeline_is_complete_canonical_and_clock_independent(self):
        for name, path in FIXTURES.items():
            with self.subTest(fixture=name):
                batch = load(path)
                sim = Simulation.from_batch(batch, state="paused")
                view = sim.timeline_view()
                ids = [e["id"] for e in view["events"]]
                self.assertEqual(ids, expected_order(batch))
                self.assertTrue(all(e["status"] == "applied" for e in view["events"]))
                keys = [canonical_key(e) for e in view["events"]]
                self.assertEqual(keys, sorted(keys))
                self.assertEqual(view["end_minutes"], max(e["sim_time_minutes"] for e in batch["events"]))
                for minute in (0, view["end_minutes"] // 2, view["end_minutes"] + 60, 0):
                    sim.seek(minute)
                    later = sim.timeline_view()
                    self.assertEqual(later["events"], view["events"])
                    self.assertEqual(later["sim_time_minutes"], minute)

    def test_timeline_view_is_a_copy(self):
        sim = Simulation.from_batch(load(FIXTURES["multi-day"]))
        sim.timeline_view()["events"][0]["id"] = "evt-mutated"
        self.assertNotEqual(sim.timeline[0]["id"], "evt-mutated")

    def test_snapshot_still_stops_at_the_clock(self):
        batch = load(FIXTURES["multi-day"])
        sim = Simulation.from_batch(batch, state="paused")
        self.assertEqual(sim.snapshot()["events"], [])
        snap = sim.seek(1440)
        self.assertEqual([e["id"] for e in snap["events"]], reached(sim))
        self.assertTrue(all(e["sim_time_minutes"] <= 1440 for e in snap["events"]))
        self.assertLess(len(snap["events"]), len(sim.timeline))

    def test_replay_releases_each_event_exactly_once_in_order(self):
        for name, path in FIXTURES.items():
            for speed in (1, 16):
                with self.subTest(fixture=name, speed=speed):
                    batch = load(path)
                    messages = replay(batch, speed=speed, step_minutes=7)
                    released = [m["event"]["id"] for m in messages if m["kind"] == "event"]
                    self.assertEqual(released, expected_order(batch))

    def test_random_seek_and_advance_never_duplicates_or_drops(self):
        for name, path in FIXTURES.items():
            batch = load(path)
            end = max(e["sim_time_minutes"] for e in batch["events"])
            for seed in range(20):
                with self.subTest(fixture=name, seed=seed):
                    rng = random.Random(seed)
                    sim = Simulation.from_batch(batch)
                    client = ClientState()
                    client.apply([sim.snapshot()])
                    for _ in range(60):
                        op = rng.choice(["advance", "advance", "seek", "replay", "speed", "pause", "play"])
                        if op == "advance":
                            messages = sim.advance(rng.choice([0, 0.5, 1, 13, 240, 1440]))
                        elif op == "seek":
                            messages = [sim.seek(rng.randint(0, end + 120))]
                        elif op == "replay":
                            messages = [sim.seek(0)]
                        elif op == "speed":
                            messages = [sim.set_speed(rng.choice([1, 2, 4, 16]))]
                        else:
                            messages = [getattr(sim, op)()]
                        client.apply(messages)
                        self.assertEqual(client.ids, reached(sim), op)
                        self.assertEqual(len(client.ids), len(set(client.ids)), op)
                        self.assertEqual(client.now, sim.now, op)


@unittest.skipIf(TestClient is None, "pip install -r services/simulation/requirements.txt")
class TimelineServerTests(unittest.TestCase):
    def app(self, path, **kwargs):
        sim = Simulation.from_batch(load(path), state="paused")
        return TestClient(create_app(sim, **kwargs)), sim

    def test_get_timeline_lists_future_events_and_leaves_snapshot_alone(self):
        for name, path in FIXTURES.items():
            with self.subTest(fixture=name):
                batch = load(path)
                client, _ = self.app(path, tick_seconds=3600)
                with client:
                    body = client.get("/timeline").json()
                    self.assertEqual([e["id"] for e in body["events"]], expected_order(batch))
                    self.assertEqual(body["sim_time_minutes"], 0)
                    self.assertEqual(body["playback"], {"state": "paused", "speed": 1})
                    self.assertEqual(client.get("/snapshot").json()["events"], [])
                    client.post("/control", json={"action": "seek", "sim_time_minutes": body["end_minutes"]})
                    self.assertEqual(client.get("/timeline").json()["events"], body["events"])
                    snap = client.get("/snapshot").json()
                    self.assertEqual([e["id"] for e in snap["events"]], expected_order(batch))

    @unittest.skipIf(Draft202012Validator is None, "pip install jsonschema for schema checks")
    def test_timeline_events_match_applied_event_contract(self):
        schemas = [load(CONTRACTS / n) for n in ("events.schema.json", "stream.schema.json")]
        registry = Registry().with_resources((s["$id"], Resource.from_contents(s)) for s in schemas)
        validator = Draft202012Validator(schemas[1], registry=registry)
        for name, path in FIXTURES.items():
            with self.subTest(fixture=name):
                client, _ = self.app(path, tick_seconds=3600)
                with client:
                    body = client.get("/timeline").json()
                # A timeline's events must be valid snapshot events (applied, canonical).
                as_snapshot = {k: body[k] for k in ("schema_version", "simulation_id", "branch_id", "sim_time_minutes", "playback", "events")}
                errors = [e.message for e in validator.iter_errors({**as_snapshot, "kind": "snapshot"})]
                self.assertEqual(errors, [])

    def test_websocket_plays_whole_timeline_once_then_replays(self):
        for name, path in FIXTURES.items():
            with self.subTest(fixture=name):
                batch = load(path)
                expected = expected_order(batch)
                end = max(e["sim_time_minutes"] for e in batch["events"])
                # ~300 sim minutes per tick: several events can land in one tick.
                client, _ = self.app(path, tick_seconds=0.01, minutes_per_second=30000)
                with client, client.websocket_connect("/stream") as ws:
                    self.assertEqual(ws.receive_json()["events"], [])
                    for run in ("first", "replay"):
                        ws.send_json({"action": "play"})
                        seen = []
                        for _ in range(5000):
                            message = ws.receive_json()
                            if message["kind"] == "event":
                                seen.append(message["event"]["id"])
                                self.assertEqual(message["sim_time_minutes"], message["event"]["sim_time_minutes"])
                            elif message["kind"] == "clock" and message["sim_time_minutes"] >= end:
                                break
                        self.assertEqual(seen, expected, run)
                        ws.send_json({"action": "pause"})
                        ws.send_json({"action": "replay"})
                        # Drain until the replay snapshot; ticks may arrive in between.
                        while True:
                            message = ws.receive_json()
                            if message["kind"] == "snapshot":
                                break
                        self.assertEqual((message["sim_time_minutes"], message["events"]), (0, []))


if __name__ == "__main__":
    unittest.main()
