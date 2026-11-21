"""Validate raw model output and turn it into a proposed v0.1 event batch.

Hand-rolled (standard library only) so it runs without installing anything.
The result is also checked against contracts/events.schema.json in the tests.
Anything unexpected is rejected rather than repaired, except that events are
stably sorted by simulated time.
"""

from __future__ import annotations

import math
import re
from typing import Any, Optional

from .contract import (
    EVENT_TYPES,
    MAX_EVENTS,
    MAX_SIM_MINUTES,
    QUAKE_TYPES,
    SCHEMA_VERSION,
    SLUG_PATTERN,
    VISUALS,
)
from .errors import DirectorError

_EVENT_KEYS = set(
    "type sim_time_minutes location severity description magnitude depth_km origin caused_by".split()
)
_LOCATION_KEYS = {"name", "country", "country_code", "lat", "lon"}


def _num(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _text(value: Any, limit: int) -> bool:
    return isinstance(value, str) and 0 < len(value.strip()) <= limit


def _check_event(i: int, ev: Any, events: list) -> list:
    where = f"events[{i}]"
    if not isinstance(ev, dict):
        return [f"{where} is not an object"]
    keys = set(ev)
    if keys != _EVENT_KEYS:
        errs = []
        if _EVENT_KEYS - keys:
            errs.append(f"{where} missing {sorted(_EVENT_KEYS - keys)}")
        if keys - _EVENT_KEYS:
            errs.append(f"{where} has unknown keys {sorted(keys - _EVENT_KEYS)}")
        return errs

    errs = []
    if ev["type"] not in EVENT_TYPES:
        errs.append(f"{where}.type {ev['type']!r} is not an allowed event type")
    t = ev["sim_time_minutes"]
    if not _int(t) or not 0 <= t <= MAX_SIM_MINUTES:
        errs.append(f"{where}.sim_time_minutes must be an integer in 0..{MAX_SIM_MINUTES}")
    if not _num(ev["severity"]) or not 0 <= ev["severity"] <= 1:
        errs.append(f"{where}.severity must be a number in 0..1")
    if not _text(ev["description"], 280):
        errs.append(f"{where}.description must be 1-280 characters")

    loc = ev["location"]
    if not isinstance(loc, dict) or set(loc) != _LOCATION_KEYS:
        errs.append(f"{where}.location must have exactly {sorted(_LOCATION_KEYS)}")
    else:
        if not _text(loc["name"], 120) or not _text(loc["country"], 80):
            errs.append(f"{where}.location name/country must be non-empty short strings")
        if not isinstance(loc["country_code"], str) or not re.fullmatch(r"[A-Z]{3}", loc["country_code"]):
            errs.append(f"{where}.location.country_code must be ISO 3166-1 alpha-3 (e.g. JPN)")
        if not _num(loc["lat"]) or not -90 <= loc["lat"] <= 90:
            errs.append(f"{where}.location.lat out of range")
        if not _num(loc["lon"]) or not -180 <= loc["lon"] <= 180:
            errs.append(f"{where}.location.lon out of range")

    for key, lo, hi in (("magnitude", 0, 10), ("depth_km", 0, 800)):
        v = ev[key]
        if v is None:
            if ev["type"] in QUAKE_TYPES:
                errs.append(f"{where}.{key} is required for {ev['type']}")
        elif not _num(v) or not lo <= v <= hi:
            errs.append(f"{where}.{key} must be null or a number in {lo}..{hi}")
    if ev["origin"] is not None and not _text(ev["origin"], 80):
        errs.append(f"{where}.origin must be null or a short string")

    causes = ev["caused_by"]
    if not isinstance(causes, list) or len(causes) > MAX_EVENTS:
        errs.append(f"{where}.caused_by must be a short list of indexes")
    else:
        for c in causes:
            if not _int(c) or not 0 <= c < len(events) or c == i:
                errs.append(f"{where}.caused_by has invalid index {c!r}")
            elif _int(t) and _int(events[c].get("sim_time_minutes")) and events[c]["sim_time_minutes"] > t:
                errs.append(f"{where}.caused_by[{c}] happens after the event it caused")
    return errs


def build_batch(
    raw: Any,
    *,
    simulation_id: str,
    branch_id: str = "main",
    source: str = "model",
    model: Optional[str] = None,
    first_id: int = 1,
) -> dict:
    """Validate raw {"events": [...]} output and return a proposed event batch."""
    for name, value in (("simulation_id", simulation_id), ("branch_id", branch_id)):
        if not isinstance(value, str) or not re.fullmatch(SLUG_PATTERN, value):
            raise DirectorError("invalid_scenario", f"{name} must match {SLUG_PATTERN}")
    if not _int(first_id) or first_id < 1:
        raise DirectorError("invalid_scenario", "first_id must be a positive integer")
    if not isinstance(raw, dict) or set(raw) != {"events"} or not isinstance(raw["events"], list):
        raise DirectorError("invalid_events", 'Output must be an object with only an "events" array')
    events = raw["events"]
    if not 1 <= len(events) <= MAX_EVENTS:
        raise DirectorError("invalid_events", f"Expected 1-{MAX_EVENTS} events, got {len(events)}")

    errs = [e for i, ev in enumerate(events) for e in _check_event(i, ev, events)]
    if errs:
        raise DirectorError("invalid_events", "Model output failed validation", "\n".join(errs))

    order = sorted(range(len(events)), key=lambda i: events[i]["sim_time_minutes"])  # stable
    ids = {orig: f"evt-{first_id + pos:04d}" for pos, orig in enumerate(order)}
    provenance = {"source": source}
    if model:
        provenance["model"] = model

    out = []
    seq_at: dict = {}
    for orig in order:
        ev = events[orig]
        t = ev["sim_time_minutes"]
        seq_at[t] = seq_at.get(t, -1) + 1
        payload: dict = {"description": ev["description"].strip()}
        for key in ("magnitude", "depth_km", "origin"):
            if ev[key] is not None:
                payload[key] = ev[key]
        loc = ev["location"]
        out.append(
            {
                "id": ids[orig],
                "sim_time_minutes": t,
                "sequence": seq_at[t],
                "type": ev["type"],
                "status": "proposed",
                "location": {
                    "name": loc["name"].strip(),
                    "country": loc["country"].strip(),
                    "country_code": loc["country_code"],
                    "lat": float(loc["lat"]),
                    "lon": float(loc["lon"]),
                },
                "severity": float(ev["severity"]),
                "visual": VISUALS[ev["type"]],
                "payload": payload,
                "parent_ids": [ids[c] for c in dict.fromkeys(ev["caused_by"])],
                "provenance": dict(provenance),
            }
        )
    return {
        "schema_version": SCHEMA_VERSION,
        "simulation_id": simulation_id,
        "branch_id": branch_id,
        "events": out,
    }
