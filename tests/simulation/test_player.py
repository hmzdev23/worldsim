"""Player mode (prototype): decision points, branching, voiding and deterministic scoring.

Offline: the Director's fixtures and player specs, no model credentials.
"""

import copy
import json
import sys
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
for service in ("simulation", "director", "newsroom"):
    sys.path.insert(0, str(ROOT / "services" / service))

from worlddirector import prepare_scenario  # noqa: E402
from worldsim_sim.player import DECIDE_LATER, DO_NOTHING, PlayerError, PlayerSession, apply_effects  # noqa: E402
from worldsim_sim.scenarios import Catalogue, simulation_for  # noqa: E402

try:
    from fastapi.testclient import TestClient
    from worldsim_sim import Simulation
    from worldsim_sim.scenarios import ScenarioRegistry
    from worldsim_sim.server import create_app
except ImportError:  # pragma: no cover
    TestClient = None

FIXTURES = ("global-pandemic", "iceland-eruption", "japan-earthquake", "pacific-tsunami", "vesuvius-eruption")
CATALOGUE = Catalogue()


def session(fixture="global-pandemic", role="health_minister", **kwargs):
    batch = prepare_scenario("A fictional scenario", simulation_id="run-test", fixture=fixture)
    sim = simulation_for("run-test", batch)
    sim.start_minutes = max(0, sim.timeline[0]["sim_time_minutes"] - 1)
    sim.pace = 0.05
    sim.seek(sim.start_minutes)
    return PlayerSession(run_id="run-test", spec=CATALOGUE.spec(fixture), role=role, sim=sim, catalogue=CATALOGUE,
                         **kwargs)


def step(player, ticks=1.0):
    player.arm()
    messages = player.sim.tick(ticks)
    return messages + player.after_advance()


def play_until_card(player, limit=400):
    """Play until a decision card is waiting (or the run ends). Returns the point or None."""
    if player.sim.state != "playing" and player.pending is None:
        player.sim.play()
    for _ in range(limit):
        pending = player.pending
        if pending is not None and pending.deadline is None:
            return pending
        if player.finished:
            return None
        step(player)
    raise AssertionError("no decision card and the run did not end")


def play_log(player, choices):
    """Answer each card with the next choice (an option id, ("text", "..."), or do nothing)."""
    for choice in choices:
        point = play_until_card(player)
        if point is None:
            break
        if isinstance(choice, tuple):
            player.decide(point.id, free_text=choice[1], at_minutes=player.sim.now)
        else:
            player.decide(point.id, option_id=choice, at_minutes=player.sim.now)
    while play_until_card(player) is not None:
        player.decide(player.pending.id, option_id=DO_NOTHING, at_minutes=player.sim.now)
    return player.summary()


class DecisionPointTests(unittest.TestCase):
    def test_pandemic_opens_three_cards_with_options_and_a_situation_from_the_past_only(self):
        player = session()
        seen = []
        while (point := play_until_card(player)) is not None:
            released = {e["id"] for e in player.sim.snapshot()["events"]}
            self.assertIn(point.trigger_event_id, released)
            self.assertEqual(player.sim.state, "paused")
            self.assertEqual(player.sim.now, point.trigger_minute)  # the clock stopped on the trigger
            self.assertTrue(3 <= len(point.options) + 1 <= 4)  # actions + "Do nothing"
            self.assertTrue(point.situation.startswith("So far"))
            seen.append((point.trigger_minute, point.trigger_type, point.rule))
            player.decide(point.id, option_id=DO_NOTHING, at_minutes=player.sim.now)
        self.assertEqual(seen, [(7200, "disease_outbreak", "new_region"), (20160, "infrastructure_failure", "severe"),
                                (30240, "civil_unrest", "new_region")])

    def test_minimum_gap_between_cards(self):
        for fixture, role in (("iceland-eruption", "crisis_coordinator"), ("japan-earthquake", "aid_director")):
            player = session(fixture, role)
            minutes = []
            while (point := play_until_card(player)) is not None:
                minutes.append(point.trigger_minute)
                player.decide(point.id, option_id=DO_NOTHING, at_minutes=player.sim.now)
            gaps = [b - a for a, b in zip(minutes, minutes[1:])]
            self.assertTrue(minutes, fixture)
            self.assertTrue(all(g >= player.min_gap for g in gaps), (fixture, minutes))

    def test_every_trigger_type_in_the_three_fixtures_has_options_for_every_role(self):
        for fixture in FIXTURES:
            spec = CATALOGUE.spec(fixture)
            timeline = session(fixture, spec["roles"][0]["id"]).sim.timeline
            probe = session(fixture, spec["roles"][0]["id"])
            types = {e["type"] for i, e in enumerate(timeline) if probe._rule_for(e, timeline[:i])}
            self.assertTrue(types, fixture)
            for role in spec["roles"]:
                for event_type in types:
                    options = CATALOGUE.options_for(spec, role["id"], event_type)
                    self.assertGreaterEqual(len(options), 3, (fixture, role["id"], event_type))


class DecisionTests(unittest.TestCase):
    def test_an_action_forks_a_branch_and_never_changes_the_parent(self):
        player = session()
        parent = copy.deepcopy(player.sim.timeline)
        point = play_until_card(player)
        messages = player.decide(point.id, option_id="close_borders", at_minutes=player.sim.now)
        self.assertEqual([m["kind"] for m in messages], ["snapshot", "clock"])
        self.assertEqual(messages[0]["branch_id"], "b1")
        self.assertEqual(player.segments[0].sim.timeline, parent)  # main is untouched
        branch = {e["id"]: e for e in player.sim.timeline}
        decision = branch["evt-d1"]
        self.assertEqual((decision["provenance"]["source"], decision["sim_time_minutes"]), ("user", 7200))
        self.assertEqual(decision["payload"]["decision"]["option_id"], "close_borders")
        consequences = [e for e in branch.values() if e["id"].startswith("evt-d1-c")]
        self.assertEqual(len(consequences), 2)
        for event in consequences:
            self.assertEqual(event["parent_ids"], ["evt-d1"])
            self.assertEqual(event["provenance"]["source"], "numeric")
        # The next imported outbreak (New York) never happens on this branch.
        self.assertNotIn("evt-0004", branch)
        self.assertEqual(point.report["dropped"][0]["place"], "New York City")
        # Every parent still exists and comes earlier.
        for event in branch.values():
            for pid in event["parent_ids"]:
                self.assertLess((branch[pid]["sim_time_minutes"], branch[pid]["sequence"]),
                                (event["sim_time_minutes"], event["sequence"]))

    def test_two_decisions_at_the_same_minute_are_refused(self):
        player = session()
        point = play_until_card(player)
        player.decide(point.id, option_id="screen_arrivals", at_minutes=7200)
        with self.assertRaises(PlayerError) as caught:
            player.decide(point.id, option_id="close_borders", at_minutes=7200)
        self.assertEqual(caught.exception.status, 409)
        self.assertIn("already made at minute 7200", str(caught.exception))

    def test_bad_requests(self):
        player = session()
        point = play_until_card(player)
        for kwargs, status in (({"option_id": "fly_to_moon", "at_minutes": 7200}, 422),
                               ({"option_id": DO_NOTHING, "at_minutes": 7199}, 409),
                               ({"option_id": DO_NOTHING, "free_text": "x", "at_minutes": 7200}, 422),
                               ({"option_id": DO_NOTHING, "at_minutes": "7200"}, 422)):
            with self.subTest(kwargs), self.assertRaises(PlayerError) as caught:
                player.decide(point.id, **kwargs)
            self.assertEqual(caught.exception.status, status)
        with self.assertRaises(PlayerError) as caught:
            player.decide("d99", option_id=DO_NOTHING, at_minutes=7200)
        self.assertEqual(caught.exception.status, 404)
        with self.assertRaises(PlayerError) as caught:
            player.control({"action": "play"})
        self.assertEqual(caught.exception.status, 409)

    def test_decide_later_is_bounded_and_then_resolves_to_do_nothing(self):
        player = session()
        point = play_until_card(player)
        player.decide(point.id, option_id=DECIDE_LATER, at_minutes=7200)
        self.assertEqual(player.sim.state, "playing")
        again = play_until_card(player)
        self.assertIs(again, point)
        self.assertEqual(player.sim.now, 7200 + player.defer_minutes)  # back after one deferral, in sim minutes
        player.decide(point.id, option_id=DECIDE_LATER, at_minutes=player.sim.now)
        with self.assertRaises(PlayerError):
            player.decide(point.id, option_id=DECIDE_LATER, at_minutes=player.sim.now)
        for _ in range(50):  # the second deferral runs out with no answer
            step(player)
            if point.status == "resolved":
                break
        self.assertEqual((point.choice, point.at_minutes), ("auto", 7200 + 2 * player.defer_minutes))
        self.assertEqual(player.sim.state, "playing")

    def test_free_text_offline_is_logged_not_simulated_and_checked(self):
        player = session()
        point = play_until_card(player)
        with self.assertRaises(PlayerError) as caught:
            player.decide(point.id, free_text="step-by-step instructions for a bomb", at_minutes=7200)
        self.assertEqual(caught.exception.status, 422)
        player.decide(point.id, free_text="Ask neighbouring regions to share hospital beds", at_minutes=7200)
        self.assertEqual((point.choice, point.simulated, player.sim.branch_id), ("free_text", False, "main"))
        self.assertIn("not simulated offline", player.state_json()["decisions"][0]["label"])

    def test_free_text_on_a_model_run_forks_from_the_directors_continuation(self):
        def continuer(text, *, role_title, history, simulation_id, branch_id):
            self.assertTrue(all(e["sim_time_minutes"] <= 7200 for e in history["events"]))
            return {"events": [{
                "id": "evt-0100", "sim_time_minutes": 7000, "sequence": 0, "type": "government_response",
                "status": "proposed", "severity": 0.3, "visual": "emergency_mobilization", "parent_ids": [],
                "location": {"name": "Singapore", "country": "Singapore", "country_code": "SGP", "lat": 1.35, "lon": 103.8},
                "payload": {"description": "Neighbours share hospital beds."}, "provenance": {"source": "model", "model": "test"},
            }]}

        player = session(offline=False, continuer=continuer)
        point = play_until_card(player)
        text = "Ask neighbouring regions to share hospital beds"
        self.assertTrue(player.needs_model(text))
        player.decide(point.id, free_text=text, at_minutes=7200, model_batch=player.model_batch(text))
        added = {e["id"]: e for e in player.sim.timeline}["evt-0100"]
        self.assertEqual((added["sim_time_minutes"], added["parent_ids"]), (7201, ["evt-d1"]))
        self.assertTrue(point.simulated)


class SeekAndBranchTests(unittest.TestCase):
    def test_seeking_back_voids_later_decisions_only_with_confirmation(self):
        player = session()
        first = play_until_card(player)
        player.decide(first.id, option_id="screen_arrivals", at_minutes=player.sim.now)
        second = play_until_card(player)
        player.decide(second.id, option_id="ease_restrictions", at_minutes=player.sim.now)
        self.assertEqual(player.sim.branch_id, "b2")
        with self.assertRaises(PlayerError) as caught:
            player.control({"action": "seek", "sim_time_minutes": 8000})
        self.assertEqual((caught.exception.status, caught.exception.extra["voids"]), (409, [second.id]))
        messages = player.control({"action": "seek", "sim_time_minutes": 8000, "void_decisions": True})
        self.assertEqual((messages[0]["kind"], messages[0]["branch_id"]), ("snapshot", "b1"))
        self.assertEqual((first.status, second.status), ("resolved", "voided"))
        self.assertEqual(player.variables["border_policy"], "screening")
        # Replay voids everything and returns to the unchanged scenario.
        player.control({"action": "replay", "void_decisions": True})
        self.assertEqual((player.sim.branch_id, first.status), ("main", "voided"))
        self.assertEqual(player.variables["border_policy"], "open")

    def test_seek_without_later_decisions_needs_no_confirmation(self):
        player = session()
        point = play_until_card(player)
        player.decide(point.id, option_id=DO_NOTHING, at_minutes=player.sim.now)
        self.assertEqual(player.control({"action": "seek", "sim_time_minutes": 9000})[0]["kind"], "snapshot")

    def test_branch_from_a_decision_reopens_it(self):
        player = session()
        point = play_until_card(player)
        player.decide(point.id, option_id="close_borders", at_minutes=player.sim.now)
        player.branch_from(point.id)
        reopened = player.pending
        self.assertEqual((point.status, player.sim.branch_id), ("voided", "main"))
        self.assertEqual((reopened.trigger_event_id, reopened.id, player.sim.now), (point.trigger_event_id, "d2", 7200))
        player.decide(reopened.id, option_id="screen_arrivals", at_minutes=7200)
        self.assertEqual(player.sim.branch_id, "b2")


class ScoringTests(unittest.TestCase):
    LOG = ["close_borders", DO_NOTHING, ("text", "Share hospital beds with neighbours")]

    def test_the_same_decision_log_gives_the_same_score(self):
        first = play_log(session(), self.LOG)
        second = play_log(session(), self.LOG)
        self.assertEqual(first["score"], second["score"])
        self.assertEqual(first["paragraph"], second["paragraph"])
        self.assertTrue(first["finished"])

    def test_components_and_bounds(self):
        idle = play_log(session(), [])
        parts = {c["id"]: c["points"] for c in idle["score"]["components"]}
        self.assertEqual(parts, {"outcome": 30.0, "timeliness": 20.0, "balance": 20.0})
        acted = play_log(session(), self.LOG)
        parts = {c["id"]: c["points"] for c in acted["score"]["components"]}
        self.assertGreater(parts["outcome"], 30.0)  # fewer outbreaks than doing nothing
        self.assertEqual(parts["balance"], 11.0)  # close_borders costs 9
        self.assertEqual(acted["score"]["total"], round(sum(parts.values()), 1))
        self.assertIn("recorded but not simulated", acted["paragraph"])
        verdicts = [d["verdict"] for d in acted["decisions"]]
        self.assertEqual(verdicts[0], "helped")
        self.assertEqual(verdicts[2], "no change (not simulated)")

    def test_repeating_the_strongest_action_costs_more(self):
        timeline_free = play_log(session("iceland-eruption", "crisis_coordinator"),
                                 ["widen_evacuation", "protect_power_plant", "reroute_flights"])
        balance = {c["id"]: c["points"] for c in timeline_free["score"]["components"]}["balance"]
        self.assertEqual(balance, 20 - 4 - 5 - 2)
        costs = timeline_free["score"]["detail"]["costs"]
        self.assertEqual([c["cost"] for c in costs], [4.0, 5.0, 2.0])

    def test_late_responses_lose_timeliness(self):
        player = session()
        point = play_until_card(player)
        player.decide(point.id, option_id=DECIDE_LATER, at_minutes=player.sim.now)
        point = play_until_card(player)
        player.decide(point.id, option_id=DO_NOTHING, at_minutes=player.sim.now)
        result = play_log(player, [])
        rows = result["score"]["detail"]["timeliness"]
        self.assertEqual(rows[0]["delay_minutes"], player.defer_minutes)
        self.assertEqual(rows[0]["share"], 0.5)

    def test_apply_effects_is_pure(self):
        player = session()
        future = [e for e in player.sim.timeline if e["sim_time_minutes"] > 7200]
        before = copy.deepcopy(future)
        trigger = player.sim.timeline[2]
        decision = {"id": "evt-d9", "payload": {"decision": {"id": "d9"}}}
        effects = CATALOGUE.action(player.spec, "close_borders")["effects"]
        first = apply_effects(future, decision, effects, at=7200, trigger=trigger, visuals=CATALOGUE.visuals())
        second = apply_effects(future, decision, effects, at=7200, trigger=trigger, visuals=CATALOGUE.visuals())
        self.assertEqual(first, second)
        self.assertEqual(future, before)


@unittest.skipIf(TestClient is None, "fastapi/httpx not installed")
class PlayerServerTests(unittest.TestCase):
    def setUp(self):
        demo = Simulation.from_batch(json.loads((ROOT / "contracts" / "fixtures" / "japan-earthquake.json")
                                                .read_text(encoding="utf-8")), state="paused")
        self.app = create_app(demo, tick_seconds=0.01, scenarios=ScenarioRegistry(timeout_s=10))
        self.client = TestClient(self.app)
        self.client.__enter__()
        self.addCleanup(self.client.__exit__, None, None, None)

    def wait(self, check, timeout=15):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            value = check()
            if value:
                return value
            time.sleep(0.01)
        self.fail("timed out")

    def start(self, **body):
        response = self.client.post("/scenarios", json={"prompt": "Play the pandemic", "fixture": "global-pandemic",
                                                        "mode": "player", "role": "health_minister", **body})
        self.assertEqual(response.status_code, 202, response.text)
        run_id = response.json()["id"]
        self.wait(lambda: self.client.get(f"/scenarios/{run_id}").json()["status"] == "ready")
        return run_id

    def card(self, run_id):
        return self.wait(lambda: (self.client.get(f"/scenarios/{run_id}/player").json()["pending"] or {})
                         if (self.client.get(f"/scenarios/{run_id}/player").json()["pending"] or {}).get("waiting")
                         else None)

    def test_player_run_over_http(self):
        scenarios = self.client.get("/player/scenarios").json()["scenarios"]
        self.assertEqual({s["fixture"] for s in scenarios}, set(FIXTURES))
        run_id = self.start()
        status = self.client.get(f"/scenarios/{run_id}").json()
        self.assertEqual((status["mode"], status["role"], status["branch_id"]), ("player", "health_minister", "main"))
        self.client.post(f"/scenarios/{run_id}/control", json={"action": "speed", "speed": 16})
        self.client.post(f"/scenarios/{run_id}/control", json={"action": "play"})
        card = self.card(run_id)
        self.assertTrue(card["headline"] if "headline" in card else card["trigger"]["headline"])
        self.assertIn("not simulated offline", card["free_text"]["note"].lower())
        self.assertEqual(self.client.post(f"/scenarios/{run_id}/control", json={"action": "play"}).status_code, 409)
        body = {"decision_id": card["id"], "option_id": "screen_arrivals", "at_minutes": card["trigger"]["minute"]}
        state = self.client.post(f"/scenarios/{run_id}/decisions", json=body).json()
        self.assertEqual(state["branch_id"], "b1")
        self.assertEqual(self.client.post(f"/scenarios/{run_id}/decisions", json=body).status_code, 409)
        news = self.client.get(f"/scenarios/{run_id}/news").json()
        self.assertEqual(news["branch_id"], "b1")
        self.assertTrue(any(i["event_id"] == "evt-d1" for i in news["items"]))
        while True:  # do nothing on the rest
            state = self.client.get(f"/scenarios/{run_id}/player").json()
            if state["finished"]:
                break
            if state["pending"] and state["pending"]["waiting"]:
                pending = state["pending"]
                self.client.post(f"/scenarios/{run_id}/decisions", json={
                    "decision_id": pending["id"], "option_id": "do_nothing", "at_minutes": state["sim_time_minutes"]})
            time.sleep(0.01)
        summary = self.client.get(f"/scenarios/{run_id}/summary").json()
        self.assertTrue(summary["finished"])
        self.assertEqual([c["id"] for c in summary["score"]["components"]], ["outcome", "timeliness", "balance"])
        self.assertTrue(all(c["why"] for c in summary["score"]["components"]))
        comparison = summary["comparison"]  # the Alternate Timeline view
        self.assertTrue(comparison["initial_conditions"]["identical"])
        self.assertEqual((comparison["timelines"]["a"]["branch_id"], comparison["timelines"]["b"]["branch_id"]),
                         ("main", "b1"))
        seek = self.client.post(f"/scenarios/{run_id}/control", json={"action": "seek", "sim_time_minutes": 100})
        self.assertEqual(seek.status_code, 409)
        self.assertIn("d1", seek.json()["voids"])

    def test_player_mode_needs_a_spec_and_a_role(self):
        bad = self.client.post("/scenarios", json={"prompt": "x", "fixture": "global-pandemic", "mode": "player"})
        self.assertEqual(bad.status_code, 422)
        bad = self.client.post("/scenarios", json={"prompt": "x", "fixture": "global-pandemic", "mode": "player",
                                                   "role": "emperor"})
        self.assertEqual(bad.status_code, 422)
        watch = self.client.post("/scenarios", json={"prompt": "x", "fixture": "global-pandemic"}).json()["id"]
        self.wait(lambda: self.client.get(f"/scenarios/{watch}").json()["status"] == "ready")
        self.assertEqual(self.client.get(f"/scenarios/{watch}").json()["mode"], "watch")
        self.assertEqual(self.client.get(f"/scenarios/{watch}/player").status_code, 404)


if __name__ == "__main__":
    unittest.main()
