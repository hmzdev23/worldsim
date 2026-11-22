#!/usr/bin/env python3
"""Write script.json: the Iceland eruption seen through one invented resident, Sigrún.

Facts come from the fixture; the satire lives in the airport and emergency
infrastructure. There are no phone notifications. Her flight remains the
running gag, and casualty estimates are never used.

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
    first = lambda k: next(e for e in events if e["type"] == k)  # noqa: E731
    eruption, evac, outage = first("volcanic_eruption"), first("evacuation"), first("infrastructure_failure")
    flights, aid, recovery = first("economic_shock"), first("international_aid"), first("recovery")
    home = evac["location"]["name"]
    day = lambda e: WORDS[e["sim_time_minutes"] // 1440 + 1]  # noqa: E731
    at = lambda e, d=0: format_sim_time(e["sim_time_minutes"] + d)  # noqa: E731

    shots = [
        {"scene": "home", "event_id": eruption["id"], "date": at(eruption, -1), "lower_third": f"{name.upper()} · {home.upper()}",
         "narration": f"This is {name}, in {home}. At three in the morning, she was packing for a flight."},
        {"scene": "eruption", "event_id": eruption["id"], "date": at(eruption),
         "narration": "Then the ground opened outside town. The airport departure board started cancelling flights."},
        {"scene": "evacuation", "event_id": evac["id"], "date": at(evac),
         "narration": f"{name} joined the road out. A sign assured drivers the queue was moving smoothly."},
        {"scene": "shelter", "event_id": outage["id"], "date": at(outage),
         "narration": "At the shelter, the power went out. The glowing exit sign became the room's main attraction."},
        {"scene": "airport", "event_id": flights["id"], "date": at(flights),
         "narration": "By evening, every flight was grounded. The board still asked everyone to keep checking."},
        {"scene": "aid", "event_id": aid["id"], "date": at(aid),
         "narration": f"Day {day(aid)}: help from {aid['payload']['origin']}. Officials posed beside the supplies before unloading them."},
        {"scene": "home-again", "event_id": recovery["id"], "date": at(recovery),
         "narration": f"Day {day(recovery)}: the power came back. Her flight did not."},
    ]
    stats = [
        {"label": m["label"], "value": m["value"]} for m in layer["absurdity"] if m["value"]
    ] + [{"label": "Flights taken", "value": 0}]
    script = {
        "title": f"{name}'s three days",
        "person": {"name": name, "home": home},
        "tone": args.tone,
        "outro_seconds": 3.5,
        "stats_title": f"{name.upper()}'S THREE DAYS",
        "source": {"fixture": "iceland-eruption", "layer": "worldwire.satire"},
        "stats": stats,
        "shots": shots,
    }
    (HERE / "script.json").write_text(json.dumps(script, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    for i, shot in enumerate(shots, 1):
        print(f"{i}. {shot['date']} {shot['narration']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
