"""Director tone and the optional payload.satire layer (local experiment).

Satire rides in the same model call, is validated like everything else, and
never loosens the existing rules (order, causes, impacts, whole-batch rejection).
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

from worlddirector import OUTPUT_SCHEMA, DirectorError, build_batch, build_prompt, load_fixture, prepare_scenario  # noqa: E402

try:
    from jsonschema import Draft202012Validator
except ImportError:  # pragma: no cover
    Draft202012Validator = None

SATIRE = {
    "headline": "Volcano promises to respect international aviation norms",
    "dek": "Officials are confident the ash will stay in its designated airspace. The volcano declined to comment.",
    "posts": [{"author": "ThriftJet Air", "handle": "@ThriftJetAir", "kind": "airline",
               "text": "Our VolcanoFlex fare changes whenever the volcano does."}],
}


def raw_with_satire():
    raw = copy.deepcopy(load_fixture("iceland-eruption"))
    for ev in raw["events"]:
        ev["satire"] = None
    raw["events"][0]["satire"] = copy.deepcopy(SATIRE)
    return raw


def build(raw):
    return build_batch(raw, simulation_id="run-satire", source="model", model="m", max_events=12)


class PromptTest(unittest.TestCase):
    def test_straight_prompt_asks_for_null_satire(self):
        prompt = build_prompt("A volcano erupts in Iceland")
        self.assertIn("satire: null for every event", prompt)
        self.assertNotIn("INVENTED", prompt)

    def test_satirical_and_unhinged_prompts(self):
        for tone in ("satirical", "unhinged"):
            prompt = build_prompt("A volcano erupts in Iceland", tone=tone)
            self.assertIn(f"satire: a {tone} presentation layer", prompt)
            self.assertIn("never joke", prompt.lower())
            self.assertIn("INVENTED", prompt)
            self.assertIn("type,\n  times, places, description and impacts stay plain and serious", prompt)
        self.assertIn("escalate", build_prompt("x", tone="unhinged"))

    def test_bad_tone(self):
        with self.assertRaises(DirectorError) as ctx:
            build_prompt("x", tone="spicy")
        self.assertEqual(ctx.exception.code, "invalid_request")

    def test_output_schema_is_still_strict(self):
        item = OUTPUT_SCHEMA["properties"]["events"]["items"]
        self.assertIn("satire", item["required"])
        self.assertEqual(set(item["required"]), set(item["properties"]))
        obj = item["properties"]["satire"]["anyOf"][0]
        self.assertFalse(obj["additionalProperties"])
        self.assertEqual(set(obj["required"]), set(obj["properties"]))


class ValidationTest(unittest.TestCase):
    def test_satire_lands_in_payload_without_touching_facts(self):
        plain = build(load_fixture("iceland-eruption"))
        withs = build(raw_with_satire())
        self.assertEqual(withs["events"][0]["payload"]["satire"], SATIRE)
        for a, b in zip(plain["events"], withs["events"]):
            b = copy.deepcopy(b); b["payload"].pop("satire", None)
            a = {**a, "provenance": b["provenance"]}
            self.assertEqual(a, b)
        self.assertTrue(all("satire" not in e["payload"] for e in withs["events"][1:]))  # null -> omitted

    def test_fixtures_without_the_key_still_validate(self):
        self.assertEqual(len(build(load_fixture("iceland-eruption"))["events"]), 8)

    @unittest.skipIf(Draft202012Validator is None, "pip install jsonschema for schema checks")
    def test_contract_accepts_satire(self):
        schema = json.loads((ROOT / "contracts" / "events.schema.json").read_text(encoding="utf-8"))
        self.assertEqual([e.message for e in Draft202012Validator(schema).iter_errors(build(raw_with_satire()))], [])

    def test_bad_satire_rejects_the_whole_batch(self):
        cases = {
            "handle": lambda s: s["posts"][0].update(handle="no spaces allowed"),
            "kind": lambda s: s["posts"][0].update(kind="politician"),
            "headline": lambda s: s.update(headline="x" * 141),
            "extra": lambda s: s.update(impacts={"deaths": 0}),
            "post keys": lambda s: s["posts"][0].update(verified=True),
            "too many": lambda s: s.update(posts=s["posts"] * 5),
        }
        for name, breaker in cases.items():
            raw = raw_with_satire()
            breaker(raw["events"][0]["satire"])
            with self.subTest(name), self.assertRaises(DirectorError) as ctx:
                build(raw)
            self.assertEqual(ctx.exception.code, "invalid_events")

    def test_satire_cannot_smuggle_in_bad_events(self):
        raw = raw_with_satire()
        raw["events"][-1]["impacts"]["economic_loss_usd"] = 1  # running total falls
        with self.assertRaises(DirectorError):
            build(raw)


class RunnerTest(unittest.TestCase):
    def test_tone_reaches_the_model_prompt(self):
        seen = {}

        def runner(cmd, **kw):
            seen.update(kw)
            Path(cmd[cmd.index("--output-last-message") + 1]).write_text(json.dumps(raw_with_satire()), encoding="utf-8")
            return subprocess.CompletedProcess(cmd, 0, stdout="", stderr="")

        with mock.patch("shutil.which", return_value="/usr/local/bin/codex"):
            batch = prepare_scenario("A volcano erupts in Iceland", simulation_id="run-s", tone="satirical", runner=runner)
        self.assertIn("satire: a satirical presentation layer", seen["input"])
        self.assertEqual(batch["events"][0]["payload"]["satire"]["headline"], SATIRE["headline"])

    def test_bad_tone_is_a_request_error(self):
        with self.assertRaises(DirectorError) as ctx:
            prepare_scenario("x", simulation_id="run-s", tone="spicy", fixture="iceland-eruption")
        self.assertEqual(ctx.exception.code, "invalid_request")

    def test_fixture_runs_accept_any_tone(self):
        batch = prepare_scenario("x", simulation_id="run-s", tone="unhinged", fixture="iceland-eruption")
        self.assertEqual(len(batch["events"]), 8)


if __name__ == "__main__":
    unittest.main()
