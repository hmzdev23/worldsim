"""RECAP-001 (#67): the recap storyboard built from a finished run."""

import copy
import io
import json
import re
import sys
import unittest
from contextlib import redirect_stdout
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "services" / "newsroom"))

from worldwire import derive_news  # noqa: E402
from worldwire.impacts import read_impacts  # noqa: E402
from worldwire.storyboard import build_storyboard, load_run, main  # noqa: E402

try:
    from jsonschema import Draft202012Validator
except ImportError:  # pragma: no cover
    Draft202012Validator = None

JAPAN = ROOT / "contracts" / "fixtures" / "japan-earthquake.json"
ICELAND = ROOT / "services" / "director" / "fixtures" / "iceland-eruption.json"
SCHEMA = ROOT / "apps" / "recap" / "storyboard.schema.json"
SAMPLES = ROOT / "apps" / "recap" / "samples"
BEATS = ["hook", "first_hours", "domino", "explainer", "response", "final"]


def japan():
    return json.loads(JAPAN.read_text(encoding="utf-8"))


def numbers(text):
    return {float(n.replace(",", "")) for n in re.findall(r"\d[\d,]*(?:\.\d+)?", text)}


class StoryboardTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.runs = {"japan": japan(), "iceland": load_run(str(ICELAND))}
        cls.boards = {name: build_storyboard(run) for name, run in cls.runs.items()}

    @unittest.skipIf(Draft202012Validator is None, "pip install jsonschema for schema checks")
    def test_storyboards_match_the_schema(self):
        schema = json.loads(SCHEMA.read_text(encoding="utf-8"))
        Draft202012Validator.check_schema(schema)
        validator = Draft202012Validator(schema)
        for name, board in self.boards.items():
            self.assertEqual([e.message for e in validator.iter_errors(board)], [], name)

    def test_committed_samples_are_up_to_date(self):
        for name, sample in (("japan", "japan-earthquake"), ("iceland", "iceland-eruption")):
            path = SAMPLES / f"{sample}.storyboard.json"
            self.assertEqual(json.loads(path.read_text(encoding="utf-8")), self.boards[name],
                             f"regenerate {path.name}: see services/newsroom/README.md")

    def test_beats_run_in_order_and_open_with_the_initiating_event(self):
        for name, board in self.boards.items():
            beats = [scene["beat"] for scene in board["scenes"]]
            self.assertEqual(beats, sorted(beats, key=BEATS.index), name)
            self.assertEqual(beats[0], "hook")
            self.assertEqual(beats[-1], "final")
            self.assertEqual(board["scenes"][0]["event_ids"], [self.runs[name]["events"][0]["id"]])
            ids = [scene["id"] for scene in board["scenes"]]
            self.assertEqual(len(set(ids)), len(ids))

    def test_hooks_are_specific_to_the_hazard(self):
        self.assertEqual(self.boards["japan"]["scenes"][0]["overlay"], "M7.8 EARTHQUAKE HITS JAPAN")
        self.assertEqual(self.boards["iceland"]["scenes"][0]["overlay"], "VOLCANO ERUPTS IN ICELAND")
        for board in self.boards.values():
            self.assertTrue(board["scenes"][0]["narration"].startswith("In this fictional simulation"))
            self.assertEqual(board["label"], "FICTIONAL SIMULATION")

    def test_vignettes_use_reported_figures_and_newsroom_headlines(self):
        run = self.runs["japan"]
        headlines = {item["event_id"]: item["headline"] for item in derive_news(run["events"])}
        events = {event["id"]: event for event in run["events"]}
        vignettes = [s for s in self.boards["japan"]["scenes"] if s["kind"] == "vignette"]
        self.assertIn("2.3 MILLION HOMES WITHOUT POWER", [s["overlay"] for s in vignettes])
        for scene in vignettes:
            [event_id] = scene["event_ids"]
            self.assertEqual(scene["caption"], headlines[event_id])
            figure = scene["data"]["figure"]
            if figure:
                self.assertEqual(figure["value"], read_impacts(events[event_id])[figure["key"]],
                                 "the figure is that event's own snapshot")
        self.assertTrue(all(s["overlay"].startswith("DAY ") for s in vignettes if s["beat"] == "domino"))

    def test_figures_are_never_summed(self):
        run = self.runs["japan"]
        text = " ".join(s["overlay"] + " " + s["narration"] for s in self.boards["japan"]["scenes"])
        deaths = [e["payload"]["impacts"]["deaths"] for e in run["events"]]
        self.assertNotIn(float(sum(deaths)), numbers(text))
        final = self.boards["japan"]["scenes"][-1]
        last = read_impacts(run["events"][-1])
        self.assertEqual({s["key"]: s["value"] for s in final["data"]["stats"]},
                         {k: v for k, v in last.items() if k != "aid_contributors" and v})

    def test_final_card_shows_every_statistic(self):
        stats = self.boards["japan"]["scenes"][-1]["data"]["stats"]
        self.assertEqual(len(stats), 11)
        self.assertIn({"key": "deaths", "label": "Deaths", "value": 1480, "display": "1,480"}, stats)
        self.assertIn("1,480 dead", self.boards["japan"]["scenes"][-1]["narration"])

    def test_response_names_each_sender_not_the_destination(self):
        response = next(s for s in self.boards["japan"]["scenes"] if s["kind"] == "map")
        senders = [a["country"] for a in response["data"]["aid"]]
        self.assertEqual(senders, ["United States", "South Korea", "Australia", "Taiwan"])
        self.assertTrue(all(a["destination_country"] == "Japan" for a in response["data"]["aid"]))
        self.assertEqual(response["overlay"], "4 COUNTRIES SEND HELP")
        self.assertNotIn("from Japan", response["narration"])

    def test_explainer_is_labelled_illustration(self):
        for board in self.boards.values():
            [explainer] = [s for s in board["scenes"] if s["kind"] == "explainer"]
            self.assertTrue(explainer["data"]["illustration"])
            self.assertTrue(explainer["narration"].startswith("Illustration:"))

    def test_nothing_is_japan_specific(self):
        text = json.dumps(self.boards["iceland"], ensure_ascii=False)
        for word in ("Japan", "Miyagi", "Sendai", "tsunami"):
            self.assertNotIn(word, text)

    def test_empty_beats_are_skipped(self):
        run = japan()
        run["events"] = [e for e in run["events"] if e["type"] not in ("international_aid", "recovery")]
        beats = [s["beat"] for s in build_storyboard(run)["scenes"]]
        self.assertNotIn("response", beats)
        quake_only = japan()
        quake_only["events"] = quake_only["events"][:1]
        self.assertEqual([s["beat"] for s in build_storyboard(quake_only)["scenes"]], ["hook", "explainer", "final"])
        unknown = japan()
        unknown["events"] = [{**unknown["events"][0], "type": "solar_flare", "payload": {}}]
        self.assertEqual([s["beat"] for s in build_storyboard(unknown)["scenes"]], ["hook"])

    def test_only_applied_events_are_recapped(self):
        run = japan()
        run["events"][3]["status"] = "rejected"
        board = build_storyboard(run)
        self.assertNotIn(run["events"][3]["id"], {i for s in board["scenes"] for i in s["event_ids"]})
        none_applied = copy.deepcopy(run)
        for event in none_applied["events"]:
            event["status"] = "proposed"
        with self.assertRaises(ValueError):
            build_storyboard(none_applied)

    def test_output_is_deterministic(self):
        shuffled = japan()
        shuffled["events"].reverse()
        self.assertEqual(build_storyboard(shuffled), self.boards["japan"])

    def test_cli_prints_the_storyboard(self):
        out = io.StringIO()
        with redirect_stdout(out):
            self.assertEqual(main([str(JAPAN)]), 0)
        self.assertEqual(json.loads(out.getvalue()), self.boards["japan"])


if __name__ == "__main__":
    unittest.main()
