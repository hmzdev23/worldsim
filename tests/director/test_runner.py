"""DIR-005: prepare_scenario, the prompt -> run batch call for the scenario service.

Deterministic: fixture runs need no model, and the model path is driven by a
stub runner standing in for the Codex subprocess.
"""

import copy
import json
import subprocess
import sys
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "services" / "director"))

from worlddirector import RUN_FIXTURES, DirectorError, load_fixture, prepare_scenario, public_error  # noqa: E402
from worlddirector.director import DEFAULT_TIMEOUT_S  # noqa: E402

try:
    from jsonschema import Draft202012Validator
except ImportError:  # pragma: no cover
    Draft202012Validator = None

try:
    sys.path.insert(0, str(ROOT / "services" / "simulation"))
    from worldsim_sim import Simulation
except Exception:  # pragma: no cover - simulation deps missing
    Simulation = None

PROMPT = "A fissure eruption opens on Iceland's Reykjanes Peninsula"


def codex_runner(output=None, *, exc=None, returncode=0, seen=None):
    """Stand-in for subprocess.run(codex ...): writes `output` as the last message."""

    def run(cmd, **kw):
        if seen is not None:
            seen.update(cmd=cmd, **kw)
        if exc is not None:
            raise exc
        if output is not None:
            Path(cmd[cmd.index("--output-last-message") + 1]).write_text(output, encoding="utf-8")
        return subprocess.CompletedProcess(cmd, returncode, stdout="", stderr="codex: internal trace")

    return run


def with_codex(fn):
    """Pretend a codex binary is installed; the runner stub replaces the process."""
    return mock.patch("shutil.which", return_value="/usr/local/bin/codex")(fn)


def assert_run_batch(case, batch, simulation_id, branch_id="main"):
    case.assertEqual((batch["simulation_id"], batch["branch_id"]), (simulation_id, branch_id))
    events = batch["events"]
    case.assertTrue(events)
    case.assertTrue(all(e["status"] == "proposed" for e in events))
    case.assertEqual([e["id"] for e in events], [f"evt-{i:04d}" for i in range(1, len(events) + 1)])
    keys = [(e["sim_time_minutes"], e["sequence"]) for e in events]
    case.assertEqual(keys, sorted(keys))
    at = {e["id"]: e["sim_time_minutes"] for e in events}
    for e in events:
        for parent in e["parent_ids"]:
            case.assertLessEqual(at[parent], e["sim_time_minutes"])  # KeyError if the link dangles
    if Draft202012Validator is not None:
        schema = json.loads((ROOT / "contracts" / "events.schema.json").read_text(encoding="utf-8"))
        case.assertEqual([err.message for err in Draft202012Validator(schema).iter_errors(batch)], [])


class FixtureRunTest(unittest.TestCase):
    def test_iceland_run_uses_requested_ids(self):
        batch = prepare_scenario(PROMPT, simulation_id="run-7f3a", branch_id="main", fixture="iceland-eruption")
        assert_run_batch(self, batch, "run-7f3a")
        self.assertEqual(len(batch["events"]), 8)
        self.assertNotIn("JPN", {e["location"]["country_code"] for e in batch["events"]})
        self.assertTrue(all(e["provenance"] == {"source": "fixture"} for e in batch["events"]))

    def test_second_distinct_scenario(self):
        batch = prepare_scenario("A new virus spreads from Singapore", simulation_id="run-pandemic", fixture="global-pandemic")
        assert_run_batch(self, batch, "run-pandemic")
        self.assertEqual(batch["events"][0]["type"], "disease_outbreak")

    def test_repeated_launches_are_independent(self):
        a = prepare_scenario(PROMPT, simulation_id="run-a", fixture="iceland-eruption")
        b = prepare_scenario(PROMPT, simulation_id="run-b", branch_id="alt", fixture="iceland-eruption")
        assert_run_batch(self, b, "run-b", "alt")
        a["events"][0]["payload"]["description"] = "mutated"
        self.assertNotEqual(b["events"][0]["payload"]["description"], "mutated")
        self.assertEqual([e["id"] for e in a["events"]], [e["id"] for e in b["events"]])  # each run starts at evt-0001

    def test_every_run_fixture_is_a_complete_run(self):
        for name in RUN_FIXTURES:
            assert_run_batch(self, prepare_scenario("sample", simulation_id=f"run-{name}", fixture=name), f"run-{name}")

    def test_fixture_runs_still_validate_the_prompt(self):
        for prompt in ("", "   ", "x" * 2001, None):
            with self.assertRaises(DirectorError) as ctx:
                prepare_scenario(prompt, simulation_id="run-1", fixture="iceland-eruption")
            self.assertEqual(ctx.exception.code, "invalid_scenario")

    def test_unknown_or_history_only_fixture(self):
        for name in ("nope", "japan-earthquake-continued", "../secrets"):
            with self.assertRaises(DirectorError) as ctx:
                prepare_scenario(PROMPT, simulation_id="run-1", fixture=name)
            self.assertEqual(ctx.exception.code, "fixture_missing")

    def test_bad_run_ids(self):
        for kw in ({"simulation_id": ""}, {"simulation_id": "Run 1"}, {"simulation_id": None}, {"simulation_id": "ok", "branch_id": "a/b"}):
            with self.assertRaises(DirectorError) as ctx:
                prepare_scenario(PROMPT, fixture="iceland-eruption", **kw)
            self.assertEqual(ctx.exception.code, "invalid_request")

    @unittest.skipIf(Simulation is None, "needs services/simulation and its requirements")
    def test_two_runs_play_in_separate_engines(self):
        sims = {}
        for sid, fixture in (("run-ice", "iceland-eruption"), ("run-flu", "global-pandemic")):
            batch = prepare_scenario(PROMPT, simulation_id=sid, fixture=fixture)
            sims[sid] = Simulation(simulation_id=sid, branch_id="main")
            _, rejected = sims[sid].ingest(batch)
            self.assertEqual(rejected, [])
        sims["run-ice"].advance(60 * 24)
        self.assertEqual(sims["run-flu"].now, 0)
        self.assertTrue(sims["run-ice"].snapshot()["events"])
        self.assertTrue(all(e["location"]["country_code"] in ("ISL", "GBR") for e in sims["run-ice"].snapshot()["events"]))


class ModelRunTest(unittest.TestCase):
    """The same call without a fixture goes through the Codex path."""

    @with_codex
    def test_model_output_becomes_a_run_batch(self, _):
        seen = {}
        raw = json.dumps(load_fixture("iceland-eruption"))
        batch = prepare_scenario(PROMPT, simulation_id="run-live", runner=codex_runner(raw, seen=seen))
        assert_run_batch(self, batch, "run-live")
        self.assertEqual(batch["events"][0]["provenance"]["source"], "model")
        self.assertIn("Reykjanes", seen["input"])
        self.assertNotIn("<<<HISTORY", seen["input"])  # a new run never continues another one
        self.assertEqual(seen["timeout"], DEFAULT_TIMEOUT_S)

    @with_codex
    def test_timeout_is_bounded(self, _):
        for asked, used in ((0.01, 5.0), (90, 90.0), (10_000, 600.0)):
            seen = {}
            prepare_scenario(PROMPT, simulation_id="run-t", timeout_s=asked,
                             runner=codex_runner(json.dumps(load_fixture("iceland-eruption")), seen=seen))
            self.assertEqual(seen["timeout"], used)
        with self.assertRaises(DirectorError) as ctx:
            prepare_scenario(PROMPT, simulation_id="run-t", timeout_s="soon")
        self.assertEqual(ctx.exception.code, "invalid_request")

    @with_codex
    def test_unfamiliar_hazard_uses_labelled_other_hazard(self, _):
        raw = load_fixture("iceland-eruption")
        raw["events"][0].update(type="other_hazard", vei=None, label="solar superstorm")
        batch = prepare_scenario("A solar superstorm", simulation_id="run-sun", runner=codex_runner(json.dumps(raw)))
        self.assertEqual(batch["events"][0]["payload"]["label"], "solar superstorm")
        self.assertEqual(batch["events"][0]["visual"], "breaking_news")
        raw["events"][0]["label"] = None
        with self.assertRaises(DirectorError) as ctx:
            prepare_scenario("A solar superstorm", simulation_id="run-sun", runner=codex_runner(json.dumps(raw)))
        self.assertEqual(ctx.exception.code, "invalid_events")

    @with_codex
    def test_failures_are_typed_and_never_partial(self, _):
        broken = copy.deepcopy(load_fixture("iceland-eruption"))
        broken["events"][-1]["caused_by"] = [99]  # one bad event spoils the whole batch
        cases = {
            "codex_timeout": codex_runner(exc=subprocess.TimeoutExpired("codex", 5)),
            "invalid_json": codex_runner("Sorry, I can't help with that."),
            "invalid_events": codex_runner(json.dumps(broken)),
            "codex_failed": codex_runner(returncode=2),
        }
        for code, runner in cases.items():
            with self.subTest(code=code), self.assertRaises(DirectorError) as ctx:
                prepare_scenario(PROMPT, simulation_id="run-x", runner=runner)
            self.assertEqual(ctx.exception.code, code)

    @with_codex
    def test_unexpected_runner_crash_is_typed(self, _):
        with self.assertRaises(DirectorError) as ctx:
            prepare_scenario(PROMPT, simulation_id="run-x", runner=codex_runner(exc=PermissionError("denied")))
        self.assertEqual(ctx.exception.code, "codex_failed")

    def test_missing_codex(self):
        with mock.patch("shutil.which", return_value=None), self.assertRaises(DirectorError) as ctx:
            prepare_scenario(PROMPT, simulation_id="run-x")
        self.assertEqual(ctx.exception.code, "codex_missing")


class PublicErrorTest(unittest.TestCase):
    EXPECTED = {
        "invalid_scenario": ("invalid_prompt", False, 422),
        "invalid_request": ("invalid_request", False, 400),
        "codex_timeout": ("timeout", True, 504),
        "invalid_json": ("invalid_output", True, 502),
        "invalid_events": ("invalid_output", True, 502),
        "codex_failed": ("unavailable", True, 503),
        "codex_missing": ("unavailable", False, 503),
        "fixture_missing": ("unavailable", False, 500),
    }

    def test_mapping(self):
        for code, (state, retryable, status) in self.EXPECTED.items():
            out = public_error(DirectorError(code, "raw message", "Traceback: secret model output"))
            self.assertEqual((out["error"], out["state"], out["retryable"], out["status"]), (code, state, retryable, status))
            self.assertTrue(out["message"])
            self.assertNotIn("secret", json.dumps(out))
            self.assertNotIn("raw message", out["message"])

    def test_unknown_errors_get_a_generic_retryable_state(self):
        for err in (DirectorError("something_new", "x"), RuntimeError("boom")):
            out = public_error(err)
            self.assertEqual((out["state"], out["retryable"], out["status"]), ("unavailable", True, 500))
            self.assertNotIn("boom", json.dumps(out))


if __name__ == "__main__":
    unittest.main()
