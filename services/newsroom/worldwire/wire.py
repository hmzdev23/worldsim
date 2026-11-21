"""Turn applied simulation events into WORLD//WIRE news items.

Input events follow contracts/events.schema.json (v0.1).
Only events whose status is "applied" are reported, so the newsroom never
announces something the simulation has not confirmed.
"""

from __future__ import annotations

from typing import Any, Callable, Iterable

SIMULATED_LABEL = "SIMULATED"
DEFAULT_FOCUS_ZOOM = 6.0

Event = dict[str, Any]
NewsItem = dict[str, Any]


def format_sim_time(minutes: int) -> str:
    """Format minutes since simulation start as 'DAY n · HH:MM'. Day 1 starts at minute 0."""
    if minutes < 0:
        raise ValueError("sim_time_minutes must not be negative")
    day, minute_of_day = divmod(minutes, 24 * 60)
    hours, mins = divmod(minute_of_day, 60)
    return f"DAY {day + 1} · {hours:02d}:{mins:02d}"


def _place(event: Event) -> str:
    loc = event["location"]
    name, country = loc.get("name"), loc.get("country")
    if name and country and country.lower() not in name.lower():
        return f"{name}, {country}"
    return name or country or "an unnamed location"


def _earthquake(event: Event) -> tuple[str, str]:
    payload = event.get("payload", {})
    magnitude = payload.get("magnitude")
    country = event["location"].get("country", "the region")
    strength = f"M{magnitude:.1f} " if isinstance(magnitude, (int, float)) else ""
    headline = f"{strength}earthquake strikes {_place(event)}"
    dek = f"Simulated shaking reported across {country}"
    depth = payload.get("depth_km")
    if isinstance(depth, (int, float)):
        dek += f" from a quake about {depth:g} km deep"
    return headline, dek + ". Emergency response assessment is under way."


def _aftershock(event: Event) -> tuple[str, str]:
    magnitude = event.get("payload", {}).get("magnitude")
    strength = f"M{magnitude:.1f} " if isinstance(magnitude, (int, float)) else ""
    return (
        f"{strength}aftershock rattles {_place(event)}",
        "Simulated aftershock adds strain to damaged structures. Residents are urged to stay alert.",
    )


def _severity_word(event: Event) -> str:
    severity = event.get("severity")
    if not isinstance(severity, (int, float)):
        return ""
    return "Major " if severity >= 0.7 else "Partial " if severity < 0.4 else ""


def _tsunami_warning(event: Event) -> tuple[str, str]:
    return (
        f"Tsunami warning issued for {_place(event)}",
        "Simulated coastal alert in effect. Authorities order evacuation of low-lying areas.",
    )


def _infrastructure_failure(event: Event) -> tuple[str, str]:
    headline = f"{_severity_word(event)}infrastructure failure hits {_place(event)}"
    return (
        headline[0].upper() + headline[1:],
        "Simulated outages disrupt power, transit, or communications. Crews are assessing damage.",
    )


def _government_response(event: Event) -> tuple[str, str]:
    country = event["location"].get("country") or "Government"
    return (
        f"{country} mobilizes emergency response in {event['location'].get('name') or 'affected areas'}",
        "Simulated government action deploys rescue teams and emergency services.",
    )


def _international_aid(event: Event) -> tuple[str, str]:
    origin = event.get("payload", {}).get("origin")
    headline = (
        f"{origin} sends aid to {_place(event)}"
        if isinstance(origin, str) and origin
        else f"International aid heads to {_place(event)}"
    )
    return (
        headline,
        "Simulated relief shipments are under way to support the response.",
    )


def _generic(event: Event) -> tuple[str, str]:
    kind = str(event["type"]).replace("_", " ")
    return f"{kind.capitalize()} reported in {_place(event)}", "Details are developing in the simulation."


TEMPLATES: dict[str, Callable[[Event], tuple[str, str]]] = {
    "earthquake": _earthquake,
    "aftershock": _aftershock,
    "tsunami_warning": _tsunami_warning,
    "infrastructure_failure": _infrastructure_failure,
    "government_response": _government_response,
    "international_aid": _international_aid,
}


def _validate(event: Event) -> None:
    for key in ("id", "type", "status", "sim_time_minutes", "location"):
        if key not in event:
            raise ValueError(f"event is missing required field {key!r}")
    loc = event["location"]
    for key in ("lat", "lon"):
        if not isinstance(loc.get(key), (int, float)):
            raise ValueError(f"event {event['id']} location needs a numeric {key!r}")
    if not -90 <= loc["lat"] <= 90 or not -180 <= loc["lon"] <= 180:
        raise ValueError(f"event {event['id']} location is out of range")


def news_for_event(event: Event) -> NewsItem | None:
    """Build one news item, or return None if the event has not been applied."""
    _validate(event)
    if event["status"] != "applied":
        return None
    headline, dek = TEMPLATES.get(event["type"], _generic)(event)
    loc = event["location"]
    return {
        "id": f"news-{event['id']}",
        "event_id": event["id"],
        "label": SIMULATED_LABEL,
        "headline": headline,
        "dek": dek,
        "sim_time_minutes": event["sim_time_minutes"],
        "sequence": event.get("sequence", 0),
        "sim_time_label": format_sim_time(event["sim_time_minutes"]),
        "focus": {
            "event_id": event["id"],
            "lat": loc["lat"],
            "lon": loc["lon"],
            "zoom": DEFAULT_FOCUS_ZOOM,
        },
        "provenance": "template",
    }


def derive_news(events: Iterable[Event]) -> list[NewsItem]:
    """Return news for applied events, newest first by (sim_time_minutes, sequence)."""
    items = [item for item in map(news_for_event, events) if item is not None]
    items.sort(key=lambda item: (item["sim_time_minutes"], item["sequence"], item["event_id"]), reverse=True)
    return items


def news_from_stream(messages: Iterable[dict[str, Any]]) -> list[NewsItem]:
    """Fold stream messages (contracts/stream.schema.json) into the current feed.

    A snapshot replaces everything seen so far (connect, seek, or replay); each
    event message adds one applied event; clock messages carry no news.
    """
    events: dict[str, Event] = {}
    for message in messages:
        kind = message.get("kind")
        if kind == "snapshot":
            events = {e["id"]: e for e in message["events"]}
        elif kind == "event":
            events[message["event"]["id"]] = message["event"]
    return derive_news(events.values())
