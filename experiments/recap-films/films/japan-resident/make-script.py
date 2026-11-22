#!/usr/bin/env python3
"""Write script.json: the Japan earthquake seen through one invented resident, Mika.

Facts come from the Japan fixture. Satire stays in the physical setting and
targets institutional habits; there are no phone notifications. Mika is never
the joke. Impact estimates (deaths, injuries) are not used.

    python3 make-script.py [--tone satirical|unhinged] [--name Mika]
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

NUMBERS = {1: "one", 2: "two", 3: "three", 4: "four", 5: "five", 6: "six", 7: "seven", 8: "eight", 9: "nine"}


def country(name: str) -> str:
    """'the United States', 'the Philippines'; most names take no article."""
    return f"the {name}" if name.startswith(("United ", "Republic ")) or name in ("Netherlands", "Philippines") else name


def spoken_time(minutes: int) -> str:
    hour, minute = divmod(minutes % 1440, 60)
    words = {41: "forty-one", 42: "forty-two", 45: "forty-five", 0: "o'clock"}
    return f"{NUMBERS.get(hour % 12 or 12, hour)} {words.get(minute, str(minute))}"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tone", choices=("satirical", "unhinged"), default="satirical")
    parser.add_argument("--name", default="Mika")
    args = parser.parse_args()
    name = args.name

    events = [{**e, "status": "applied"} for e in generate(fixture="japan-earthquake", simulation_id="resident-japan")["events"]]
    layer = satire_for_events(events, args.tone)

    def first(kind: str, after: int = -1) -> dict:
        return next(e for e in events if e["type"] == kind and e["sim_time_minutes"] > after)

    quake, warning, evac = first("earthquake"), first("tsunami_warning"), first("evacuation")
    outage, aid = first("infrastructure_failure"), first("international_aid")
    aftershock = first("aftershock", after=aid["sim_time_minutes"])
    recovery = [e for e in events if e["type"] == "recovery"][-1]
    home = evac["location"]["name"]
    magnitude = quake["payload"].get("magnitude")
    day = lambda e: e["sim_time_minutes"] // 1440 + 1  # noqa: E731

    shots = [
        {"scene": "home", "event_id": quake["id"], "date": format_sim_time(quake["sim_time_minutes"] - 1),
         "lower_third": f"{name.upper()} · {home.upper()}",
         "narration": f"This is {name}, in {home}. At {spoken_time(quake['sim_time_minutes'] - 1)}, "
                      "her biggest problem was the toaster."},
        {"scene": "quake", "event_id": quake["id"], "date": format_sim_time(quake["sim_time_minutes"]),
         "narration": f"At {spoken_time(quake['sim_time_minutes'])}, a magnitude {magnitude} earthquake. "
                      "The evacuation sign stayed perfectly level."},
        {"scene": "warning", "event_id": warning["id"], "date": format_sim_time(warning["sim_time_minutes"]),
         "narration": "Three minutes later: a tsunami warning. The harbor loudspeaker began with a reminder to remain calm."},
        {"scene": "evacuation", "event_id": evac["id"], "date": format_sim_time(evac["sim_time_minutes"]),
         "narration": f"{name} walked to higher ground. The evacuation map had arrows pointing in every direction."},
        {"scene": "shelter", "event_id": outage["id"], "date": format_sim_time(outage["sim_time_minutes"]),
         "narration": "At the shelter, the power went out. The emergency lights illuminated a queue for the charging station."},
        {"scene": "aid", "event_id": aid["id"], "date": format_sim_time(aid["sim_time_minutes"]),
         "narration": f"Day {NUMBERS[day(aid)]}: rescue teams from {country(aid['payload']['origin'])}, "
                      "welcomed by a ribbon-cutting ceremony for the supply boxes."},
        {"scene": "aftershock", "event_id": aftershock["id"], "date": format_sim_time(aftershock["sim_time_minutes"]),
         "narration": f"That evening, another aftershock. The shelter sign changed from 'WELCOME' to 'STILL WELCOME.'"},
        {"scene": "home-again", "event_id": recovery["id"], "date": format_sim_time(recovery["sim_time_minutes"]),
         "narration": f"Day {NUMBERS[day(recovery)]}: the trains came back, and so did {name}. "
                      "The toast was waiting."},
    ]
    for shot in shots:
        shot["narration"] = shot["narration"].replace("™", "")
    stats = [
        {"label": m["label"], "value": m["value"]} for m in layer["absurdity"] if m["value"]
    ] + [{"label": "Pieces of toast finished", "value": 0}]
    script = {
        "title": f"{name}'s four days",
        "person": {"name": name, "home": home},
        "tone": args.tone,
        "outro_seconds": 3.5,
        "source": {"fixture": "japan-earthquake", "layer": "worldwire.satire"},
        "stats": stats,
        "shots": shots,
    }
    (HERE / "script.json").write_text(json.dumps(script, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    for i, shot in enumerate(shots, 1):
        print(f"{i}. {shot['date']} {shot['narration']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
