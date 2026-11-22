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
    CONTRIBUTOR_FIELDS,
    IMPACT_BASIS,
    IMPACT_FIELDS,
    MAX_AID_COUNTRIES,
    MAX_EVENTS,
    MAX_SIM_MINUTES,
    PAYLOAD_FIELDS,
    REQUIRED_PAYLOAD,
    SCHEMA_VERSION,
    SLUG_PATTERN,
    VISUALS,
)
from .errors import DirectorError
from .volcanoes import MAX_DISTANCE_KM, nearest_volcano

_EVENT_KEYS = {
    "type", "sim_time_minutes", "location", "severity", "description",
    "impacts", "caused_by", "caused_by_events", *PAYLOAD_FIELDS,
}
_IMPACT_KEYS = {*IMPACT_FIELDS, "aid_contributors"}
_CONTRIBUTOR_KEYS = {"country", *CONTRIBUTOR_FIELDS, "cargo"}
_LOCATION_KEYS = {"name", "country", "country_code", "lat", "lon"}


def _num(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _text(value: Any, limit: int) -> bool:
    return isinstance(value, str) and 0 < len(value.strip()) <= limit


def _check_event(i: int, ev: Any, events: list, prior: dict, now: int) -> list:
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
    if not _int(t) or not now <= t <= MAX_SIM_MINUTES:
        errs.append(f"{where}.sim_time_minutes must be an integer in {now}..{MAX_SIM_MINUTES}")
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
        elif ev["type"] == "volcanic_eruption" and _num(loc["lat"]) and -90 <= loc["lat"] <= 90:
            volcano, km = nearest_volcano(loc["lat"], loc["lon"])
            if km > MAX_DISTANCE_KM:
                errs.append(
                    f"{where}.location must be a known volcano (within {MAX_DISTANCE_KM:.0f} km); "
                    f"the nearest is {volcano.name}, {volcano.country}, {km:.0f} km away"
                )

    for key, (kind, lo, hi, _) in PAYLOAD_FIELDS.items():
        v = ev[key]
        if v is None:
            if key in REQUIRED_PAYLOAD.get(ev["type"], ()):
                errs.append(f"{where}.{key} is required for {ev['type']}")
        elif kind == "string":
            if not _text(v, hi):
                errs.append(f"{where}.{key} must be null or a 1-{hi} character string")
        elif not (_int(v) if kind == "integer" else _num(v)) or not lo <= v <= hi:
            errs.append(f"{where}.{key} must be null or a {kind} in {lo}..{hi}")

    errs.extend(_check_impacts(where, ev["impacts"]))

    causes = ev["caused_by"]
    if not isinstance(causes, list) or len(causes) > MAX_EVENTS:
        errs.append(f"{where}.caused_by must be a short list of indexes")
    else:
        for c in causes:
            if not _int(c) or not 0 <= c < len(events) or c == i:
                errs.append(f"{where}.caused_by has invalid index {c!r}")
            elif _int(t) and _int(events[c].get("sim_time_minutes")) and events[c]["sim_time_minutes"] > t:
                errs.append(f"{where}.caused_by[{c}] happens after the event it caused")

    prior_causes = ev["caused_by_events"]
    if not isinstance(prior_causes, list) or len(prior_causes) > MAX_EVENTS:
        errs.append(f"{where}.caused_by_events must be a short list of event IDs")
    else:
        for pid in prior_causes:
            if not isinstance(pid, str) or pid not in prior:
                errs.append(f"{where}.caused_by_events has unknown event {pid!r}")
            elif _int(t) and prior[pid] > t:
                errs.append(f"{where}.caused_by_events {pid!r} happens after the event it caused")
    return errs


def _check_impacts(where: str, imp: Any) -> list:
    if imp is None:
        return []
    if not isinstance(imp, dict) or set(imp) != _IMPACT_KEYS:
        return [f"{where}.impacts must have exactly {sorted(_IMPACT_KEYS)} (null when unknown)"]
    errs = []
    for key, (kind, hi, _) in IMPACT_FIELDS.items():
        v = imp[key]
        if v is not None and (not (_int(v) if kind == "integer" else _num(v)) or not 0 <= v <= hi):
            errs.append(f"{where}.impacts.{key} must be null or a non-negative {kind}")
    contributors = imp["aid_contributors"]
    if contributors is not None:
        if not isinstance(contributors, list) or len(contributors) > MAX_AID_COUNTRIES:
            return errs + [f"{where}.impacts.aid_contributors must be null or a list of countries"]
        names = []
        for j, entry in enumerate(contributors):
            here = f"{where}.impacts.aid_contributors[{j}]"
            if not isinstance(entry, dict) or set(entry) != _CONTRIBUTOR_KEYS:
                errs.append(f"{here} must have exactly {sorted(_CONTRIBUTOR_KEYS)}")
                continue
            if not _text(entry["country"], 80):
                errs.append(f"{here}.country must be a country name")
            names.append(str(entry["country"]).strip())
            for key, (kind, hi) in CONTRIBUTOR_FIELDS.items():
                val = entry[key]
                if val is not None and (not (_int(val) if kind == "integer" else _num(val)) or not 0 <= val <= hi):
                    errs.append(f"{here}.{key} must be null or a non-negative {kind}")
            if entry["cargo"] is not None and not _text(entry["cargo"], 120):
                errs.append(f"{here}.cargo must be null or a short description")
        if len(set(names)) != len(names):
            errs.append(f"{where}.impacts.aid_contributors lists a country twice")
    return errs


def _impacts_payload(imp: Optional[dict]) -> Optional[dict]:
    """Model impacts -> contract impacts: drop unknowns, add the fictional-estimate marker."""
    if not imp:
        return None
    out: dict = {k: imp[k] for k in IMPACT_FIELDS if imp.get(k) is not None}
    if imp.get("aid_contributors"):
        out["aid_contributors"] = [
            {k: (v.strip() if isinstance(v, str) else v) for k, v in entry.items() if v is not None}
            for entry in imp["aid_contributors"]
        ]
    return {"basis": IMPACT_BASIS, **out} if out else None


def _cumulative_errors(snapshots: list) -> list:
    """snapshots: [(event label, contract impacts)] in time order. Running totals must not fall."""
    errs = []
    best: dict = {}  # running-total name -> (highest value so far, where it was set)
    countries: set = set()  # every aid contributor seen so far
    for label, imp in snapshots:
        if not imp:
            continue
        current = {k: imp[k] for k, (_, _, cumulative) in IMPACT_FIELDS.items() if cumulative and k in imp}
        for entry in imp.get("aid_contributors", []):
            for key in CONTRIBUTOR_FIELDS:
                if key in entry:
                    current[f"aid_contributors[{entry['country']}].{key}"] = entry[key]
        for key, value in current.items():
            if key in best and value < best[key][0]:
                errs.append(f"{label}.impacts.{key} drops from {best[key][0]} ({best[key][1]}) to {value}; it is a running total")
            else:
                best[key] = (value, label)
        if "aid_contributors" in imp:
            listed = {entry["country"] for entry in imp["aid_contributors"]}
            if countries - listed:
                errs.append(f"{label}.impacts.aid_contributors drops {sorted(countries - listed)}; it lists every country so far")
            countries |= listed
    return errs


def _event_number(event_id: str) -> int:
    m = re.fullmatch(r"evt-(\d+)", event_id)
    return int(m.group(1)) if m else 0


def history_state(history: Optional[list]) -> tuple:
    """Summarize prior contract events: ({id: sim_time}, latest sim_time, next free id number, {time: max sequence})."""
    prior: dict = {}
    max_seq: dict = {}
    for e in history or []:
        if not isinstance(e, dict) or not isinstance(e.get("id"), str) or not _int(e.get("sim_time_minutes")):
            raise DirectorError("invalid_history", "History events need an id and an integer sim_time_minutes")
        prior[e["id"]] = e["sim_time_minutes"]
        seq = e.get("sequence", 0)
        max_seq[e["sim_time_minutes"]] = max(max_seq.get(e["sim_time_minutes"], -1), seq if _int(seq) else 0)
    now = max(prior.values(), default=0)
    next_id = max((_event_number(i) for i in prior), default=0) + 1
    return prior, now, next_id, max_seq


def build_batch(
    raw: Any,
    *,
    simulation_id: str,
    branch_id: str = "main",
    source: str = "model",
    model: Optional[str] = None,
    first_id: Optional[int] = None,
    history: Optional[list] = None,
    max_events: int = MAX_EVENTS,
) -> dict:
    """Validate raw {"events": [...]} output and return a proposed event batch.

    history: events that already happened (contract shape). New events must not
    start before the latest of them, may name them in caused_by_events, and get
    IDs and sequence numbers that continue after them.
    """
    prior, now, next_id, max_seq = history_state(history)
    if first_id is None:
        first_id = next_id
    for name, value in (("simulation_id", simulation_id), ("branch_id", branch_id)):
        if not isinstance(value, str) or not re.fullmatch(SLUG_PATTERN, value):
            raise DirectorError("invalid_scenario", f"{name} must match {SLUG_PATTERN}")
    if not _int(first_id) or first_id < 1:
        raise DirectorError("invalid_scenario", "first_id must be a positive integer")
    if not isinstance(raw, dict) or set(raw) != {"events"} or not isinstance(raw["events"], list):
        raise DirectorError("invalid_events", 'Output must be an object with only an "events" array')
    events = raw["events"]
    if not 1 <= len(events) <= max_events:
        raise DirectorError("invalid_events", f"Expected 1-{max_events} events, got {len(events)}")

    errs = [e for i, ev in enumerate(events) for e in _check_event(i, ev, events, prior, now)]
    if errs:
        raise DirectorError("invalid_events", "Model output failed validation", "\n".join(errs))

    order = sorted(range(len(events)), key=lambda i: events[i]["sim_time_minutes"])  # stable
    past = [
        (e["id"], e.get("payload", {}).get("impacts"))
        for e in sorted(history or [], key=lambda e: (e["sim_time_minutes"], e.get("sequence", 0)))
    ]
    errs = _cumulative_errors(past[-1:] + [(f"events[{i}]", _impacts_payload(events[i]["impacts"])) for i in order])
    if errs:
        raise DirectorError("invalid_events", "Impact estimates are inconsistent", "\n".join(errs))
    ids = {orig: f"evt-{first_id + pos:04d}" for pos, orig in enumerate(order)}
    clash = set(ids.values()) & set(prior)
    if clash:
        raise DirectorError("invalid_scenario", f"first_id reuses existing event IDs: {sorted(clash)}")
    provenance = {"source": source}
    if model:
        provenance["model"] = model

    out = []
    seq_at: dict = dict(max_seq)
    for orig in order:
        ev = events[orig]
        t = ev["sim_time_minutes"]
        seq_at[t] = seq_at.get(t, -1) + 1
        payload: dict = {"description": ev["description"].strip()}
        for key in PAYLOAD_FIELDS:
            if ev[key] is not None:
                payload[key] = ev[key].strip() if isinstance(ev[key], str) else ev[key]
        impacts = _impacts_payload(ev["impacts"])
        if impacts:
            payload["impacts"] = impacts
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
                "parent_ids": list(dict.fromkeys([*ev["caused_by_events"], *(ids[c] for c in ev["caused_by"])])),
                "provenance": dict(provenance),
            }
        )
    return {
        "schema_version": SCHEMA_VERSION,
        "simulation_id": simulation_id,
        "branch_id": branch_id,
        "events": out,
    }
