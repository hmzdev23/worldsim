#!/usr/bin/env python3
"""Write script.json: a fictional nuclear standoff seen through one invented clerk, Tomas.

Borovia and Kestria are invented countries (codes XBO/XKE, from ISO's
user-assigned X range) on invented islands, so the film is about no real
conflict. Facts come from services/director/fixtures/nuclear-standoff.json
and are narrated plainly; the detonation shot carries no joke. The humor is
institutional and arrives on his phone from worldwire.satire. Casualty
estimates are never used.

    python3 make-script.py [--tone satirical|unhinged] [--name Tomas]
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

WORDS = {1: "one", 2: "two", 3: "three", 4: "four", 5: "five", 6: "six", 7: "seven", 8: "eight", 9: "nine",
         10: "ten", 11: "eleven", 12: "twelve"}


def clock(minutes: int) -> str:
    """'ten', 'noon', 'ten past two', 'half past three' for a time of day."""
    hour, minute = divmod(minutes % 1440, 60)
    if (hour, minute) == (12, 0):
        return "noon"
    h = WORDS[hour % 12 or 12]
    return {0: h, 10: f"ten past {h}", 15: f"quarter past {h}", 30: f"half past {h}"}.get(minute, f"{h} {minute:02d}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tone", choices=("satirical", "unhinged"), default="satirical")
    parser.add_argument("--name", default="Tomas")
    args = parser.parse_args()
    name = args.name

    events = [{**e, "status": "applied"} for e in generate(fixture="nuclear-standoff", simulation_id="standoff")["events"]]
    layer = satire_for_events(events, args.tone)
    posts = list(reversed(layer["posts"]))
    kind = lambda k: next(e for e in events if e["type"] == k)  # noqa: E731
    cyber, escalation, evac = kind("cyber_attack"), kind("conflict_escalation"), kind("evacuation")
    blast, fallout, ceasefire, recovery = kind("nuclear_detonation"), kind("contamination"), kind("ceasefire"), kind("recovery")
    home, enemy, own = cyber["location"]["country"], escalation["location"]["country"], cyber["location"]["country"]
    day = lambda e: WORDS[e["sim_time_minutes"] // 1440 + 1]  # noqa: E731

    def note(event: dict, prefer: tuple = ()) -> dict:
        mine = [p for p in posts if p["event_id"] == event["id"]]
        pick = next((p for p in mine if p["kind"] in prefer), mine[0])
        return {k: pick[k] for k in ("author", "handle", "text")}

    def at(event: dict) -> str:
        return format_sim_time(event["sim_time_minutes"])

    shots = [
        {"scene": "home", "event_id": cyber["id"], "date": at(cyber), "lower_third": f"{name.upper()} · {own.upper()}",
         "notification": note(cyber, ("company",)),
         "narration": f"This is {name}. He writes reassuring pamphlets for {home}. At {clock(cyber['sim_time_minutes'])}, the internet went down."},
        {"scene": "street", "event_id": escalation["id"], "date": at(escalation), "notification": note(escalation, ("anchor",)),
         "narration": f"By {clock(escalation['sim_time_minutes'])}, {enemy} had mobilised. {name} was asked to make the pamphlets more reassuring."},
        {"scene": "queue", "event_id": evac["id"], "date": at(evac), "notification": note(evac, ("airline",)),
         "narration": f"At {clock(evac['sim_time_minutes'])}, the sirens. {name} went underground, with the pamphlets."},
        {"scene": "blast", "event_id": blast["id"], "date": at(blast),
         "narration": f"At {clock(blast['sim_time_minutes'])}, a nuclear weapon was detonated over the {blast['location']['name']}."},
        {"scene": "shelter", "event_id": blast["id"], "date": at(fallout), "notification": note(blast, ("committee",)),
         "narration": "Underground, an emergency meeting was scheduled to schedule the emergency meeting."},
        {"scene": "ceasefire", "event_id": ceasefire["id"], "date": at(ceasefire), "notification": note(ceasefire, ("committee",)),
         "narration": f"On day {day(ceasefire)}, a ceasefire. Both sides argued about the table."},
        {"scene": "home-again", "event_id": recovery["id"], "date": at(recovery), "notification": note(recovery, ("company",)),
         "narration": f"On day {day(recovery)}, {name} came home. The pamphlets were finally ready."},
    ]
    stats = [{"label": "Notifications received", "value": len(posts)}] + [
        {"label": m["label"], "value": m["value"]} for m in layer["absurdity"] if m["value"]
    ] + [{"label": "Reassuring pamphlets read", "value": 0}]
    script = {
        "title": f"{name}'s three days",
        "person": {"name": name, "home": home},
        "tone": args.tone,
        "outro_seconds": 3.5,
        "stats_title": f"{name.upper()}'S THREE DAYS",
        "disclaimer": f"Fictional simulation. {enemy}, {home}, {name}, every company, statement and statistic here is invented.",
        "map": {"blast": blast["location"], "places": [{"name": e["location"]["country"].upper(), "lat": e["location"]["lat"], "lon": e["location"]["lon"]}
                                                     for e in (escalation, cyber)]},
        "source": {"fixture": "nuclear-standoff", "layer": "worldwire.satire"},
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
