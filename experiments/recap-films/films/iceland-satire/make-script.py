#!/usr/bin/env python3
"""Write script.json for the satirical Iceland recap from the WORLD//WIRE satire layer.

Every headline, post and statistic comes from worldwire.satire run over the
Iceland eruption fixture (services/director/fixtures/iceland-eruption.json),
so the film says what the live app says. Facts and impact estimates are not
used for jokes and do not appear in the film.

    python3 make-script.py [--tone satirical|unhinged]
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = next(p for p in HERE.parents if (p / "services" / "newsroom").is_dir())
sys.path[:0] = [str(ROOT / "services" / "newsroom"), str(ROOT / "services" / "director")]

from worlddirector import generate  # noqa: E402
from worldwire import satire_for_events  # noqa: E402
from worldwire.wire import format_sim_time  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tone", choices=("satirical", "unhinged"), default="satirical")
    args = parser.parse_args()

    batch = generate(fixture="iceland-eruption", simulation_id="satire-iceland")
    events = [{**e, "status": "applied"} for e in batch["events"]]
    by_id = {e["id"]: e for e in events}
    layer = satire_for_events(events, args.tone)
    item = {i["event_id"]: i for i in layer["items"]}
    posts = list(reversed(layer["posts"]))  # oldest first
    stats = {m["key"]: m["value"] for m in layer["absurdity"]}

    def post(match) -> dict:
        found = next(p for p in posts if match(p))
        return {k: found[k] for k in ("author", "handle", "text", "event_id")}

    airline = post(lambda p: p["kind"] == "airline")
    briefing = post(lambda p: "fluid" in p["tags"] or "press_conference" in p["tags"])
    committee = post(lambda p: "committee" in p["tags"])
    end = by_id["evt-0008"]
    days = end["sim_time_minutes"] // 1440 + 1

    def count(n: int, word: str) -> str:
        return f"{n} {word}" if n == 1 else f"{n} {word}s"

    def spoken(text: str) -> str:
        return text.replace("Dept.", "Department").replace("™", "")

    def when(event_id: str) -> str:
        return format_sim_time(by_id[event_id]["sim_time_minutes"])

    shots = [
        {"scene": "map", "event_id": "evt-0001", "date": when("evt-0001"),
         "headline": item["evt-0001"]["headline"],
         "narration": f"Good evening. {item['evt-0001']['headline'].rstrip('.')}."},
        {"scene": "eruption", "event_id": "evt-0001", "date": when("evt-0001"),
         "headline": "Volcano declines to comment",
         "narration": item["evt-0001"]["dek"]},
        {"scene": "evacuation", "event_id": "evt-0002", "date": when("evt-0002"),
         "headline": item["evt-0002"]["headline"],
         "narration": f"{item['evt-0002']['headline']}."},
        {"scene": "power", "event_id": "evt-0003", "date": when("evt-0003"),
         "headline": item["evt-0003"]["headline"],
         "narration": f"{item['evt-0003']['headline']}."},
        {"scene": "airport", "event_id": "evt-0005", "date": when("evt-0005"),
         "headline": item["evt-0005"]["headline"], "post": airline,
         "narration": f"Flights are grounded. {airline['author']} has a new fare."},
        {"scene": "briefing", "event_id": briefing["event_id"], "date": when(briefing["event_id"]),
         "headline": "The situation remains fluid", "post": briefing,
         "narration": f"The {briefing['author']} confirms the situation remains fluid."},
        {"scene": "aid", "event_id": "evt-0006", "date": when("evt-0006"),
         "headline": item["evt-0006"]["headline"], "post": committee,
         "narration": f"{item['evt-0006']['headline']}."},
        {"scene": "summary", "event_id": "evt-0008", "date": when("evt-0008"),
         "headline": item["evt-0008"]["headline"],
         "narration": (f"Day {days}: {count(stats['committees'], 'committee')}, "
                       f"{count(stats['press_conferences'], 'press conference')} and "
                       f"{count(stats['apologies'], 'corporate apology').replace('apologys', 'apologies')}. "
                       "The volcano declined to comment.")},
    ]
    for shot in shots:
        shot["narration"] = spoken(shot["narration"])
    script = {
        "title": item["evt-0001"]["headline"],
        "tone": args.tone,
        "label": "WORLD//SIM · SATIRE · FICTIONAL",
        "disclaimer": "Fictional simulation. Every event, company, statement and statistic is invented.",
        "source": {"fixture": "iceland-eruption", "layer": "worldwire.satire"},
        "stats": layer["absurdity"],
        "shots": shots,
    }
    (HERE / "script.json").write_text(json.dumps(script, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    for i, shot in enumerate(shots, 1):
        print(f"{i}. [{shot['scene']}] {shot['narration']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
