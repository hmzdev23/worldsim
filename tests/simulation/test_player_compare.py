"""Player mode: the Alternate Timeline comparison (timeline A, no intervention, against timeline B, the player's).

Offline: the Director's fixtures and player specs, no model credentials.
"""

import copy
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from test_player import play_log, play_until_card, session  # noqa: E402
from worlddirector import prepare_scenario  # noqa: E402
from worldsim_sim.engine import canonical_key  # noqa: E402
from worldsim_sim.player import DO_NOTHING, measure  # noqa: E402
from worldsim_sim.scenarios import simulation_for  # noqa: E402

ACTIVE = ["close_borders", "expand_testing", "request_aid"]
FUTURE_PLACES = ("New York", "Frankfurt", "Geneva", "Paris", "Lagos")


def fresh_timeline(fixture="global-pandemic"):
    batch = prepare_scenario("A fictional scenario", simulation_id="run-test", fixture=fixture)
    return simulation_for("run-test", batch).timeline


def shape(comparison):
    """The comparison without run-specific ids (decision and branch numbering restart after voiding)."""
    return [(r["minute"], r["status"], (r["a"] or r["b"] or {}).get("type"), (r["a"] or r["b"] or {}).get("place"),
             r["note"] if r["kind"] == "event" else r["choice"]) for r in comparison["rows"]]


class BaselineTests(unittest.TestCase):
    def test_the_baseline_is_reproducible_from_the_fixture(self):
        first, second = session(), session()
        self.assertEqual(first.baseline, second.baseline)
        self.assertEqual(first.segments[0].sim.timeline, fresh_timeline())
        self.assertEqual(first.baseline, measure(first.spec, fresh_timeline()))

    def test_timeline_a_is_never_changed_by_playing_or_comparing(self):
        player = session()
        before = copy.deepcopy(player.segments[0].sim.timeline)
        summary = play_log(player, ACTIVE)
        self.assertEqual(player.segments[0].sim.timeline, before)
        again = player.summary()
        self.assertEqual(player.segments[0].sim.timeline, before)
        self.assertEqual(json.dumps(summary, sort_keys=True), json.dumps(again, sort_keys=True))
        # Every intermediate branch is also untouched by later forks.
        for segment in player.segments[1:-1]:
            later = [s for s in player.segments if s.parent == segment.branch_id]
            self.assertTrue(later)
            self.assertNotEqual(segment.sim.timeline, later[0].sim.timeline)


class ComparisonTests(unittest.TestCase):
    def test_same_decision_log_gives_the_same_comparison(self):
        one = play_log(session(), ACTIVE)["comparison"]
        two = play_log(session(), ACTIVE)["comparison"]
        self.assertEqual(json.dumps(one, sort_keys=True), json.dumps(two, sort_keys=True))

    def test_both_timelines_share_identical_starting_conditions(self):
        player = session()
        comparison = play_log(player, ACTIVE)["comparison"]
        start = comparison["initial_conditions"]
        self.assertTrue(start["identical"])
        first_decision = min(d["minute"] for d in comparison["decisions"] if d["simulated"])
        self.assertEqual(start["shared_until_minutes"], first_decision)
        base = [e for e in player.segments[0].sim.timeline if e["sim_time_minutes"] <= first_decision]
        mine = [e for e in player.sim.timeline
                if e["sim_time_minutes"] <= first_decision and (e.get("provenance") or {}).get("source") != "user"]
        self.assertEqual(base, mine)
        self.assertEqual(start["shared_events"], len(base))
        self.assertEqual(comparison["timelines"]["a"]["branch_id"], "main")
        self.assertEqual(comparison["timelines"]["b"]["branch_id"], player.sim.branch_id)
        for row in comparison["rows"]:
            if row["minute"] < first_decision:
                self.assertEqual(row["status"], "same", row)

    def test_doing_nothing_matches_the_baseline_everywhere(self):
        comparison = play_log(session(), [DO_NOTHING] * 3)["comparison"]
        self.assertEqual({r["status"] for r in comparison["rows"]}, {"same", "decision"})
        self.assertEqual({m["verdict"] for m in comparison["metrics"]}, {"same"})
        self.assertEqual({m["difference_text"] for m in comparison["metrics"]}, {"No change"})
        self.assertIn("ended the same", comparison["headline"])
        self.assertTrue(all(not d["simulated"] for d in comparison["decisions"]))

    def test_metrics_are_computed_from_the_two_timelines(self):
        player = session()
        summary = play_log(player, ACTIVE)
        base = measure(player.spec, player.segments[0].sim.timeline)
        mine = measure(player.spec, player.sim.timeline)
        rows = {m["name"]: m for m in summary["comparison"]["metrics"]}
        for name, row in rows.items():
            self.assertEqual(row["baseline"], base[name])
            self.assertEqual(row["final"], mine[name])
        # The pandemic, close borders then testing then aid: values the run produced.
        self.assertEqual(rows["affected_countries"]["difference_text"], "1 fewer")
        self.assertEqual(rows["outbreak_places"]["difference_text"], "1 fewer")
        self.assertEqual(rows["time_to_first_aid"]["difference_text"], "7 days earlier")
        self.assertEqual(rows["severity_load"]["verdict"], "worse")
        self.assertEqual(summary["comparison"]["metrics"], summary["baseline"])

    def test_consequences_and_prevented_events_are_attributed_to_their_decision(self):
        comparison = play_log(session(), ACTIVE)["comparison"]
        by_status = {}
        for row in comparison["rows"]:
            by_status.setdefault(row["status"], []).append(row)
        prevented = by_status["prevented"]
        self.assertEqual([(r["a"]["place"], r["decisions"]) for r in prevented], [("New York City", ["d1"])])
        self.assertIsNone(prevented[0]["b"])
        self.assertEqual(len(by_status["side_effect"]), 2)
        self.assertTrue(all(r["decisions"] == ["d1"] and r["a"] is None for r in by_status["side_effect"]))
        self.assertEqual([r["decisions"] for r in by_status["benefit"]], [["d2"]])
        moved = by_status["changed"]
        self.assertEqual([(r["a"]["type"], r["decisions"]) for r in moved], [("international_aid", ["d3"])])
        self.assertEqual(moved[0]["changes"][0]["kind"], "moved")
        self.assertLess(moved[0]["b"]["minute"], moved[0]["a"]["minute"])
        effects = {d["id"]: d["effects"] for d in comparison["decisions"]}
        self.assertEqual(effects["d1"]["prevented"], 1)
        self.assertEqual(effects["d1"]["side_effect"], 2)
        self.assertEqual(effects["d3"]["moved"], 1)
        self.assertIn("fictional model", comparison["decisions"][0]["explanation"])

    def test_rows_and_branches_keep_canonical_order(self):
        player = session()
        comparison = play_log(player, ACTIVE)["comparison"]
        minutes = [r["minute"] for r in comparison["rows"]]
        self.assertEqual(minutes, sorted(minutes))
        for segment in player.segments:
            timeline = segment.sim.timeline
            self.assertEqual(timeline, sorted(timeline, key=canonical_key))
            seen = set()
            for event in timeline:
                self.assertTrue(all(parent in seen for parent in event["parent_ids"]), event["id"])
                seen.add(event["id"])
        # A decision row sits after its trigger event and before its consequences.
        index = {r["id"]: i for i, r in enumerate(comparison["rows"])}
        self.assertLess(index["evt-0003"], index["decision-d1"])
        self.assertLess(index["decision-d1"], index["evt-d1-c1"])

    def test_rewinding_and_replaying_the_same_strategy_reproduces_score_and_comparison(self):
        reference = play_log(session(), ACTIVE)
        player = session()
        play_log(player, ACTIVE)
        player.control({"action": "seek", "sim_time_minutes": 0, "void_decisions": True})
        self.assertEqual(player.sim.branch_id, "main")
        replay = play_log(player, ACTIVE)
        self.assertEqual(replay["score"]["total"], reference["score"]["total"])
        self.assertEqual(replay["score"]["components"], reference["score"]["components"])
        self.assertEqual(replay["baseline"], reference["baseline"])
        self.assertEqual(shape(replay["comparison"]), shape(reference["comparison"]))
        self.assertEqual(len(replay["voided"]), 3)

    def test_branching_from_a_decision_changes_only_what_follows_it(self):
        player = session()
        play_log(player, ACTIVE)
        player.branch_from("d3")
        point = player.pending
        player.decide(point.id, option_id=DO_NOTHING, at_minutes=player.sim.now)
        summary = play_log(player, [])
        comparison = summary["comparison"]
        self.assertFalse(any(r["status"] == "changed" for r in comparison["rows"]))  # aid no longer moved
        self.assertEqual(sum(1 for r in comparison["rows"] if r["status"] == "prevented"), 1)  # d1 still stands

    def test_free_text_offline_shows_no_difference(self):
        comparison = play_log(session(), [("text", "Coordinate a calm public message"), DO_NOTHING])["comparison"]
        first = comparison["decisions"][0]
        self.assertFalse(first["simulated"])
        self.assertIn("not simulated", first["explanation"])


class NoFutureLeakTests(unittest.TestCase):
    def test_a_decision_card_shows_only_the_past(self):
        player = session()
        point = play_until_card(player)
        card = json.dumps(player.state_json()["pending"])
        future = [e for e in player.sim.timeline if e["sim_time_minutes"] > point.trigger_minute]
        self.assertTrue(future)
        for event in future:
            self.assertNotIn(event["id"], card)
        for name in FUTURE_PLACES:
            self.assertNotIn(name, card)
        self.assertNotIn("comparison", player.state_json())


if __name__ == "__main__":
    unittest.main()
