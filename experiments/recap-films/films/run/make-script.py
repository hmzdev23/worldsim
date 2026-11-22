#!/usr/bin/env python3
"""Write script.json: a satirical recap film of ONE simulation run, seen through one invented local.

The film follows the run's canonical result (GET /scenarios/{id}/result), the
same events the map played: every shot is one of the run's events, in the
run's order, at its place and simulated time. Nothing is added to the chain.
The humor format is the one shared by every recap film:

* facts from the run are narrated plainly;
* the jokes arrive as notifications on the person's phone, taken from
  worldwire.satire for that very event (institutions only, never victims);
* a running gag, picked by the run's seed, pays off at the end;
* a stats card closes: notifications, the absurdity index, the gag stat.

Casualty estimates are never used, and strikes or detonations carry no joke.

    python3 make-script.py --run RUN_ID [--server http://127.0.0.1:8765]
    python3 make-script.py --result result.json
    python3 make-script.py --fixture tsunami [--seed 1234]     # offline, like a starter run
    options: [--tone satirical] [--name NAME]
"""
from __future__ import annotations

import argparse
import json
import random
import sys
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = next(p for p in HERE.parents if (p / "services" / "newsroom").is_dir())
sys.path[:0] = [str(ROOT / "services" / "newsroom"), str(ROOT / "services" / "director")]

from worldwire import satire_for_events  # noqa: E402
from worldwire.wire import format_sim_time  # noqa: E402

COUNTRIES = ROOT / "apps" / "web" / "public" / "countries.geojson"  # the live map's own country shapes
MAX_EVENT_SHOTS = 6       # plus the opening shot: at most 7 shots, so the film stays under 50 seconds
MAX_WORDS = 15            # per narration line (about 5 seconds of voice)
SECONDS_PER_WORD, SHOT_OVERHEAD, OUTRO = .36, .8, 3.5
BUDGET = 46.0             # estimated seconds before make-audio.py's hard 50-second check

WORDS = {1: "one", 2: "two", 3: "three", 4: "four", 5: "five", 6: "six", 7: "seven", 8: "eight", 9: "nine",
         10: "ten", 11: "eleven", 12: "twelve", 13: "thirteen", 14: "fourteen", 15: "fifteen", 20: "twenty", 30: "thirty"}

# Event type -> (scene, what happened). Scenes are drawn by storyboard.js; phrases are plain facts.
EVENTS = {
    "earthquake": ("quake", "an earthquake struck {at}"),
    "aftershock": ("quake", "a strong aftershock struck {at}"),
    "tsunami_warning": ("warning", "tsunami warnings went out {at}"),
    "volcanic_eruption": ("eruption", "an eruption began {at}"),
    "meteor_impact": ("sky", "a meteor came down {at}"),
    "extreme_weather": ("storm", "extreme weather struck {at}"),
    "flooding": ("flood", "floodwater spread {at}"),
    "disease_outbreak": ("outbreak", "a new illness was reported {at}"),
    "military_strike": ("map", "a military strike was reported {at}"),
    "nuclear_detonation": ("map", "a nuclear detonation was reported {at}"),
    "cyber_attack": ("outage", "a cyberattack took systems down {at}"),
    "alien_contact": ("sky", "an unidentified object was sighted {at}"),
    "other_hazard": ("warning", "{label} was reported {at}"),
    "infrastructure_failure": ("outage", "power and services failed {at}"),
    "government_response": ("committee", "officials announced emergency measures {at}"),
    "international_aid": ("aid", "aid arrived {at}{origin}"),
    "evacuation": ("evacuation", "evacuations began {at}"),
    "contamination": ("outbreak", "contamination was confirmed {at}"),
    "economic_shock": ("market", "markets fell sharply {at}"),
    "civil_unrest": ("street", "protests broke out {at}"),
    "conflict_escalation": ("street", "the conflict escalated {at}"),
    "ceasefire": ("tv", "a ceasefire was agreed {at}"),
    "recovery": ("home-again", "recovery began {at}"),
}
FACILITIES = ("station", "airport", "plant", "hub", "heathrow", "port", "base", "centre", "center", "headquarters")
CALM_ENDINGS = {"recovery", "ceasefire", "international_aid", "government_response"}  # the film can end at home
NO_JOKE = {"military_strike", "nuclear_detonation"}  # shown plainly, like the standoff film's detonation
PREFER = {  # which satire post fits each scene best
    "quake": ("company", "anchor"), "warning": ("anchor", "official"), "eruption": ("airline", "company"),
    "sky": ("anchor", "official"), "storm": ("company", "airline"), "flood": ("company", "official"),
    "outbreak": ("official", "company"), "outage": ("company",), "committee": ("committee", "official"),
    "aid": ("committee",), "evacuation": ("airline", "official"), "market": ("company", "anchor"),
    "street": ("anchor", "official"), "tv": ("committee",), "home-again": ("company",),
}

# Plausible locals for the setting (first event's country): names, model and colouring.
# The protagonist always wears yellow; everyone else is drawn from the same palette.
REGIONS = {
    "nordic": {"codes": "ISL NOR SWE FIN DNK", "names": [("Sigrún", "woman"), ("Einar", "man"), ("Freya", "woman"), ("Lars", "man")],
               "skin": [0xf5d9c4, 0xf0cdb5, 0xeac2a6, 0xf2d2bd], "hair": [0xd8b575, 0xc29a5b, 0x8a6034, 0xa2552c, 0xe0c48a]},
    "western": {"codes": "GBR IRL FRA DEU NLD BEL CHE AUT ITA ESP PRT USA CAN AUS NZL", "names": [("Tom", "man"), ("Claire", "woman"), ("Ben", "man"), ("Anna", "woman")],
                "skin": [0xf3d4bf, 0xeac2a6, 0xd9a888, 0xc68e6a, 0x8d5a3b], "hair": [0x5a3d24, 0x2b1d14, 0xc29a5b, 0x8a6034, 0x1a1410]},
    "east_asia": {"codes": "JPN KOR CHN TWN HKG MNG", "names": [("Mika", "woman"), ("Kenji", "man"), ("Yuna", "woman"), ("Haruto", "man")],
                  "skin": [0xf1d3b8, 0xe9c4a2, 0xdfb48f], "hair": [0x15110e, 0x2a1d14, 0x1c1612]},
    "latam": {"codes": "CHL ARG PER BOL COL ECU VEN MEX BRA URY PRY CRI PAN GTM CUB", "names": [("Camila", "woman"), ("Mateo", "man"), ("Valentina", "woman"), ("Diego", "man")],
              "skin": [0xe8bf9f, 0xd6a37e, 0xc28d68, 0xa8714d], "hair": [0x1d1510, 0x2e2018, 0x4a3324]},
    "africa": {"codes": "KEN NGA ETH GHA TZA UGA ZAF SEN CMR COD RWA", "names": [("Wanjiru", "woman"), ("Kofi", "man"), ("Amara", "woman"), ("Juma", "man")],
               "skin": [0x8d5a3b, 0x6e4128, 0x5a321f, 0x7a4a2e], "hair": [0x120d0a, 0x1d1410]},
    "south_asia": {"codes": "IND PAK BGD LKA NPL", "names": [("Priya", "woman"), ("Arjun", "man"), ("Ananya", "woman"), ("Rohan", "man")],
                   "skin": [0xc89272, 0xb07a58, 0x9a6544], "hair": [0x120d0a, 0x221811]},
    "southeast_asia": {"codes": "SGP MYS IDN THA VNM PHL KHM MMR", "names": [("Mei", "woman"), ("Arif", "man"), ("Siti", "woman"), ("Wei", "man")],
                       "skin": [0xe6bf9a, 0xd8aa82, 0xc69468], "hair": [0x120d0a, 0x1d1510]},
    "mena": {"codes": "EGY MAR TUN DZA SAU ARE JOR LBN TUR IRN IRQ ISR", "names": [("Leila", "woman"), ("Omar", "man"), ("Yasmin", "woman"), ("Karim", "man")],
             "skin": [0xe0b48e, 0xcf9e78, 0xb98762], "hair": [0x1d1510, 0x2e2018, 0x4a3324]},
}
REGION_DEFAULT = "western"

# Running gags (picked by the run's seed). Setup on the table in the first shot, payoff at the end.
GAGS = [
    {"prop": ["DENTIST", "THURSDAY 9:00"], "prop_end": ["DENTIST", "STILL THURSDAY 9:00"],
     "setup": "{name} had a dentist appointment on Thursday.", "payoff": "The dentist still expects {name} on Thursday.",
     "stat": ("Dentist appointments kept", 0)},
    {"prop": ["BOOK CLUB", "READ CHAPTER 3"], "prop_end": ["BOOK CLUB", "CHAPTER 3. STILL."],
     "setup": "{name} had one goal this week: finish chapter three.", "payoff": "{name} is still on chapter three.",
     "stat": ("Chapters read", 0)},
    {"prop": ["SOURDOUGH", "FEED ME DAILY"], "prop_end": ["SOURDOUGH", "THRIVING"],
     "setup": "{name} had promised to keep a friend's sourdough alive.", "payoff": "The sourdough, somehow, made it.",
     "stat": ("Sourdough starters lost", 0)},
    {"prop": ["PARKING PERMIT", "RENEW BY FRIDAY"], "prop_end": ["PARKING FINE", "PAY BY FRIDAY"],
     "setup": "{name}'s parking permit ran out on Friday.", "payoff": "The parking fine arrived right on time.",
     "stat": ("Parking fines received", 1)},
]


def region_for(code: str) -> str:
    return next((k for k, r in REGIONS.items() if code in r["codes"].split()), REGION_DEFAULT)


def clock(minutes: int) -> str:
    """'three in the morning', 'ten past six in the evening', 'noon', 'midnight'."""
    hour, minute = divmod(minutes % 1440, 60)
    if hour == 12 and minute < 15:
        return "noon"
    if (hour, minute) == (0, 0):
        return "midnight"
    h = WORDS[hour % 12 or 12]
    part = "in the morning" if hour < 12 else "in the afternoon" if hour < 18 else "in the evening"
    if minute >= 45 and hour in (11, 23):
        return "quarter to noon" if hour == 11 else "quarter to midnight"
    m = {0: h, 15: f"quarter past {h}", 30: f"half past {h}", 45: f"quarter to {WORDS[(hour + 1) % 12 or 12]}"}
    return f"{m.get(minute, m.get(minute - minute % 15, h))} {part}"


def when(event: dict, previous: dict | None) -> str:
    """'At three in the morning' on day one, 'On day two' when the day changes."""
    t = event["sim_time_minutes"]
    day = t // 1440 + 1
    if previous is None or day == previous["sim_time_minutes"] // 1440 + 1:
        return f"At {clock(t)}"
    return f"On day {WORDS.get(day, day)}"


def at(name: str) -> str:
    """'in Tokyo', 'off the coast of Miyagi', 'on the Valparaiso coast'."""
    low = name.lower()
    if low.split(" ")[0] in ("off", "near", "over", "across", "outside", "around", "along"):
        return name
    if low.endswith((" coast", " coastline", " peninsula", " plain", " coastal plain")):
        return f"on the {name}"
    return f"in {name}"


def phrase(event: dict) -> str:
    scene, template = EVENTS.get(event["type"], ("warning", "something happened {at}"))
    payload = event.get("payload") or {}
    origin = payload.get("origin")
    name = event["location"]["name"]
    return template.format(at=at(name), place=name, label=(payload.get("label") or "a new hazard").lower(),
                           origin=f", sent from {origin}" if origin else "")


def span_title(minutes: int) -> str:
    days = minutes // 1440 + 1
    if days <= 1:
        return "day"
    if days <= 4:
        return f"{WORDS[days]} days"
    return "week" if days <= 10 else "month" if days <= 45 else "season"


def pick_events(events: list[dict]) -> list[dict]:
    """The first and last events plus the most severe in between (distinct types first), in run order."""
    if len(events) <= MAX_EVENT_SHOTS:
        return list(events)
    first, last, middle = events[0], events[-1], events[1:-1]
    ranked = sorted(middle, key=lambda e: -e["severity"])
    chosen, types = [], {first["type"], last["type"]}
    for e in ranked:  # one per type first, then the rest by severity
        if e["type"] not in types and len(chosen) < MAX_EVENT_SHOTS - 2:
            chosen.append(e); types.add(e["type"])
    for e in ranked:
        if e not in chosen and len(chosen) < MAX_EVENT_SHOTS - 2:
            chosen.append(e)
    keep = {id(e) for e in chosen}
    return [first] + [e for e in middle if id(e) in keep] + [last]


def countries_near(events: list[dict], margin: float = 12.0) -> dict:
    """Outlines of countries inside the run's bounding box, from the live map's own geojson."""
    lats = [e["location"]["lat"] for e in events]; lons = [e["location"]["lon"] for e in events]
    box = (min(lons) - margin, max(lons) + margin, min(lats) - margin * .6, max(lats) + margin * .6)
    out = {}
    for f in json.loads(COUNTRIES.read_text(encoding="utf-8"))["features"]:
        geom = f["geometry"]; polys = geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]
        rings = [[[round(x, 2), round(y, 2)] for x, y in poly[0]] for poly in polys
                 if any(box[0] <= x <= box[1] and box[2] <= y <= box[3] for x, y in poly[0])]
        if rings:
            out[f["properties"].get("code") or f["properties"]["name"]] = rings
    return {"box": box, "countries": out}


def load_result(args) -> dict:
    if args.result:
        return json.loads(Path(args.result).read_text(encoding="utf-8"))
    if args.run:
        url = f"{args.server.rstrip('/')}/scenarios/{args.run}/result"
        with urllib.request.urlopen(url, timeout=20) as resp:
            return json.load(resp)
    from worlddirector import new_seed, prepare_scenario  # noqa: PLC0415 - offline path only
    seed = args.seed or new_seed()
    batch = prepare_scenario(args.fixture, simulation_id="run-offline", fixture=args.fixture, seed=seed)
    return {"simulation_id": batch["simulation_id"], "seed": seed, "prompt": args.fixture, "fixture": args.fixture,
            "events": [{**e, "status": "applied"} for e in batch["events"]]}


def build(result: dict, tone: str, name: str | None = None) -> dict:
    events = [e for e in result["events"] if e.get("status", "applied") == "applied"]
    events.sort(key=lambda e: (e["sim_time_minutes"], e.get("sequence", 0)))
    if not events:
        raise SystemExit("The run has no applied events")
    seed = result.get("seed") or 1
    rng = random.Random(seed)
    layer = satire_for_events(events, tone)
    posts = layer["posts"]
    # Home is where people live: the first evacuated place, else the first town in the run
    # (not "off the coast of ...", not a power station or an airport).
    def town(e: dict) -> bool:
        name = e["location"]["name"].lower()
        return at(e["location"]["name"]).startswith("in ") and not any(w in name for w in FACILITIES)
    origin = next((e["location"] for e in events if e["type"] == "evacuation" and town(e)),
                  next((e["location"] for e in events if town(e)), events[0]["location"]))
    home_at = at(origin["name"])
    region = REGIONS[region_for(origin["country_code"])]
    person_name, kind = rng.choice(region["names"])
    person_name = name or person_name
    gag = rng.choice(GAGS)

    used: set = set()

    def note(event: dict, scene: str) -> dict | None:
        if event["type"] in NO_JOKE:
            return None
        # Each joke is used once per film; an event with only repeats gets no notification.
        mine = [p for p in posts if p["event_id"] == event["id"] and p["text"] not in used]
        if not mine:
            return None
        pick = next((p for p in mine if p["kind"] in PREFER.get(scene, ())), mine[0])
        used.add(pick["text"])
        return {k: pick[k] for k in ("author", "handle", "text")}

    def cap(text: str) -> str:
        return text[:1].upper() + text[1:]

    chosen = pick_events(events)
    # Trim the least severe middle events until the estimated length fits the 50-second rule.
    def estimate(lines: list[str]) -> float:
        return sum(len(l.split()) * SECONDS_PER_WORD + SHOT_OVERHEAD for l in lines) + OUTRO

    while True:
        shots = [{"scene": "home", "event_id": None, "date": format_sim_time(max(0, events[0]["sim_time_minutes"] - 60)),
                  "lower_third": f"{person_name.upper()} · {origin['name'].upper()}",
                  "narration": f"This is {person_name}, {home_at}. " + gag["setup"].format(name=person_name),
                  "prop": gag["prop"]}]
        previous, used = None, set()
        for i, event in enumerate(chosen):
            scene = EVENTS.get(event["type"], ("warning", ""))[0]
            last = i == len(chosen) - 1
            if last and event["type"] in CALM_ENDINGS:
                scene = "home-again"
            line = f"{when(event, previous)}, {phrase(event)}."
            if last:
                line += " " + gag["payoff"].format(name=person_name)
            shot = {"scene": scene, "event_id": event["id"], "event_type": event["type"],
                    "date": format_sim_time(event["sim_time_minutes"]), "place": event["location"]["name"],
                    "country": event["location"]["country"], "severity": event["severity"], "narration": cap(line)}
            n = note(event, scene)
            if n:
                shot["notification"] = n
            if last:
                shot["prop"] = gag["prop_end"]
            shots.append(shot)
            previous = event
        if estimate([s["narration"] for s in shots]) <= BUDGET or len(chosen) <= 3:
            break
        middle = chosen[1:-1]
        drop = min(middle, key=lambda e: e["severity"])
        chosen = [e for e in chosen if e is not drop]

    places = []
    for e in events:
        if e["location"]["name"] not in [p["name"] for p in places]:
            places.append({"name": e["location"]["name"], "lat": e["location"]["lat"], "lon": e["location"]["lon"],
                           "event_id": e["id"], "type": e["type"]})
    stats = [{"label": "Notifications received", "value": sum(1 for s in shots if "notification" in s)}] + [
        {"label": m["label"], "value": m["value"]} for m in layer["absurdity"] if m["value"]
    ][:3] + [{"label": gag["stat"][0], "value": gag["stat"][1]}]
    return {
        "title": f"{person_name}'s {span_title(events[-1]['sim_time_minutes'])}",
        "person": {"name": person_name, "home": origin["name"], "kind": kind,
                   "look": {"skin": region["skin"], "hair": region["hair"]}},
        "tone": tone,
        "outro_seconds": OUTRO,
        "stats_title": f"{person_name.upper()}'S RECAP",
        "disclaimer": (f"Fictional simulation, run seed {result.get('seed')}. {person_name}, every company, "
                       "statement and statistic here is invented. Real places, invented events."),
        "source": {"simulation_id": result.get("simulation_id"), "seed": result.get("seed"),
                   "prompt": result.get("prompt"), "layer": "worldwire.satire"},
        "map": {**countries_near(events), "places": places},
        "stats": stats,
        "shots": shots,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    src = parser.add_mutually_exclusive_group(required=True)
    src.add_argument("--run", help="run ID on a running simulation server")
    src.add_argument("--result", help="a saved GET /scenarios/{id}/result body")
    src.add_argument("--fixture", help="offline: a starter fixture, varied by --seed like a real run")
    parser.add_argument("--server", default="http://127.0.0.1:8765")
    parser.add_argument("--seed", type=int)
    parser.add_argument("--tone", choices=("satirical",))
    parser.add_argument("--name")
    args = parser.parse_args()
    result = load_result(args)
    tone = args.tone or (result.get("tone") if result.get("tone") == "satirical" else "satirical")
    script = build(result, tone, args.name)
    (HERE / "script.json").write_text(json.dumps(script, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"{script['title']} · seed {result.get('seed')} · {len(script['shots'])} shots")
    for i, shot in enumerate(script["shots"], 1):
        extra = f"  [phone: {shot['notification']['handle']}]" if "notification" in shot else ""
        print(f"{i}. {shot['date']} [{shot['scene']}] {shot['narration']}{extra}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
