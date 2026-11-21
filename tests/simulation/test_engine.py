"""SIM-001 checks: validation, clock, ordering, contract shape, and the server."""

import copy
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CONTRACTS = ROOT / "contracts"
sys.path.insert(0, str(ROOT / "services" / "simulation"))
sys.path.insert(0, str(ROOT / "services" / "newsroom"))

from worldsim_sim import Simulation, replay  # noqa: E402

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


def load(path):
    return json.loads(path.read_text(encoding="utf-8"))


FIXTURE = load(CONTRACTS / "fixtures" / "japan-earthquake.json")
QUAKE = FIXTURE["events"][0]


def proposed(id_, minute, sequence=0, parents=(), **overrides):
    event = copy.deepcopy(QUAKE)
    event.update(
        id=id_,
        sim_time_minutes=minute,
        sequence=sequence,
        status="proposed",
        type="aftershock",
        parent_ids=list(parents),
        provenance={"source": "model", "model": "mock"},
    )
    event["payload"] = {"magnitude": 6.1, "depth_km": 30}
    event.update(overrides)
    return event


def batch(*events, **header):
    return {
        "schema_version": "0.1",
        "simulation_id": FIXTURE["simulation_id"],
        "branch_id": "main",
        "events": list(events),
        **header,
    }


def stream_validator():
    schemas = [load(CONTRACTS / n) for n in ("events.schema.json", "stream.schema.json")]
    registry = Registry().with_resources((s["$id"], Resource.from_contents(s)) for s in schemas)
    return Draft202012Validator(schemas[1], registry=registry)


class ClockTests(unittest.TestCase):
    def setUp(self):
        self.sim = Simulation.from_batch(FIXTURE)

    def test_event_is_released_when_clock_reaches_it(self):
        self.assertEqual(self.sim.snapshot()["events"], [])
        self.assertEqual([m["kind"] for m in self.sim.advance(401)], ["clock"])
        messages = self.sim.advance(1)
        self.assertEqual([m["kind"] for m in messages], ["event", "clock"])
        self.assertEqual(messages[0]["event"]["id"], QUAKE["id"])
        self.assertEqual(messages[1]["sim_time_minutes"], 402)

    def test_speed_multiplies_and_pause_stops_the_clock(self):
        self.sim.set_speed(4)
        self.sim.advance(10)
        self.assertEqual(self.sim.now, 40)
        self.sim.pause()
        self.sim.advance(10)
        self.assertEqual(self.sim.now, 40)
        with self.assertRaises(ValueError):
            self.sim.set_speed(3)
        with self.assertRaises(ValueError):
            self.sim.set_speed(2.0)

    def test_fractional_advances_accumulate(self):
        for _ in range(10):
            self.sim.advance(0.25)
        self.assertEqual(self.sim.now, 2)

    def test_seek_back_and_forth_rebuilds_snapshot(self):
        snap = self.sim.seek(500)
        self.assertEqual([e["id"] for e in snap["events"]], [QUAKE["id"]])
        self.assertEqual(self.sim.seek(0)["events"], [])
        # After seeking back, the event is released again exactly once.
        released = [m for m in self.sim.advance(600) if m["kind"] == "event"]
        self.assertEqual(len(released), 1)
        self.assertEqual(self.sim.advance(600)[0]["kind"], "clock")


class IngestTests(unittest.TestCase):
    def setUp(self):
        self.sim = Simulation.from_batch(FIXTURE)

    def test_valid_proposal_is_applied_and_streamed_in_canonical_order(self):
        a = proposed("evt-a", 450, sequence=1, parents=[QUAKE["id"]])
        b = proposed("evt-b", 450, sequence=0, parents=[QUAKE["id"]])
        c = proposed("evt-c", 420, parents=["evt-b"])  # parent after child
        out, rejected = self.sim.ingest(batch(a, b, c))
        statuses = {e["id"]: e["status"] for e in out}
        self.assertEqual(statuses, {"evt-a": "applied", "evt-b": "applied", "evt-c": "rejected"})
        self.assertEqual([r.id for r in rejected], ["evt-c"])
        released = [m["event"]["id"] for m in self.sim.advance(1000) if m["kind"] == "event"]
        self.assertEqual(released, [QUAKE["id"], "evt-b", "evt-a"])

    def test_rejections(self):
        self.sim.seek(410)
        cases = {
            "past": proposed("evt-past", 405, parents=[QUAKE["id"]]),
            "dup": proposed(QUAKE["id"], 500),
            "orphan": proposed("evt-orphan", 500, parents=["evt-missing"]),
        }
        if Draft202012Validator is not None:  # schema rules need jsonschema
            cases["schema"] = proposed("evt-schema", 500, type="alien_invasion")
            cases["no_magnitude"] = proposed("evt-nomag", 500, payload={})
        out, rejected = self.sim.ingest(batch(*cases.values()))
        self.assertTrue(all(e["status"] == "rejected" for e in out))
        self.assertEqual(len(rejected), len(cases))
        self.assertEqual(len(self.sim.timeline), 1)

    def test_wrong_simulation_rejects_whole_batch(self):
        _, rejected = self.sim.ingest(batch(proposed("evt-x", 500), simulation_id="other"))
        self.assertIn("simulation_id", rejected[0].reasons[0])

    def test_ingest_does_not_mutate_input(self):
        event = proposed("evt-a", 450)
        self.sim.ingest(batch(event))
        self.assertEqual(event["status"], "proposed")


class ContractTests(unittest.TestCase):
    @unittest.skipIf(Draft202012Validator is None, "pip install jsonschema for schema checks")
    def test_every_message_matches_stream_contract(self):
        sim = Simulation.from_batch(FIXTURE)
        sim.ingest(batch(proposed("evt-a", 450, parents=[QUAKE["id"]])))
        messages = [sim.snapshot(), *sim.advance(500), sim.pause(), sim.set_speed(16), sim.seek(460)]
        validator = stream_validator()
        for message in messages:
            self.assertEqual([e.message for e in validator.iter_errors(message)], [], message["kind"])

    def test_replay_feeds_worldwire(self):
        from worldwire import news_from_stream

        messages = replay(FIXTURE, speed=16)
        self.assertEqual(messages[0]["kind"], "snapshot")
        feed = news_from_stream(messages)
        self.assertEqual([item["event_id"] for item in feed], [QUAKE["id"]])

    def test_replay_rejects_non_advancing_steps(self):
        with self.assertRaises(ValueError):
            replay(FIXTURE, step_minutes=0)


@unittest.skipIf(TestClient is None, "pip install -r services/simulation/requirements.txt")
class ServerTests(unittest.TestCase):
    def client(self, **kwargs):
        sim = Simulation.from_batch(FIXTURE)
        sim.seek(400)
        return TestClient(create_app(sim, **kwargs))

    def test_stream_sends_snapshot_then_controls_and_events(self):
        with self.client(tick_seconds=3600) as client, client.websocket_connect("/stream") as ws:
            first = ws.receive_json()
            self.assertEqual((first["kind"], first["sim_time_minutes"]), ("snapshot", 400))
            ws.send_json({"action": "speed", "speed": 4})
            self.assertEqual(ws.receive_json()["playback"]["speed"], 4)
            ws.send_json({"action": "nonsense"})  # ignored
            ws.send_json({"action": "seek", "sim_time_minutes": 402})
            snap = ws.receive_json()
            self.assertEqual([e["id"] for e in snap["events"]], [QUAKE["id"]])
            # A proposal due right now is applied and streamed immediately.
            response = client.post("/events", json=batch(proposed("evt-now", 402, sequence=1, parents=[QUAKE["id"]])))
            self.assertEqual(response.json()["batch"]["events"][0]["status"], "applied")
            message = ws.receive_json()
            self.assertEqual((message["kind"], message["event"]["id"]), ("event", "evt-now"))

    def test_ticker_advances_clock_and_streams_event(self):
        with self.client(tick_seconds=0.02, minutes_per_second=200) as client, client.websocket_connect("/stream") as ws:
            ws.receive_json()
            for _ in range(500):
                message = ws.receive_json()
                if message["kind"] == "event":
                    break
            self.assertEqual(message["event"]["id"], QUAKE["id"])

    def test_http_control_and_snapshot(self):
        with self.client(tick_seconds=3600) as client:
            self.assertEqual(client.post("/control", json={"action": "pause"}).json()["playback"]["state"], "paused")
            self.assertEqual(client.post("/control", json={"action": "speed", "speed": 5}).status_code, 422)
            self.assertEqual(client.get("/snapshot").json()["sim_time_minutes"], 400)
            self.assertTrue(client.get("/health").json()["ok"])


if __name__ == "__main__":
    unittest.main()
