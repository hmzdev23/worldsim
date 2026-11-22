"""Recap storyboard: turn a finished run into a shot list for the recap video (RECAP-001, #67).

The storyboard follows six beats, using the sample script only as a rough
skeleton:

    hook -> first_hours -> domino -> explainer -> response -> final

Scenes are chosen by event type, never by scenario, and every figure is a
fictional estimate copied from the run's `payload.impacts` snapshots (never
summed). A beat with nothing to show is skipped. The output is deterministic
and follows apps/recap/storyboard.schema.json.
"""

from __future__ import annotations

from typing import Any, Iterable

from .impacts import COUNT_FIELDS, MEASURE_FIELDS, fmt_count, fmt_tonnes, fmt_usd, read_impacts
from .wire import derive_news, format_sim_time

SCHEMA_VERSION = "0.1"
LABEL = "FICTIONAL SIMULATION"
FORMAT = {"width": 1080, "height": 1920, "fps": 30}
DAY = 24 * 60
MAX_VIGNETTES = {"first_hours": 4, "domino": 3}

Event = dict[str, Any]
Scene = dict[str, Any]

# Event type -> vignette shown for it. Aid and recovery belong to the response map.
VIGNETTES = {
    "tsunami_warning": "tsunami_siren",
    "evacuation": "evacuation",
    "flooding": "flooding",
    "contamination": "contamination",
    "economic_shock": "economic",
    "aftershock": "aftershock",
    "government_response": "government",
}
RESPONSE_TYPES = {"international_aid", "recovery"}

# Figure each vignette leads with, in order of preference.
VIGNETTE_FIGURES = {
    "power_out": ("households_without_power",),
    "water_out": ("households_without_water",),
    "tsunami_siren": ("displaced",),
    "evacuation": ("displaced", "sheltered"),
    "flooding": ("flooded_area_km2", "deaths"),
    "contamination": ("contaminated_area_km2", "debris_tonnes"),
    "economic": ("economic_loss_usd",),
    "aftershock": ("deaths", "injuries"),
    "government": ("deaths", "displaced"),
    "generic": ("deaths", "displaced", "economic_loss_usd"),
}

# key -> (overlay suffix, narration sentence with {v})
FIGURE_COPY = {
    "deaths": ("DEAD", "An estimated {v} people have died so far."),
    "injuries": ("INJURED", "An estimated {v} people have been injured so far."),
    "missing": ("MISSING", "An estimated {v} people are missing."),
    "displaced": ("DISPLACED", "An estimated {v} people have been forced from their homes."),
    "sheltered": ("IN SHELTERS", "An estimated {v} people are sleeping in shelters."),
    "households_without_power": ("HOMES WITHOUT POWER", "An estimated {v} households are without power."),
    "households_without_water": ("HOMES WITHOUT WATER", "An estimated {v} households are without running water."),
    "economic_loss_usd": ("IN LOSSES", "Losses so far are estimated at {v}."),
    "flooded_area_km2": ("UNDER WATER", "An estimated {v} of land is under water."),
    "contaminated_area_km2": ("CONTAMINATED", "An estimated {v} of land is contaminated."),
    "debris_tonnes": ("OF DEBRIS", "An estimated {v} of debris covers the area."),
}

STAT_LABELS = {
    "deaths": "Deaths",
    "injuries": "Injured",
    "missing": "Missing",
    "displaced": "Displaced",
    "sheltered": "In shelters",
    "households_without_power": "Homes without power",
    "households_without_water": "Homes without water",
    "economic_loss_usd": "Economic loss",
    "flooded_area_km2": "Flooded area",
    "contaminated_area_km2": "Contaminated area",
    "debris_tonnes": "Debris",
}

SPOKEN = {"deaths": "dead", "injuries": "injured", "missing": "missing"}

# General illustrations of how a hazard works. They carry no scenario figures
# except the event's own reported magnitude, depth or VEI.
EXPLAINERS = {
    "earthquake": (
        "HOW AN EARTHQUAKE SPREADS",
        "Illustration: stress builds where two plates meet until the fault slips. Fast P-waves race out first, "
        "then slower, stronger S-waves. Under the sea, the jolt can lift the water and start a tsunami.",
    ),
    "volcanic_eruption": (
        "HOW AN ERUPTION UNFOLDS",
        "Illustration: magma rises from a chamber below the surface and forces a fissure open. "
        "Lava pours out while gas and ash are thrown high into the sky and drift with the wind.",
    ),
}

HOOK_WORDS = {
    "earthquake": "EARTHQUAKE",
    "aftershock": "AFTERSHOCK",
    "volcanic_eruption": "VOLCANO ERUPTS",
    "tsunami_warning": "TSUNAMI WARNING",
    "flooding": "FLOODS",
    "extreme_weather": "EXTREME WEATHER",
    "disease_outbreak": "OUTBREAK",
}


def _display(key: str, value: float) -> str:
    if key == "economic_loss_usd":
        return fmt_usd(value)
    if key == "debris_tonnes":
        return fmt_tonnes(value)
    if key in ("flooded_area_km2", "contaminated_area_km2"):
        return f"{fmt_count(value)} km²"
    return fmt_count(value)


def _figure(impacts: dict, previous: dict | None, keys: Iterable[str]) -> dict | None:
    """The first of `keys` with a nonzero value, preferring one this event changed."""
    present = [k for k in keys if impacts.get(k)]
    if not present:
        return None
    moved = [k for k in present if previous is None or previous.get(k) != impacts[k]]
    key = (moved or present)[0]
    return {"key": key, "value": impacts[key], "display": _display(key, impacts[key])}


def _vignette(event: Event, impacts: dict, previous: dict | None) -> str:
    if event["type"] in ("infrastructure_failure", "cyber_attack"):
        water_moved = impacts.get("households_without_water") and (
            previous is None or previous.get("households_without_water") != impacts["households_without_water"]
        )
        power_moved = impacts.get("households_without_power") and (
            previous is None or previous.get("households_without_power") != impacts["households_without_power"]
        )
        target = str(event.get("payload", {}).get("target") or "").lower()
        if water_moved and not power_moved or (not power_moved and "water" in target):
            return "water_out"
        return "power_out"
    return VIGNETTES.get(event["type"], "generic")


def _place(event: Event) -> tuple[str, str]:
    loc = event["location"]
    return loc.get("name") or loc.get("country") or "", loc.get("country") or ""


def _where(event: Event) -> dict:
    loc = event["location"]
    name, country = _place(event)
    return {"place": name, "country": country, "lat": loc["lat"], "lon": loc["lon"]}


def _sentence(text: str) -> str:
    text = text.strip()
    return text if not text or text.endswith((".", "!", "?")) else text + "."


def _scene(index: int, beat: str, kind: str, slug: str, events: list[Event], *, minutes: int, duration: float,
           overlay: str, caption: str, narration: str, data: dict) -> Scene:
    return {
        "id": f"s{index:02d}-{beat.replace('_', '-')}-{slug.replace('_', '-')}",
        "beat": beat,
        "kind": kind,
        "min_duration_s": duration,
        "event_ids": [e["id"] for e in events],
        "sim_time_label": format_sim_time(minutes),
        "overlay": overlay,
        "caption": caption,
        "narration": narration,
        "data": data,
    }


def _hook_overlay(event: Event) -> str:
    payload = event.get("payload", {})
    country = (event["location"].get("country") or event["location"].get("name") or "").upper()
    word = HOOK_WORDS.get(event["type"], event["type"].replace("_", " ").upper())
    magnitude = payload.get("magnitude")
    if event["type"] in ("earthquake", "aftershock") and isinstance(magnitude, (int, float)):
        return f"M{magnitude:.1f} {word} HITS {country}"
    if event["type"] == "volcanic_eruption":
        return f"{word} IN {country}"
    return f"{word} HITS {country}"


def _hook_data(event: Event) -> dict:
    payload = event.get("payload", {})
    data = {"hazard": event["type"], **_where(event)}
    for key in ("magnitude", "depth_km", "vei", "radius_km"):
        value = payload.get(key)
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            data[key] = value
    return data


def build_storyboard(batch: dict[str, Any]) -> dict[str, Any]:
    """Storyboard for a finished run. Only applied events are used."""
    events = sorted(
        (e for e in batch.get("events", []) if e.get("status") == "applied"),
        key=lambda e: (e["sim_time_minutes"], e.get("sequence", 0), e["id"]),
    )
    if not events:
        raise ValueError("the run has no applied events to recap")
    news = {item["event_id"]: item for item in derive_news(events)}
    first = events[0]
    start = first["sim_time_minutes"]
    scenes: list[Scene] = []

    def add(*args: Any, **kwargs: Any) -> None:
        scenes.append(_scene(len(scenes) + 1, *args, **kwargs))

    # 1. Hook: the initiating event.
    description = _sentence(str(first.get("payload", {}).get("description") or ""))
    add("hook", "hook", first["type"], [first], minutes=start, duration=6,
        overlay=_hook_overlay(first), caption=news[first["id"]]["headline"],
        narration=" ".join(p for p in (f"In this fictional simulation: {news[first['id']]['headline']}.", description) if p),
        data=_hook_data(first))

    # 2-3. First hours and domino: one vignette per consequence, by event type.
    previous: dict | None = read_impacts(first) or None
    candidates: list[tuple[str, Event, str, dict | None]] = []
    for event in events[1:]:
        impacts = read_impacts(event)
        if event["type"] not in RESPONSE_TYPES:
            beat = "first_hours" if event["sim_time_minutes"] - start < DAY else "domino"
            vignette = _vignette(event, impacts, previous)
            candidates.append((beat, event, vignette, _figure(impacts, previous, VIGNETTE_FIGURES[vignette])))
        if impacts:
            previous = impacts
    for beat in ("first_hours", "domino"):
        chosen, seen = [], set()
        for _, event, vignette, figure in (c for c in candidates if c[0] == beat):
            if vignette in seen:
                continue
            seen.add(vignette)
            chosen.append((event, vignette, figure))
        chosen.sort(key=lambda c: -(c[0].get("severity") or 0))
        chosen = sorted(chosen[:MAX_VIGNETTES[beat]], key=lambda c: (c[0]["sim_time_minutes"], c[0].get("sequence", 0)))
        for event, vignette, figure in chosen:
            item = news[event["id"]]
            day = (event["sim_time_minutes"] - start) // DAY + 1
            if figure:
                suffix, sentence = FIGURE_COPY[figure["key"]]
                overlay = f"{figure['display'].upper()} {suffix}"
                narration = f"{item['headline']}. {sentence.format(v=figure['display'])}"
            else:
                overlay = item["headline"].upper()
                narration = f"{item['headline']}."
            if beat == "domino":
                overlay = f"DAY {day}: {overlay}"
            add(beat, "vignette", vignette, [event], minutes=event["sim_time_minutes"], duration=4,
                overlay=overlay, caption=item["headline"], narration=narration,
                data={"vignette": vignette, "event_type": event["type"], "severity": event.get("severity"),
                      **_where(event), "figure": figure})

    # 4. Explainer: a labelled illustration of how the hazard works.
    if first["type"] in EXPLAINERS:
        overlay, narration = EXPLAINERS[first["type"]]
        add("explainer", "explainer", first["type"], [first], minutes=start, duration=8,
            overlay=overlay, caption="Illustration, not to scale.", narration=narration,
            data={**_hook_data(first), "illustration": True})

    # 5. Response: aid arrivals and recovery on a map of every reported place.
    aid_events = [e for e in events if e["type"] == "international_aid"]
    recovery = [e for e in events if e["type"] == "recovery"]
    if aid_events or recovery:
        final_impacts = next((read_impacts(e) for e in reversed(events) if read_impacts(e)), {})
        contributors = {c["country"]: c for c in final_impacts.get("aid_contributors", [])}
        places, seen_places = [], set()
        for event in events:
            name, country = _place(event)
            if (name, country) in seen_places:
                continue
            seen_places.add((name, country))
            places.append({**_where(event), "event_type": event["type"]})
        aid = []
        for event in aid_events:
            origin = str(event.get("payload", {}).get("origin") or "").strip()
            entry = contributors.get(origin, {})
            where = _where(event)
            aid.append({"country": origin or "International", "event_id": event["id"],
                        "minutes": event["sim_time_minutes"], "place": where["place"],
                        "destination_country": where["country"], "lat": where["lat"], "lon": where["lon"],
                        **{k: entry[k] for k in ("personnel", "cargo_tonnes", "cargo") if k in entry}})
        rec = [{"event_id": e["id"], "minutes": e["sim_time_minutes"], **_where(e),
                "headline": news[e["id"]]["headline"]} for e in recovery]
        countries = sorted({a["country"] for a in aid if a["country"] != "International"})
        parts = []
        if countries:
            names = ", ".join(countries[:-1]) + (" and " if len(countries) > 1 else "") + countries[-1]
            parts.append(f"Help arrives from {names}.")
        if rec:
            parts.append(f"{rec[0]['headline']}.")
        if len(countries) > 1:
            overlay = f"{len(countries)} COUNTRIES SEND HELP"
        elif rec:
            overlay = f"RECOVERY BEGINS · DAY {(rec[0]['minutes'] - start) // DAY + 1}"
        else:
            overlay = "HELP ARRIVES"
        last = (aid_events + recovery)[-1]
        add("response", "map", "response", aid_events + recovery,
            minutes=max(e["sim_time_minutes"] for e in aid_events + recovery), duration=8,
            overlay=overlay, caption=news[last["id"]]["headline"], narration=" ".join(parts),
            data={"places": places, "aid": aid, "recovery": rec})

    # 6. Final card: the last snapshot, every statistic.
    final = next((read_impacts(e) for e in reversed(events) if read_impacts(e)), {})
    stats = [{"key": k, "label": STAT_LABELS[k], "value": final[k], "display": _display(k, final[k])}
             for k in COUNT_FIELDS + MEASURE_FIELDS if final.get(k)]
    last = events[-1]
    span_days = (last["sim_time_minutes"] - start) // DAY + 1
    if stats:
        lead = ", ".join(f"{s['display']} {SPOKEN.get(s['key'], s['label'].lower())}"
                         for s in stats if s["key"] in COUNT_FIELDS[:3])
        narration = (f"After {span_days} day{'s' if span_days != 1 else ''}, the simulation estimates "
                     f"{lead or stats[0]['display'] + ' ' + stats[0]['label'].lower()}. Every number here is fictional.")
        add("final", "stats_card", "final", [last], minutes=last["sim_time_minutes"], duration=8,
            overlay="FINAL SIMULATED ESTIMATES", caption=f"Fictional estimates after {span_days} days.",
            narration=narration,
            data={"stats": stats, "aid_countries": len(final.get("aid_contributors", [])), "days": span_days})

    return {
        "schema_version": SCHEMA_VERSION,
        "simulation_id": batch.get("simulation_id", ""),
        "branch_id": batch.get("branch_id", "main"),
        "title": news[first["id"]]["headline"],
        "label": LABEL,
        "hazard": first["type"],
        "format": dict(FORMAT),
        "scenes": scenes,
    }


def load_run(path: str) -> dict[str, Any]:
    """Read a contract event batch, or a raw Director fixture (built and marked applied)."""
    import json
    import sys
    from pathlib import Path

    data = json.loads(Path(path).read_text(encoding="utf-8"))
    if "simulation_id" in data:
        return data
    director = Path(__file__).resolve().parents[2] / "director"
    sys.path.insert(0, str(director))
    try:
        from worlddirector import build_batch
        from worlddirector.director import MAX_FIXTURE_EVENTS
    except ImportError as error:  # pragma: no cover
        raise SystemExit(f"{path} is a raw Director fixture and services/director is unavailable: {error}")
    batch = build_batch(data, simulation_id=f"recap-{Path(path).stem}", source="fixture", max_events=MAX_FIXTURE_EVENTS)
    batch["events"] = [{**event, "status": "applied"} for event in batch["events"]]
    return batch


def main(argv: list[str] | None = None) -> int:
    import argparse
    import json

    parser = argparse.ArgumentParser(prog="python3 -m worldwire.storyboard",
                                     description="Write the recap video storyboard for a finished run.")
    parser.add_argument("run", help="contract event batch (e.g. contracts/fixtures/japan-earthquake.json) "
                                    "or a raw Director fixture")
    args = parser.parse_args(argv)
    print(json.dumps(build_storyboard(load_run(args.run)), indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
