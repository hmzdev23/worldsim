"""Story playback: play {"until_next_event": true} stops the clock exactly on each event.

The web plays story runs this way so every event gets its own moment: the clock never
runs past an event the viewer hasn't seen, and each release pauses until the viewer
(or the presentation timer) plays on.
"""

import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / "services" / "simulation")]

from worldsim_sim import Simulation  # noqa: E402
from worldsim_sim.server import apply_control  # noqa: E402

JAPAN = json.loads((ROOT / "contracts" / "fixtures" / "japan-earthquake.json").read_text(encoding="utf-8"))


def story_sim(pace=0.04):
    sim = Simulation.from_batch(JAPAN, pace=pace, state="paused")
    sim.start_minutes = max(0, sim.timeline[0]["sim_time_minutes"] - 1)
    sim.seek(sim.start_minutes)
    return sim


class StoryPlaybackTests(unittest.TestCase):
    def test_the_clock_stops_on_every_event_in_order(self):
        sim = story_sim()
        seen, stops = [], 0
        for _ in range(10_000):
            if sim.now >= sim.end_minutes and sim.state == "paused":
                break
            if sim.state == "paused":
                apply_control(sim, {"action": "play", "until_next_event": True})
            messages = sim.tick()
            released = [m["event"] for m in messages if m["kind"] == "event"]
            if released:
                stops += 1
                self.assertEqual(sim.state, "paused")
                # The clock sits exactly on the released events' minute: never past it.
                self.assertTrue(all(e["sim_time_minutes"] == sim.now for e in released))
                self.assertEqual(len({e["sim_time_minutes"] for e in released}), 1)
                seen += [e["id"] for e in released]
        self.assertEqual(seen, [e["id"] for e in sim.timeline])
        self.assertEqual(stops, len({e["sim_time_minutes"] for e in sim.timeline}))

    def test_plain_play_still_runs_through(self):
        sim = story_sim(pace=0.5)
        apply_control(sim, {"action": "play"})
        released = []
        for _ in range(5):
            released += [m for m in sim.tick() if m["kind"] == "event"]
        self.assertEqual(len(released), len(sim.timeline))

    def test_a_plain_play_clears_the_hold(self):
        sim = story_sim()
        sim.play(until_next_event=True)
        sim.play()
        self.assertFalse(sim.hold_at_events)

    def test_the_clock_moves_smoothly_between_far_apart_events(self):
        sim = story_sim(pace=0.01)
        event_minutes = {e["sim_time_minutes"] for e in sim.timeline}
        times = []
        for _ in range(10_000):
            if sim.now >= sim.end_minutes and sim.state == "paused":
                break
            if sim.state == "paused":
                sim.play(until_next_event=True)
            sim.tick()
            times.append(sim.sim_time)
        self.assertEqual(sorted(times), times)
        # Between far-apart events the clock passes through intermediate times, not one jump.
        self.assertTrue(any(t not in event_minutes for t in times))

if __name__ == "__main__":
    unittest.main()
