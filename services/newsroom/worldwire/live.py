"""Live WORLD//WIRE for any run (NEWS-005, #51).

The simulation service calls `news_response` with a run's released snapshot
(`Simulation.snapshot()`) and returns the result from
`GET /scenarios/{id}/news`. The browser uses the same items for the news
archive and the map alert, so both show the same story.

Each response is derived from scratch from the run's own applied events, so
nothing carries over between runs that reuse event IDs, and a story reads the
same during normal play, after a seek, and after a replay.
"""

from __future__ import annotations

from typing import Any, Iterable

from .wire import NewsItem, derive_news

SCHEMA_VERSION = "0.1"
Message = dict[str, Any]


def released_events(events: Iterable[dict[str, Any]], sim_time_minutes: int) -> list[dict[str, Any]]:
    """Applied events at or before `sim_time_minutes`. Future and unapplied events are withheld."""
    return [
        event
        for event in events
        if event.get("status") == "applied" and event.get("sim_time_minutes", 0) <= sim_time_minutes
    ]


def news_response(snapshot: Message) -> Message:
    """WORLD//WIRE items for one run at one moment.

    `snapshot` is a stream `snapshot` message, or any object with the same
    header (`simulation_id`, `branch_id`, `sim_time_minutes`) and `events`,
    such as the `/timeline` view. Events later than `sim_time_minutes` are
    never reported, even if the caller passes them in.

    Returns::

        {"schema_version", "simulation_id", "branch_id", "sim_time_minutes",
         "items": [news items, newest first]}

    Items have the usual WORLD//WIRE shape. `event_id` matches the run's
    stream events, so a client can drop any item whose event is no longer in
    its current applied set (after a seek, or a response from an earlier run).
    """
    for key in ("simulation_id", "branch_id", "sim_time_minutes"):
        if key not in snapshot:
            raise ValueError(f"snapshot is missing {key!r}")
    now = snapshot["sim_time_minutes"]
    if isinstance(now, bool) or not isinstance(now, int) or now < 0:
        raise ValueError("sim_time_minutes must be a non-negative integer")
    items: list[NewsItem] = derive_news(released_events(snapshot.get("events", []), now))
    return {
        "schema_version": snapshot.get("schema_version", SCHEMA_VERSION),
        "simulation_id": snapshot["simulation_id"],
        "branch_id": snapshot["branch_id"],
        "sim_time_minutes": now,
        "items": items,
    }
