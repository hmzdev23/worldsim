"""Deterministic simulation clock and event timeline (SIM-001, #4).

The engine has no wall clock and does no I/O. Callers advance it by a number
of simulated minutes, and it returns contracts/stream.schema.json messages.
The server in server.py turns wall time into calls to `advance`.

Lifecycle: events arrive as `proposed` (Director) or from a fixture. The engine
validates each one and marks it `applied` or `rejected`. Applied events join
the timeline and are released to the stream when the clock reaches their
`sim_time_minutes`, in canonical (sim_time_minutes, sequence) order.
"""

from __future__ import annotations

import copy
import json
import math
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

SCHEMA_VERSION = "0.1"
SPEEDS = (1, 2, 4, 16)
CONTRACTS = Path(__file__).resolve().parents[3] / "contracts"

Message = dict[str, Any]
Event = dict[str, Any]


def _load(name: str) -> dict[str, Any]:
    return json.loads((CONTRACTS / name).read_text(encoding="utf-8"))


def _event_validator():
    """Validator for one event against events.schema.json#/$defs/event, or None."""
    try:
        from jsonschema import Draft202012Validator
        from referencing import Registry, Resource
    except ImportError:  # pragma: no cover - jsonschema is in requirements.txt
        return None
    schema = _load("events.schema.json")
    registry = Registry().with_resource(schema["$id"], Resource.from_contents(schema))
    return Draft202012Validator({"$ref": schema["$id"] + "#/$defs/event"}, registry=registry)


_VALIDATOR = _event_validator()


def canonical_key(event: Event) -> tuple[int, int]:
    return (event["sim_time_minutes"], event["sequence"])


@dataclass
class Rejection:
    id: str
    reasons: list[str]

    def to_json(self) -> dict[str, Any]:
        return {"id": self.id, "reasons": self.reasons}


@dataclass
class Simulation:
    simulation_id: str
    branch_id: str = "main"
    sim_time: float = 0.0
    state: str = "playing"
    speed: int = 1
    _timeline: list[Event] = field(default_factory=list)  # applied, canonical order
    _released: int = 0  # how many timeline events the stream has seen

    # ---- construction -------------------------------------------------

    @classmethod
    def from_batch(cls, batch: dict[str, Any], **kwargs: Any) -> "Simulation":
        sim = cls(simulation_id=batch["simulation_id"], branch_id=batch["branch_id"], **kwargs)
        _, rejected = sim.ingest(batch)
        if rejected:
            details = "; ".join(f"{r.id}: {', '.join(r.reasons)}" for r in rejected)
            raise ValueError(f"fixture has invalid events: {details}")
        return sim

    # ---- validation and ingest ---------------------------------------

    def ingest(self, batch: dict[str, Any]) -> tuple[list[Event], list[Rejection]]:
        """Validate a batch and add its accepted events to the timeline.

        Returns (events with status set to applied/rejected, rejections).
        Events earlier than the current clock are rejected: the stream never
        rewrites the past. Events already marked rejected are skipped.
        """
        header_errors = self._header_errors(batch)
        out: list[Event] = []
        rejections: list[Rejection] = []
        known = {e["id"]: e for e in self._timeline}
        seen_keys = {canonical_key(e) for e in self._timeline}
        incoming = batch.get("events") if isinstance(batch.get("events"), list) else []
        # Validate in canonical order so parents earlier in the same batch count.
        ordered = sorted(
            incoming,
            key=lambda e: (e.get("sim_time_minutes", 0), e.get("sequence", 0))
            if isinstance(e, dict)
            and isinstance(e.get("sim_time_minutes"), int)
            and isinstance(e.get("sequence"), int)
            else (-1, -1),
        )
        for raw in ordered:
            event = copy.deepcopy(raw) if isinstance(raw, dict) else {"id": str(raw)}
            if event.get("status") == "rejected":
                continue
            reasons = list(header_errors) or self._event_errors(event, known, seen_keys)
            event["status"] = "rejected" if reasons else "applied"
            out.append(event)
            if reasons:
                rejections.append(Rejection(str(event.get("id", "?")), reasons))
                continue
            known[event["id"]] = event
            seen_keys.add(canonical_key(event))
            self._insert(event)
        return out, rejections

    def _header_errors(self, batch: dict[str, Any]) -> list[str]:
        errors = []
        if batch.get("schema_version") != SCHEMA_VERSION:
            errors.append(f"schema_version must be {SCHEMA_VERSION}")
        if batch.get("simulation_id") != self.simulation_id:
            errors.append(f"simulation_id must be {self.simulation_id}")
        if batch.get("branch_id") != self.branch_id:
            errors.append(f"branch_id must be {self.branch_id}")
        return errors

    def _event_errors(self, event: Event, known: dict[str, Event], seen_keys: set) -> list[str]:
        candidate = {**event, "status": "applied"}
        if _VALIDATOR is not None:
            schema_errors = sorted(_VALIDATOR.iter_errors(candidate), key=lambda e: list(e.path))
            if schema_errors:
                return [f"{'/'.join(map(str, e.path)) or 'event'}: {e.message}" for e in schema_errors]
        reasons = []
        if event["id"] in known:
            reasons.append("duplicate id")
        if canonical_key(event) in seen_keys:
            reasons.append("another event already has this (sim_time_minutes, sequence)")
        if event["sim_time_minutes"] < self.now:
            reasons.append(f"sim_time_minutes {event['sim_time_minutes']} is before the clock ({self.now})")
        for parent_id in event["parent_ids"]:
            parent = known.get(parent_id)
            if parent is None:
                reasons.append(f"unknown parent {parent_id}")
            elif canonical_key(parent) >= canonical_key(event):
                reasons.append(f"parent {parent_id} does not come before this event")
        return reasons

    def _insert(self, event: Event) -> None:
        key = canonical_key(event)
        index = len(self._timeline)
        while index > 0 and canonical_key(self._timeline[index - 1]) > key:
            index -= 1
        self._timeline.insert(index, event)
        # Ingest rejects past events, so an insert never lands among released ones.
        assert index >= self._released

    # ---- clock ---------------------------------------------------------

    @property
    def now(self) -> int:
        return math.floor(self.sim_time)

    @property
    def playback(self) -> dict[str, Any]:
        return {"state": self.state, "speed": self.speed}

    def advance(self, minutes: float) -> list[Message]:
        """Move the clock forward `minutes` × speed if playing.

        Returns event messages for every event that became due, in canonical
        order, followed by one clock message.
        """
        if minutes < 0:
            raise ValueError("advance takes a non-negative number of minutes")
        if self.state == "playing":
            self.sim_time += minutes * self.speed
        messages = [self._event_message(e) for e in self._release_due()]
        messages.append(self.clock())
        return messages

    def play(self) -> Message:
        self.state = "playing"
        return self.clock()

    def pause(self) -> Message:
        self.state = "paused"
        return self.clock()

    def set_speed(self, speed: int) -> Message:
        if isinstance(speed, bool) or not isinstance(speed, int) or speed not in SPEEDS:
            raise ValueError(f"speed must be one of {SPEEDS}")
        self.speed = speed
        return self.clock()

    def seek(self, minutes: int) -> Message:
        """Jump to a sim time, forward or back. Returns the new snapshot."""
        if isinstance(minutes, bool) or not isinstance(minutes, int) or minutes < 0:
            raise ValueError("sim_time_minutes must be a non-negative integer")
        self.sim_time = float(minutes)
        self._released = 0
        self._release_due()
        return self.snapshot()

    def _release_due(self) -> list[Event]:
        start = self._released
        while self._released < len(self._timeline) and (
            self._timeline[self._released]["sim_time_minutes"] <= self.now
        ):
            self._released += 1
        return self._timeline[start : self._released]

    # ---- messages --------------------------------------------------------

    def _header(self, sim_time_minutes: int) -> Message:
        return {
            "schema_version": SCHEMA_VERSION,
            "simulation_id": self.simulation_id,
            "branch_id": self.branch_id,
            "sim_time_minutes": sim_time_minutes,
        }

    def snapshot(self) -> Message:
        return {
            **self._header(self.now),
            "kind": "snapshot",
            "playback": self.playback,
            "events": copy.deepcopy(self._timeline[: self._released]),
        }

    def clock(self) -> Message:
        return {**self._header(self.now), "kind": "clock", "playback": self.playback}

    def _event_message(self, event: Event) -> Message:
        # The header carries the event's own time so the stream reads in order
        # even when one tick at high speed releases several events.
        return {**self._header(event["sim_time_minutes"]), "kind": "event", "event": copy.deepcopy(event)}

    @property
    def timeline(self) -> list[Event]:
        """Every applied event, released or not, in canonical order."""
        return copy.deepcopy(self._timeline)


def replay(batch: dict[str, Any], speed: int = 1, step_minutes: int = 1) -> list[Message]:
    """Offline replay of a batch from minute 0 through its last event.

    Same messages a WebSocket client would see, without the server. Useful
    in tests and as a drop-in for tests/integration/mock_stream.replay.
    """
    if isinstance(step_minutes, bool) or not isinstance(step_minutes, int) or step_minutes <= 0:
        raise ValueError("step_minutes must be a positive integer")
    sim = Simulation.from_batch(batch, speed=speed)
    messages = [sim.snapshot()]
    last = max((e["sim_time_minutes"] for e in sim.timeline), default=0)
    while sim.now < last:
        messages.extend(sim.advance(step_minutes))
    return messages
