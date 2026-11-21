"""Validate raw model output and turn it into a proposed event batch.

Hand-rolled (standard library only) so it runs without installing anything.
Anything unexpected is rejected rather than repaired, except that events are
stably sorted by simulated time.
"""

from __future__ import annotations

import math
from typing import Any

from .contract import EVENT_TYPES, MAX_EVENTS, MAX_SIM_MINUTES, SCHEMA_VERSION, VISUALS
from .errors import DirectorError

_EVENT_KEYS = {
    "type",
    "sim_time_minutes",
    "location",
    "severity",
    "description",
    "magnitude",
    "depth_km",
    "origin_country",
}
_LOCATION_KEYS = {"name", "country", "lat", "lon"}


def _num(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _text(value: Any, limit: int) -> bool:
    return isinstance(value, str) and 0 < len(value.strip()) <= limit


def _check_event(i: int, ev: Any) -> list[str]:
    where = f"events[{i}]"
    if not isinstance(ev, dict):
        return [f"{where} is not an object"]
    errs: list[str] = []
    keys = set(ev)
    if keys != _EVENT_KEYS:
        if _EVENT_KEYS - keys:
            errs.append(f"{where} missing {sorted(_EVENT_KEYS - keys)}")
        if keys - _EVENT_KEYS:
            errs.append(f"{where} has unknown keys {sorted(keys - _EVENT_KEYS)}")
        return errs

    if ev["type"] not in EVENT_TYPES:
        errs.append(f"{where}.type {ev['type']!r} is not an allowed event type")
    t = ev["sim_time_minutes"]
    if not isinstance(t, int) or isinstance(t, bool) or not 0 <= t <= MAX_SIM_MINUTES:
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
        if not _num(loc["lat"]) or not -90 <= loc["lat"] <= 90:
            errs.append(f"{where}.location.lat out of range")
        if not _num(loc["lon"]) or not -180 <= loc["lon"] <= 180:
            errs.append(f"{where}.location.lon out of range")

    for key, lo, hi in (("magnitude", 0, 10), ("depth_km", 0, 700)):
        v = ev[key]
        if v is not None and (not _num(v) or not lo <= v <= hi):
            errs.append(f"{where}.{key} must be null or a number in {lo}..{hi}")
    if ev["origin_country"] is not None and not _text(ev["origin_country"], 80):
        errs.append(f"{where}.origin_country must be null or a short string")
    return errs


def _to_event(n: int, ev: dict, provenance: str) -> dict:
    payload: dict[str, Any] = {"description": ev["description"].strip()}
    for key in ("magnitude", "depth_km", "origin_country"):
        if ev[key] is not None:
            payload[key] = ev[key]
    loc = ev["location"]
    return {
        "id": f"evt-{n:04d}",
        "type": ev["type"],
        "status": "proposed",
        "sim_time_minutes": ev["sim_time_minutes"],
        "location": {
            "name": loc["name"].strip(),
            "country": loc["country"].strip(),
            "lat": float(loc["lat"]),
            "lon": float(loc["lon"]),
        },
        "severity": float(ev["severity"]),
        "payload": payload,
        "visual": VISUALS[ev["type"]],
        "provenance": provenance,
    }


def build_batch(
    raw: Any,
    *,
    simulation_id: str,
    branch_id: str = "main",
    provenance: str = "model",
    first_id: int = 1,
) -> dict:
    """Validate raw {"events": [...]} output and return a proposed event batch."""
    if not isinstance(raw, dict) or set(raw) != {"events"} or not isinstance(raw["events"], list):
        raise DirectorError("invalid_events", 'Output must be an object with only an "events" array')
    events = raw["events"]
    if not 1 <= len(events) <= MAX_EVENTS:
        raise DirectorError("invalid_events", f"Expected 1-{MAX_EVENTS} events, got {len(events)}")

    errs = [e for i, ev in enumerate(events) for e in _check_event(i, ev)]
    if errs:
        raise DirectorError("invalid_events", "Model output failed validation", "\n".join(errs))

    ordered = sorted(events, key=lambda ev: ev["sim_time_minutes"])
    return {
        "schema_version": SCHEMA_VERSION,
        "simulation_id": simulation_id,
        "branch_id": branch_id,
        "events": [_to_event(first_id + i, ev, provenance) for i, ev in enumerate(ordered)],
    }
