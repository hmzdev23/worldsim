"""The Director runs Claude Code (`claude -p`, Haiku, low effort) by default.

A stub stands in for subprocess.run, so no real model is called.
"""

import json
import os
import subprocess
import sys
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1].parent
sys.path.insert(0, str(ROOT / "services" / "director"))

from worlddirector import DirectorError, load_fixture, prepare_scenario, public_error  # noqa: E402
from worlddirector.contract import OUTPUT_SCHEMA  # noqa: E402
from worlddirector.director import ENGINE_ENV, director_engine, generate  # noqa: E402

PROMPT = "A volcanic eruption closes Iceland's main airport for two days"
RAW = load_fixture("iceland-eruption")


def claude_runner(envelope=None, *, stdout=None, exc=None, returncode=0, seen=None):
    """Stand-in for subprocess.run(claude -p ...): prints a --output-format json envelope."""

    def run(cmd, **kw):
        if seen is not None:
            seen.setdefault("calls", []).append({"cmd": cmd, **kw})
        if exc is not None:
            raise exc
        out = stdout if stdout is not None else json.dumps(envelope)
        return subprocess.CompletedProcess(cmd, returncode, stdout=out, stderr="claude: trace")

    return run


def success(raw=RAW):
    return {"type": "result", "subtype": "success", "is_error": False,
            "result": json.dumps(raw), "structured_output": raw}


def flag(cmd, name):
    return cmd[cmd.index(name) + 1]


@mock.patch.dict(os.environ, {ENGINE_ENV: ""})
@mock.patch("shutil.which", return_value="/usr/local/bin/claude")
class ClaudeEngineTest(unittest.TestCase):
    def test_default_engine_is_claude_haiku_low_effort(self, _):
        self.assertEqual(director_engine(), "claude")
        seen = {}
        batch = prepare_scenario(PROMPT, simulation_id="run-claude", runner=claude_runner(success(), seen=seen), seed=7)
        [call] = seen["calls"]
        cmd = call["cmd"]
        self.assertEqual(cmd[:2], ["/usr/local/bin/claude", "-p"])
        self.assertEqual(flag(cmd, "--model"), "haiku")
        self.assertEqual(flag(cmd, "--effort"), "low")
        self.assertEqual(flag(cmd, "--output-format"), "json")
        schema = json.loads(flag(cmd, "--json-schema"))
        events = schema["properties"]["events"]
        self.assertEqual((events["minItems"], events["maxItems"]), (6, 12), "a new scenario: 6-12 events")
        self.assertIn("6-12 events", call["input"])
        event = events["items"]
        self.assertTrue(event["additionalProperties"] and event["properties"]["location"]["additionalProperties"])
        self.assertIn("type", event["required"])
        self.assertNotIn("magnitude", event["required"], "nullable keys may be left out")
        self.assertNotIn("maxItems", OUTPUT_SCHEMA["properties"]["events"], "the shared schema is unchanged")
        self.assertFalse(OUTPUT_SCHEMA["properties"]["events"]["items"]["additionalProperties"])
        self.assertEqual(flag(cmd, "--tools"), "", "no tools: the Director only writes JSON")
        self.assertEqual(flag(cmd, "--setting-sources"), "", "no user or project settings")
        self.assertIn("--strict-mcp-config", cmd)
        self.assertIn("--no-session-persistence", cmd)
        self.assertIn(PROMPT, call["input"])
        self.assertNotEqual(Path(call["cwd"]).resolve(), ROOT.resolve(), "runs in an empty folder, not the repo")
        self.assertEqual(batch["simulation_id"], "run-claude")
        self.assertTrue(all(e["provenance"] == {"source": "model", "model": "haiku"} for e in batch["events"]))

    def test_each_seed_gives_the_model_different_directions(self, _):
        prompts = []
        for seed in (1, 2, 3):
            seen = {}
            prepare_scenario(PROMPT, simulation_id=f"run-{seed}", runner=claude_runner(success(), seen=seen), seed=seed)
            prompts.append(seen["calls"][0]["input"])
        self.assertEqual(len(set(prompts)), 3, "a new seed changes what the model is asked for")

    def test_falls_back_to_the_result_text(self, _):
        envelope = {**success(), "structured_output": None}
        batch = generate(PROMPT, runner=claude_runner(envelope))
        self.assertEqual(len(batch["events"]), len(RAW["events"]))

    def test_failures_are_typed(self, _):
        cases = {
            "claude_timeout": claude_runner(exc=subprocess.TimeoutExpired("claude", 5)),
            "claude_failed": claude_runner(success(), returncode=1),
            "invalid_json": claude_runner(stdout="Sorry, I can't help with that."),
            "invalid_events": claude_runner(success({"events": [{"type": "meteor"}]})),
        }
        for code, runner in cases.items():
            with self.subTest(code=code), self.assertRaises(DirectorError) as ctx:
                prepare_scenario(PROMPT, simulation_id="run-x", runner=runner)
            self.assertEqual(ctx.exception.code, code)

    def test_reported_error_is_a_failure(self, _):
        envelope = {"type": "result", "subtype": "error_during_execution", "is_error": True, "result": "Not logged in"}
        with self.assertRaises(DirectorError) as ctx:
            generate(PROMPT, runner=claude_runner(envelope))
        self.assertEqual(ctx.exception.code, "claude_failed")
        self.assertIn("Not logged in", ctx.exception.detail)

    def test_a_rejected_answer_is_retried_once_with_the_errors(self, _):
        broken = json.loads(json.dumps(RAW))
        broken["events"][-1]["location"]["lat"] = 200  # not on Earth: only the model can fix this
        answers = iter([success(broken), success()])
        seen = {}

        def runner(cmd, **kw):
            seen.setdefault("calls", []).append({"cmd": cmd, **kw})
            return subprocess.CompletedProcess(cmd, 0, stdout=json.dumps(next(answers)), stderr="")

        batch = prepare_scenario(PROMPT, simulation_id="run-retry", runner=runner, seed=3)
        first, second = seen["calls"]
        self.assertNotIn("rejected by the validator", first["input"])
        self.assertIn("rejected by the validator", second["input"])
        self.assertIn("lat out of range", second["input"], "the validator's own message is fed back")
        self.assertEqual(len(batch["events"]), len(RAW["events"]))

    def test_two_rejected_answers_fail(self, _):
        broken = success({"events": [{"type": "meteor"}]})
        seen = {}
        with self.assertRaises(DirectorError) as ctx:
            prepare_scenario(PROMPT, simulation_id="run-x", runner=claude_runner(broken, seen=seen))
        self.assertEqual(ctx.exception.code, "invalid_events")
        self.assertEqual(len(seen["calls"]), 2, "one retry, then give up")

    def test_no_retry_when_time_is_nearly_up(self, _):
        broken = success({"events": [{"type": "meteor"}]})
        seen = {}
        with self.assertRaises(DirectorError):
            generate(PROMPT, runner=claude_runner(broken, seen=seen), timeout_s=10)
        self.assertEqual(len(seen["calls"]), 1)
        self.assertLessEqual(seen["calls"][0]["timeout"], 10, "the call gets the caller's limit, not more")

    def test_haiku_gets_the_same_prompt_as_codex(self, _):
        from worlddirector.director import CLAUDE_SYSTEM_PROMPT
        claude_seen, codex_seen = {}, {}
        generate(PROMPT, runner=claude_runner(success(), seen=claude_seen), seed=11, tone="satirical", engine="claude")

        def codex_runner(cmd, **kw):
            codex_seen["input"] = kw["input"]
            Path(cmd[cmd.index("--output-last-message") + 1]).write_text(json.dumps(RAW), encoding="utf-8")
            return subprocess.CompletedProcess(cmd, 0, stdout="", stderr="")

        with mock.patch("shutil.which", return_value="/usr/local/bin/codex"):
            generate(PROMPT, runner=codex_runner, seed=11, tone="satirical", engine="codex")
        [call] = claude_seen["calls"]
        self.assertEqual(call["input"], codex_seen["input"], "the Director prompt is byte-for-byte the same")
        self.assertEqual(flag(call["cmd"], "--system-prompt"), CLAUDE_SYSTEM_PROMPT,
                         "Claude Code's own coding-agent prompt is replaced by one neutral line")

    def test_notes_and_missing_nulls_are_fixed_not_retried(self, _):
        sloppy = json.loads(json.dumps(RAW))
        for event in sloppy["events"]:
            event["location"]["name_note"] = "near the old harbour"
            event["sim_time_minutes_note"] = "estimate"
            del event["magnitude"]  # a nullable key left out
            if event.get("impacts"):
                event["impacts"].pop("debris_tonnes", None)
                event["impacts"]["contamination_area_km2"] = 5  # misspelled: dropped, real key becomes null
        seen = {}
        batch = generate(PROMPT, runner=claude_runner(success(sloppy), seen=seen))
        self.assertEqual(len(seen["calls"]), 1, "no rewrite for harmless slips")
        self.assertEqual(len(batch["events"]), len(RAW["events"]))
        for event in batch["events"]:
            self.assertEqual(set(event["location"]), {"name", "country", "country_code", "lat", "lon"})

    def test_a_falling_running_total_is_carried_up_not_retried(self, _):
        slipped = json.loads(json.dumps(RAW))
        totals = [e["impacts"]["injuries"] for e in slipped["events"] if e.get("impacts")]
        slipped["events"][-1]["impacts"]["injuries"] = 1  # the event's own count, not the total
        last_aid = next(e for e in reversed(slipped["events"]) if (e.get("impacts") or {}).get("aid_contributors"))
        dropped = last_aid["impacts"]["aid_contributors"].pop(0)  # a country "disappears"
        seen = {}
        batch = generate(PROMPT, runner=claude_runner(success(slipped), seen=seen))
        self.assertEqual(len(seen["calls"]), 1)
        self.assertEqual(batch["events"][-1]["payload"]["impacts"]["injuries"], max(totals))
        countries = {c["country"] for e in batch["events"]
                     for c in (e["payload"].get("impacts") or {}).get("aid_contributors", [])}
        self.assertIn(dropped["country"], countries)

    def test_missing_required_facts_are_still_rejected(self, _):
        broken = json.loads(json.dumps(RAW))
        del broken["events"][0]["severity"]
        with self.assertRaises(DirectorError) as ctx:
            generate(PROMPT, runner=claude_runner(success(broken)))
        self.assertEqual(ctx.exception.code, "invalid_events")

    def test_codex_is_still_available(self, _):
        self.assertEqual(director_engine("codex"), "codex")
        with mock.patch.dict(os.environ, {ENGINE_ENV: "codex"}):
            self.assertEqual(director_engine(), "codex")
        with self.assertRaises(DirectorError) as ctx:
            director_engine("gemini")
        self.assertEqual(ctx.exception.code, "invalid_request")


class ClaudeMissingTest(unittest.TestCase):
    def test_missing_claude(self):
        with mock.patch.dict(os.environ, {ENGINE_ENV: ""}), mock.patch("shutil.which", return_value=None), \
                self.assertRaises(DirectorError) as ctx:
            prepare_scenario(PROMPT, simulation_id="run-x")
        self.assertEqual(ctx.exception.code, "claude_missing")

    def test_public_errors(self):
        for code, (state, retry) in {"claude_timeout": ("timeout", True), "claude_failed": ("unavailable", True),
                                     "claude_missing": ("unavailable", False)}.items():
            body = public_error(DirectorError(code, "x", "secret detail"))
            self.assertEqual((body["state"], body["retryable"]), (state, retry), code)
            self.assertNotIn("secret", json.dumps(body))


if __name__ == "__main__":
    unittest.main()
