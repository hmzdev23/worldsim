"""Seeded variation: every run gets its own seed, so no two runs are the same.

WORLD//SIM is open-ended: the same prompt or starter scenario should play out
differently each time while each run stays causally coherent. A run's seed
drives two things:

* Model runs: `prompt_rules(seed)` adds a few seeded directions to the
  Director prompt (pace, emphasis, how the response goes, one surprise), so the
  model explores a different plausible future each time.
* Fixture runs (offline starters): `vary_raw(raw, seed)` perturbs the
  checked-in chain before validation. Times are stretched or compressed by a
  strictly increasing map (cause-before-effect order is kept), severities
  shift slightly, all impact estimates scale by one run-wide factor (running
  totals still never fall), and sometimes one or two dead-end events (nothing
  depends on them) don't happen at all.

The varied batch still goes through the normal validator. `new_seed()` is the
only source of seeds; the same seed always gives the same variation.
"""

from __future__ import annotations

import copy
import random
import secrets
from typing import Any

MAX_SEED = 2**31 - 1
MIN_EVENTS_AFTER_DROP = 6

PACE = (
    "Let this run escalate quickly: the first day is crowded and the cascade outruns the response.",
    "Let this run be a slow burn: early signs are missed, and the serious effects arrive days later.",
    "Let this run unfold in waves: a first shock, a false calm, then a second, larger development.",
    "Let this run peak early and then become a long, uneven recovery.",
)
EMPHASIS = (
    "Weight the consequences toward infrastructure and supply chains.",
    "Weight the consequences toward the economy and markets.",
    "Weight the consequences toward displacement and shelter.",
    "Weight the consequences toward international politics and diplomacy.",
    "Weight the consequences toward public health and hospitals.",
    "Weight the consequences toward transport and travel.",
)
RESPONSE = (
    "The international response is fast and well coordinated.",
    "The international response is slow and fragmented at first.",
    "Neighbouring countries respond first; distant ones only later.",
    "Local authorities handle the first days largely on their own.",
)
SURPRISE = (
    "Include one plausible secondary development that most forecasts would miss.",
    "Include one place, far from the origin, that is affected in an unexpected way.",
    "Include one moment where things briefly look better before getting worse.",
    "Include one development that turns out to be less serious than first reported.",
)


def new_seed() -> int:
    """A fresh random seed for a new run."""
    return secrets.randbelow(MAX_SEED) + 1


def check_seed(seed: Any) -> int:
    if isinstance(seed, bool) or not isinstance(seed, int) or not 0 < seed <= MAX_SEED:
        raise ValueError(f"seed must be an integer in 1..{MAX_SEED}")
    return seed


def prompt_rules(seed: int) -> str:
    """Seeded directions for the Director prompt, one per line."""
    rng = random.Random(check_seed(seed))
    picks = [rng.choice(PACE), rng.choice(EMPHASIS), rng.choice(RESPONSE), rng.choice(SURPRISE)]
    return (
        f"- This is run variation {seed}. Each run explores a different plausible future,\n"
        "  so follow these directions while keeping the chain causal and plausible:\n"
        + "".join(f"  * {p}\n" for p in picks)
    )


def _scale_numbers(value: Any, factor: float) -> Any:
    """Scale every number in an impacts estimate (ints stay ints). Names and text are unchanged."""
    if isinstance(value, bool) or value is None:
        return value
    if isinstance(value, int):
        return int(round(value * factor))
    if isinstance(value, float):
        return round(value * factor, 2)
    if isinstance(value, dict):
        return {k: _scale_numbers(v, factor) for k, v in value.items()}
    if isinstance(value, list):
        return [_scale_numbers(v, factor) for v in value]
    return value


def _time_map(times: list[int], rng: random.Random) -> dict[int, int]:
    """A strictly increasing map of the distinct times: the first stays put, each gap is scaled."""
    distinct = sorted(set(times))
    out = {distinct[0]: distinct[0]}
    for before, after in zip(distinct, distinct[1:]):
        gap = after - before
        out[after] = out[before] + max(1, round(gap * rng.uniform(0.6, 1.5)))
    return out


def _drop_dead_ends(events: list[dict], rng: random.Random) -> list[dict]:
    """Remove up to two events nothing depends on (never the first or last), remapping caused_by."""
    if len(events) <= MIN_EVENTS_AFTER_DROP + 1:
        return events
    order = sorted(range(len(events)), key=lambda i: events[i]["sim_time_minutes"])
    referenced = {c for e in events for c in e.get("caused_by") or [] if isinstance(c, int)}
    candidates = [i for i in order[1:-1] if i not in referenced]
    count = min(rng.choice((0, 1, 1, 2)), len(candidates), len(events) - MIN_EVENTS_AFTER_DROP)
    dropped = set(rng.sample(candidates, count)) if count > 0 else set()
    if not dropped:
        return events
    new_index = {}
    kept = []
    for i, e in enumerate(events):
        if i not in dropped:
            new_index[i] = len(kept)
            kept.append(e)
    for e in kept:
        e["caused_by"] = [new_index[c] for c in e.get("caused_by") or [] if c in new_index]
    return kept


def vary_raw(raw: Any, seed: int) -> Any:
    """A seeded variation of raw Director output ({"events": [...]}). The input is not modified."""
    rng = random.Random(check_seed(seed))
    if not isinstance(raw, dict) or not isinstance(raw.get("events"), list) or not raw["events"]:
        return raw
    if not all(isinstance(e, dict) and isinstance(e.get("sim_time_minutes"), int) for e in raw["events"]):
        return raw  # let the validator report it
    out = copy.deepcopy(raw)
    events = out["events"]
    shift = _time_map([e["sim_time_minutes"] for e in events], rng)
    impact_factor = rng.uniform(0.7, 1.4)
    for e in events:
        e["sim_time_minutes"] = shift[e["sim_time_minutes"]]
        if isinstance(e.get("severity"), (int, float)) and not isinstance(e.get("severity"), bool):
            e["severity"] = round(min(1.0, max(0.05, e["severity"] + rng.uniform(-0.12, 0.12))), 2)
        if e.get("impacts"):
            e["impacts"] = _scale_numbers(e["impacts"], impact_factor)
    out["events"] = _drop_dead_ends(events, rng)
    return out
