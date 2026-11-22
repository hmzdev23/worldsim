"""NEWS-006 (#59) integration: a non-Japan run through the 5%-paced stream and WORLD//WIRE.

Director fixture -> simulation run (SIM-005 pacing, #58) -> stream -> news.
Checks that alerts arrive in canonical order, that no simultaneous event is
lost even when one tick at 16x crosses several, that news never shows the
future after a seek, and that playback is reproducible. Offline; no model.

Needs the paced engine from #62 (`Simulation.tick`); it skips until then.
"""

import sys
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
for service in ("simulation", "newsroom", "director"):
    sys.path.insert(0, str(ROOT / "services" / service))

from worlddirector import prepare_scenario  # noqa: E402
from worldsim_sim import Simulation  # noqa: E402
from worldwire import WireFeed, derive_news, news_response  # noqa: E402

PACED = hasattr(Simulation, "tick")
try:
    from fastapi.testclient import TestClient
    from worldsim_sim.scenarios import ScenarioRegistry
    from worldsim_sim.server import create_app
except ImportError:  # pragma: no cover
    TestClient = None

RUN = "run-paced-iceland"


def iceland(simulation_id=RUN):
    """The Iceland run fixture, with two aid events moved onto one minute.

    Same-minute events are what a fast run must not lose or reorder.
    """
    batch = prepare_scenario("A fissure eruption on the Reykjanes Peninsula", simulation_id=simulation_id,
                             fixture="iceland-eruption")
    aid = [e for e in batch["events"] if e["type"] == "international_aid"]
    aid[1].update(sim_time_minutes=aid[0]["sim_time_minutes"], sequence=aid[0]["sequence"] + 1)
    return batch


def paced_run(batch, speed):
    """A paused run set up like the scenario service does it, at 5% per tick."""
    sim = Simulation(simulation_id=batch["simulation_id"], branch_id=batch["branch_id"], state="paused",
                     pace=0.05, speed=speed)
    _, rejected = sim.ingest(batch)
    assert not rejected, rejected
    sim.start_minutes = max(0, sim.timeline[0]["sim_time_minutes"] - 1)
    sim.seek(sim.start_minutes)
    return sim


class Client:
    """What the browser does: fold the stream, fetch news after each new event, alert on it."""

    def __init__(self, sim):
        self.sim = sim
        self.feed = WireFeed()
        self.feed.apply(sim.snapshot())
        self.alerts = []  # (event_id, headline, dek) in arrival order

    def receive(self, messages):
        new = [m["event"]["id"] for m in messages if m["kind"] == "event"]
        for message in messages:
            self.feed.apply(message)
        if new:
            body = news_response(self.sim.snapshot())
            items = {i["event_id"]: i for i in body["items"]}
            for event_id in new:
                self.alerts.append((event_id, items[event_id]["headline"], items[event_id]["dek"]))


def play(batch, speed):
    sim = paced_run(batch, speed)
    client = Client(sim)
    sim.play()
    ticks = 0
    while sim.state == "playing":
        client.receive(sim.tick())
        ticks += 1
    return sim, client, ticks


@unittest.skipUnless(PACED, "needs SIM-005 relative pacing (Simulation.tick, PR #62)")
class PacedStorytellingTests(unittest.TestCase):
    def setUp(self):
        self.batch = iceland()
        self.archive = {i["event_id"]: i for i in derive_news(
            [{**e, "status": "applied"} for e in self.batch["events"]])}

    def test_alerts_arrive_in_order_with_no_lost_simultaneous_events(self):
        for speed, ticks in ((1, 20), (4, 5), (16, 2)):
            with self.subTest(speed=speed):
                sim, client, used = play(self.batch, speed)
                self.assertEqual(used, ticks)
                self.assertEqual([a[0] for a in client.alerts], [e["id"] for e in sim.timeline])
                # The alert copy is the archive copy, word for word.
                for event_id, headline, dek in client.alerts:
                    self.assertEqual((headline, dek), (self.archive[event_id]["headline"], self.archive[event_id]["dek"]))
                self.assertEqual(client.feed.items, news_response(sim.snapshot())["items"])

    def test_two_aid_events_in_one_minute_both_alert(self):
        _, client, _ = play(self.batch, 16)
        aid = [a for a in client.alerts if "aid to" in a[1]]
        self.assertEqual(len(aid), 2)
        self.assertNotEqual(aid[0][1], aid[1][1])

    def test_no_future_news_after_seek_or_replay(self):
        sim, client, _ = play(self.batch, 4)
        middle = sim.timeline[len(sim.timeline) // 2]["sim_time_minutes"]
        for target in (middle, 0, middle - 1):
            client.receive([sim.seek(target)])
            body = news_response(sim.snapshot())
            self.assertTrue(all(i["sim_time_minutes"] <= target for i in body["items"]))
            self.assertEqual({i["event_id"] for i in body["items"]},
                             {e["id"] for e in sim.timeline if e["sim_time_minutes"] <= target})
            self.assertEqual(client.feed.items, body["items"])
        sim.play()
        while sim.state == "playing":
            client.receive(sim.tick())
        self.assertEqual(client.feed.items, news_response(sim.snapshot())["items"])

    def test_playback_is_reproducible(self):
        first, second = play(iceland(), 2)[1].alerts, play(iceland(), 2)[1].alerts
        self.assertEqual(first, second)


@unittest.skipUnless(PACED and TestClient is not None, "needs SIM-005 pacing (#62) and fastapi")
class PacedServerTests(unittest.TestCase):
    def test_live_run_streams_paced_events_and_matching_news(self):
        batch = iceland("run-placeholder")

        def director(prompt, *, fixture, simulation_id, branch_id, timeout_s):
            return iceland(simulation_id)

        demo = Simulation.from_batch(batch, state="paused")
        with TestClient(create_app(demo, tick_seconds=0.02, scenarios=ScenarioRegistry(director))) as client:
            run_id = client.post("/scenarios", json={"prompt": "Iceland eruption"}).json()["id"]
            deadline = time.monotonic() + 10
            while client.get(f"/scenarios/{run_id}").json()["status"] != "ready":
                self.assertLess(time.monotonic(), deadline)
                time.sleep(0.02)
            end = client.get(f"/scenarios/{run_id}/timeline").json()["end_minutes"]
            with client.websocket_connect(f"/scenarios/{run_id}/stream") as ws:
                ws.receive_json()
                client.post(f"/scenarios/{run_id}/control", json={"action": "speed", "speed": 4})
                client.post(f"/scenarios/{run_id}/control", json={"action": "play"})
                seen = []
                while True:
                    message = ws.receive_json()
                    if message["kind"] == "event":
                        seen.append(message["event"]["id"])
                        news = client.get(f"/scenarios/{run_id}/news").json()
                        self.assertEqual(news["simulation_id"], run_id)
                        self.assertIn(message["event"]["id"], {i["event_id"] for i in news["items"]})
                    elif message["playback"]["state"] == "paused" and message["sim_time_minutes"] == end:
                        break
            self.assertEqual(seen, [f"evt-{i:04d}" for i in range(1, len(batch["events"]) + 1)])
            final = client.get(f"/scenarios/{run_id}/news").json()["items"]
            self.assertEqual(len(final), len(seen))

            middle = client.get(f"/scenarios/{run_id}/timeline").json()["events"][3]["sim_time_minutes"]
            client.post(f"/scenarios/{run_id}/control", json={"action": "seek", "sim_time_minutes": middle})
            after = client.get(f"/scenarios/{run_id}/news").json()["items"]
            self.assertTrue(after and all(i["sim_time_minutes"] <= middle for i in after))
            self.assertEqual(client.get("/snapshot").json()["sim_time_minutes"], 0)  # demo untouched


if __name__ == "__main__":
    unittest.main()
