#!/usr/bin/env python3
"""Write a chronological recap from one run's canonical result.

    python3 make-script.py --run RUN_ID
    python3 make-script.py --result result.json
    python3 make-script.py --fixture tsunami --seed 1234
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

from worldwire.wire import format_sim_time  # noqa: E402

COUNTRIES = ROOT / "apps" / "web" / "public" / "countries.geojson"  # the live map's own country shapes
MAX_EVENT_SHOTS = 6
SECONDS_PER_WORD, SHOT_OVERHEAD, OUTRO = .36, .8, 3.5
BUDGET = 46.0             # estimated seconds before make-audio.py's hard 50-second check

# Event type -> (scene, what happened). Scenes are drawn by storyboard.js; phrases are plain facts.
EVENTS = {
    "earthquake": ("quake", "an earthquake struck{at}"),
    "aftershock": ("quake", "a strong aftershock struck{at}"),
    "tsunami_warning": ("warning", "tsunami warnings went out{at}"),
    "volcanic_eruption": ("eruption", "a volcano erupted{at}"),
    "meteor_impact": ("sky", "a meteor came down{at}"),
    "extreme_weather": ("storm", "extreme weather struck{at}"),
    "flooding": ("flood", "floodwater spread{at}"),
    "disease_outbreak": ("outbreak", "a new illness was reported{at}"),
    "military_strike": ("map", "a military strike was reported{at}"),
    "nuclear_detonation": ("map", "a nuclear detonation was reported{at}"),
    "cyber_attack": ("outage", "a cyberattack took systems down{at}"),
    "alien_contact": ("sky", "an unidentified object was sighted{at}"),
    "other_hazard": ("warning", "{label} was reported{at}"),
    "infrastructure_failure": ("outage", "infrastructure failed{at}"),
    "government_response": ("committee", "officials announced emergency measures{at}"),
    "international_aid": ("aid", "aid arrived{at}{origin}"),
    "evacuation": ("evacuation", "evacuations began{at}"),
    "contamination": ("outbreak", "contamination was confirmed{at}"),
    "economic_shock": ("market", "the economy was disrupted{at}"),
    "civil_unrest": ("street", "protests broke out{at}"),
    "conflict_escalation": ("street", "the conflict escalated{at}"),
    "ceasefire": ("tv", "a ceasefire was agreed{at}"),
    "recovery": ("home-again", "recovery began{at}"),
}
FACILITIES = ("station", "airport", "plant", "hub", "heathrow", "port", "base", "centre", "center", "headquarters")
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
COUNTRIES_WITH_ARTICLE = {
    "Czech Republic", "Dominican Republic", "Netherlands", "Philippines",
    "United Arab Emirates", "United Kingdom", "United States", "United States of America",
}

def region_for(code: str) -> str:
    return next((k for k, r in REGIONS.items() if code in r["codes"].split()), REGION_DEFAULT)


def at(name: str) -> str:
    """'in Tokyo', 'off the coast of Miyagi', 'on the Valparaiso coast'."""
    low = name.lower()
    if low.split(" ")[0] in ("off", "near", "over", "across", "outside", "around", "along"):
        return name
    if low.endswith((" coast", " coastline", " peninsula", " plain", " coastal plain")):
        return f"on the {name}"
    return f"in {name}"


def narrate(event: dict, previous: dict | None) -> str:
    """Establish the country first, then say what happened."""
    location = event["location"]
    country = location["country"]
    place = location["name"]
    country_name = f"the {country}" if country in COUNTRIES_WITH_ARTICLE else country
    place_detail = ""
    if place.casefold() != country.casefold():
        location_phrase = f"at {place}" if any(word in place.lower() for word in FACILITIES) else at(place)
        place_detail = f" {location_phrase}"
    _, template = EVENTS.get(event["type"], ("warning", "an emergency was reported{at}"))
    payload = event.get("payload") or {}
    origin = payload.get("origin")
    label = str(payload.get("label") or "a new hazard")
    if len(label.split()) > 5:
        label = "a new hazard"
    target = payload.get("target")
    if event["type"] == "infrastructure_failure" and isinstance(target, str) and 0 < len(target.split()) <= 5:
        template = f"the {target} failed{{at}}"
    action = template.format(at=place_detail, label=label, origin=f", sent from {origin}" if isinstance(origin, str) else "")
    if previous and country == previous["location"]["country"]:
        return f"Later, {action}."
    return f"In {country_name}, {action}."


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


def build(result: dict, name: str | None = None) -> dict:
    events = [e for e in result["events"] if e.get("status", "applied") == "applied"]
    events.sort(key=lambda e: (e["sim_time_minutes"], e.get("sequence", 0)))
    if not events:
        raise SystemExit("The run has no applied events")
    seed = result.get("seed") or 1
    rng = random.Random(seed)
    # Home is where people live: the first evacuated place, else the first town in the run
    # (not "off the coast of ...", not a power station or an airport).
    def town(e: dict) -> bool:
        name = e["location"]["name"].lower()
        return at(e["location"]["name"]).startswith("in ") and not any(w in name for w in FACILITIES)
    origin = next((e["location"] for e in events if e["type"] == "evacuation" and town(e)),
                  next((e["location"] for e in events if town(e)), events[0]["location"]))
    region = REGIONS[region_for(origin["country_code"])]
    person_name, kind = rng.choice(region["names"])
    person_name = name or person_name
    chosen = pick_events(events)
    while True:
        shots = []
        previous = None
        for event in chosen:
            scene = EVENTS.get(event["type"], ("warning", ""))[0]
            shots.append({
                "scene": scene,
                "event_id": event["id"],
                "event_type": event["type"],
                "date": format_sim_time(event["sim_time_minutes"]),
                "place": event["location"]["name"],
                "country": event["location"]["country"],
                "narration": narrate(event, previous),
            })
            previous = event
        duration = sum(max(3.5, len(shot["narration"].split()) * SECONDS_PER_WORD + SHOT_OVERHEAD)
                       for shot in shots) + OUTRO
        if duration <= BUDGET or len(chosen) <= 3:
            break
        drop = min(chosen[1:-1], key=lambda event: event["severity"])
        chosen = [event for event in chosen if event is not drop]

    places = []
    for e in events:
        if e["location"]["name"] not in [p["name"] for p in places]:
            places.append({"name": e["location"]["name"], "lat": e["location"]["lat"], "lon": e["location"]["lon"],
                           "event_id": e["id"], "type": e["type"]})
    return {
        "title": f"{events[0]['location']['country']} · Run recap",
        "person": {"name": person_name, "home": origin["name"], "kind": kind,
                   "look": {"skin": region["skin"], "hair": region["hair"]}},
        "outro_seconds": OUTRO,
        "source": {"simulation_id": result.get("simulation_id"), "seed": result.get("seed"),
                   "prompt": result.get("prompt")},
        "map": {**countries_near(events), "places": places},
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
    parser.add_argument("--tone", choices=("satirical",), help=argparse.SUPPRESS)
    parser.add_argument("--name")
    args = parser.parse_args()
    result = load_result(args)
    script = build(result, args.name)
    (HERE / "script.json").write_text(json.dumps(script, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"{script['title']} · seed {result.get('seed')} · {len(script['shots'])} shots")
    for i, shot in enumerate(script["shots"], 1):
        print(f"{i}. {shot['date']} [{shot['scene']}] {shot['narration']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
