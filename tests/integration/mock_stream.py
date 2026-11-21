"""Stand-in for the SIM-001 event stream, used only by integration tests.

Replays an event batch in canonical (sim_time_minutes, sequence) order as
contracts/stream.schema.json messages: a snapshot first, then an event
message for each applied event, with a clock tick after each one.
Swap this for the real simulation client once SIM-001 lands.
"""

from __future__ import annotations

from typing import Any, Iterator


def replay(batch: dict[str, Any], speed: int = 1) -> Iterator[dict[str, Any]]:
    header = {k: batch[k] for k in ("schema_version", "simulation_id", "branch_id")}
    playback = {"state": "playing", "speed": speed}
    applied = sorted(
        (e for e in batch["events"] if e["status"] == "applied"),
        key=lambda e: (e["sim_time_minutes"], e["sequence"]),
    )
    yield {**header, "kind": "snapshot", "sim_time_minutes": 0, "playback": playback, "events": []}
    for event in applied:
        now = event["sim_time_minutes"]
        yield {**header, "kind": "event", "sim_time_minutes": now, "event": event}
        yield {**header, "kind": "clock", "sim_time_minutes": now, "playback": playback}
