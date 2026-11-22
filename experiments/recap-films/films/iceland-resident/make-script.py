#!/usr/bin/env python3
"""Write script.json: the Iceland eruption seen through one invented resident, Sigrún.

Same humor as the other films: facts from the fixture narrated plainly, the
jokes arrive on her phone from worldwire.satire (aimed at institutions), a
running gag (her flight) pays off at the end, and a stats card closes. Casualty
estimates are never used.

    python3 make-script.py [--tone satirical|unhinged] [--name Sigrún]
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

WORDS = {1: "one", 2: "two", 3: "three", 4: "four"}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tone", choices=("satirical", "unhinged"), default="satirical")
    parser.add_argument("--name", default="Sigrún")
    args = parser.parse_args()
    name = args.name

    events = [{**e, "status": "applied"} for e in generate(fixture="iceland-eruption", simulation_id="resident-iceland")["events"]]
    layer = satire_for_events(events, args.tone)
    posts = list(reversed(layer["posts"]))
    first = lambda k: next(e for e in events if e["type"] == k)  # noqa: E731
    eruption, evac, outage = first("volcanic_eruption"), first("evacuation"), first("infrastructure_failure")
    flights, aid, recovery = first("economic_shock"), first("international_aid"), first("recovery")
    home = evac["location"]["name"]
    day = lambda e: WORDS[e["sim_time_minutes"] // 1440 + 1]  # noqa: E731
    at = lambda e, d=0: format_sim_time(e["sim_time_minutes"] + d)  # noqa: E731

    def note(event: dict, prefer: tuple = ()) -> dict:
        mine = [p for p in posts if p["event_id"] == event["id"]]
        pick = next((p for p in mine if p["kind"] in prefer), mine[0])
        return {k: pick[k] for k in ("author", "handle", "text")}

    shots = [
        {"scene": "home", "event_id": eruption["id"], "date": at(eruption, -1), "lower_third": f"{name.upper()} · {home.upper()}",
         "narration": f"This is {name}, in {home}. At three in the morning, she was packing for a flight."},
        {"scene": "eruption", "event_id": eruption["id"], "date": at(eruption), "notification": note(eruption, ("airline",)),
         "narration": "Then the ground opened outside town. Her airline already had a new fare."},
        {"scene": "evacuation", "event_id": evac["id"], "date": at(evac), "notification": note(evac, ("airline",)),
         "narration": f"{name} evacuated in an orderly queue, according to the brochure."},
        {"scene": "shelter", "event_id": outage["id"], "date": at(outage), "notification": note(outage, ("company",)),
         "narration": "At the shelter, the power went out. Her phone suggested a subscription."},
        {"scene": "airport", "event_id": flights["id"], "date": at(flights), "notification": note(flights, ("company",)),
         "narration": "By evening, every flight was grounded. Including hers."},
        {"scene": "aid", "event_id": aid["id"], "date": at(aid), "notification": note(aid, ("committee",)),
         "narration": f"Day {day(aid)}: help from {aid['payload']['origin']}, and a six-hundred-page customs form."},
        {"scene": "home-again", "event_id": recovery["id"], "date": at(recovery), "notification": note(recovery, ("company",)),
         "narration": f"Day {day(recovery)}: the power came back. Her flight did not."},
    ]
    stats = [{"label": "Notifications received", "value": len(posts)}] + [
        {"label": m["label"], "value": m["value"]} for m in layer["absurdity"] if m["value"]
    ] + [{"label": "Flights taken", "value": 0}]
    script = {
        "title": f"{name}'s three days",
        "person": {"name": name, "home": home},
        "tone": args.tone,
        "outro_seconds": 3.5,
        "stats_title": f"{name.upper()}'S THREE DAYS",
        "disclaimer": f"Fictional simulation. {name}, every company, statement and statistic here is invented.",
        "source": {"fixture": "iceland-eruption", "layer": "worldwire.satire"},
        "stats": stats,
        "shots": shots,
    }
    (HERE / "script.json").write_text(json.dumps(script, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    for i, shot in enumerate(shots, 1):
        extra = f"  [phone: {shot['notification']['handle']}]" if "notification" in shot else ""
        print(f"{i}. {shot['date']} {shot['narration']}{extra}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
