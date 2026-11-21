"""Turn applied simulation events into WORLD//WIRE news items.

Input events follow contracts/events.schema.json (v0.1).
Only events whose status is "applied" are reported, so the newsroom never
announces something the simulation has not confirmed. Templates are keyed by
event type, never by scenario, so any prompted crisis gets the same treatment.
"""

from __future__ import annotations

from typing import Any, Callable, Iterable

from .impacts import aid_amount, contributor, fmt_count, fmt_tonnes, fmt_usd, impact_sentence, read_impacts

SIMULATED_LABEL = "SIMULATED"
DEFAULT_FOCUS_ZOOM = 6.0

Event = dict[str, Any]
NewsItem = dict[str, Any]
# A template returns (headline, dek) or (headline, dek, impact keys already used in the copy).
Copy = tuple[str, str] | tuple[str, str, tuple[str, ...]]


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


def _international_aid(event: Event) -> Copy:
    origin = _payload_text(event, "origin")
    sender = origin if origin.lower() != "unknown" else ""
    impacts = read_impacts(event)
    entry = contributor(impacts, sender)
    amount = aid_amount(entry) if entry else ""
    place = _place(event)
    if sender and amount:
        headline = f"{sender} has now sent {amount} to {place}"
    elif sender:
        headline = f"{sender} sends aid to {place}"
    else:
        headline = f"International aid heads to {place}"
    dek = "Simulated relief shipment is under way to support the response."
    if entry and "cargo" in entry:
        dek = f"Simulated relief includes {entry['cargo']}."
    countries = len(impacts.get("aid_contributors", []))
    if countries > 1:
        dek += f" {countries} countries have now sent help in the simulation."
    return headline, dek


def _payload_text(event: Event, key: str) -> str:
    value = event.get("payload", {}).get(key)
    return value.strip() if isinstance(value, str) and value.strip() else ""


def _simple(headline: str, dek: str) -> Callable[[Event], Copy]:
    """Template whose headline is `headline` followed by the place."""
    return lambda event: (f"{headline} {_place(event)}", dek)


def _volcanic_eruption(event: Event) -> tuple[str, str]:
    vei = event.get("payload", {}).get("vei")
    scale = f" (VEI {vei})" if isinstance(vei, int) else ""
    return (
        f"Volcano erupts near {_place(event)}{scale}",
        "Simulated ash plume grounds flights and coats nearby towns. Residents are told to stay indoors.",
    )


def _disease_outbreak(event: Event) -> tuple[str, str]:
    pathogen = _payload_text(event, "pathogen")
    name = f"{pathogen[0].upper()}{pathogen[1:]}" if pathogen else "Disease"
    return (
        f"{name} outbreak reported in {_place(event)}",
        "Simulated cases are rising. Health authorities are tracing contacts and urging precautions.",
    )


def _military_strike(event: Event) -> tuple[str, str]:
    origin = _payload_text(event, "origin")
    headline = f"{origin} launches strike on {_place(event)}" if origin and origin.lower() != "unknown" else f"Military strike hits {_place(event)}"
    return headline, "Simulated strike damages key sites. Civil defense sirens sound across the region."


def _cyber_attack(event: Event) -> tuple[str, str]:
    target = _payload_text(event, "target")
    headline = f"Cyberattack hits {target} in {_place(event)}" if target else f"Cyberattack disrupts systems in {_place(event)}"
    return headline, "Simulated outage spreads across networks. Operators are working to restore service."


def _other_hazard(event: Event) -> tuple[str, str]:
    label = _payload_text(event, "label")
    headline = f"{label[0].upper()}{label[1:]} reported in {_place(event)}" if label else f"Emergency declared in {_place(event)}"
    return headline, "Simulated emergency is developing. Authorities are assessing the situation."


def _evacuation(event: Event) -> Copy:
    displaced = read_impacts(event).get("displaced")
    if displaced is None:
        return f"Evacuations ordered in {_place(event)}", "Simulated evacuation routes fill as residents head for safer ground."
    return (
        f"An estimated {fmt_count(displaced)} people displaced as evacuations widen in {_place(event)}",
        "Simulated evacuation routes fill as residents head for safer ground.",
        ("displaced",),
    )


def _outage(event: Event) -> Copy:
    impacts = read_impacts(event)
    power = impacts.get("households_without_power")
    if power is None:
        return _infrastructure_failure(event)
    return (
        f"An estimated {fmt_count(power)} households without power in {_place(event)}",
        "Simulated outages disrupt power, transit, or communications. Crews are assessing damage.",
        ("households_without_power",),
    )


def _economic_shock(event: Event) -> Copy:
    loss = read_impacts(event).get("economic_loss_usd")
    dek = "Simulated markets slide and supply chains stall as the crisis spreads."
    if loss is None:
        return f"Economic shock hits {_place(event)}", dek
    return f"Losses estimated at {fmt_usd(loss)} as economic shock hits {_place(event)}", dek, ("economic_loss_usd",)


def _contamination(event: Event) -> Copy:
    impacts = read_impacts(event)
    place = _place(event)
    dek = "Simulated hazard zone is declared. Residents are told to avoid local water and produce."
    if "contaminated_area_km2" in impacts:
        area = fmt_count(impacts["contaminated_area_km2"])
        return f"An estimated {area} km² contaminated around {place}", dek, ("contaminated_area_km2",)
    if "flooded_area_km2" in impacts:
        area = fmt_count(impacts["flooded_area_km2"])
        return f"An estimated {area} km² flooded around {place}", dek, ("flooded_area_km2",)
    if "debris_tonnes" in impacts:
        return f"An estimated {fmt_tonnes(impacts['debris_tonnes'])} of debris litters {place}", dek, ("debris_tonnes",)
    return f"Contamination alert issued for {place}", dek


def _recovery(event: Event) -> Copy:
    power = read_impacts(event).get("households_without_power")
    dek = "Simulated rebuilding begins as services come back online."
    if power is None:
        return f"Recovery under way in {_place(event)}", dek
    if power == 0:
        return f"Power restored across {_place(event)} as recovery takes hold", dek, ("households_without_power",)
    return (
        f"Recovery under way in {_place(event)}, with an estimated {fmt_count(power)} households still without power",
        dek,
        ("households_without_power",),
    )


def _generic(event: Event) -> tuple[str, str]:
    kind = str(event["type"]).replace("_", " ")
    return f"{kind.capitalize()} reported in {_place(event)}", "Details are developing in the simulation."


TEMPLATES: dict[str, Callable[[Event], Copy]] = {
    "earthquake": _earthquake,
    "aftershock": _aftershock,
    "tsunami_warning": _tsunami_warning,
    "infrastructure_failure": _outage,
    "government_response": _government_response,
    "international_aid": _international_aid,
    "volcanic_eruption": _volcanic_eruption,
    "meteor_impact": _simple("Meteor strikes", "Simulated impact flattens the area around ground zero. Rescue teams are converging."),
    "extreme_weather": _simple("Extreme weather batters", "Simulated storm brings flooding and high winds. Shelters are opening."),
    "flooding": _simple("Floodwaters swamp", "Simulated flooding cuts off roads and homes. Rescue boats are searching for stranded residents."),
    "disease_outbreak": _disease_outbreak,
    "military_strike": _military_strike,
    "nuclear_detonation": _simple("Nuclear detonation reported near", "Simulated blast triggers emergency alerts. Residents downwind are told to shelter in place."),
    "cyber_attack": _cyber_attack,
    "alien_contact": _simple("Unidentified craft reported over", "Simulated sightings flood social media. Officials urge calm while they investigate."),
    "other_hazard": _other_hazard,
    "evacuation": _evacuation,
    "contamination": _contamination,
    "economic_shock": _economic_shock,
    "civil_unrest": _simple("Unrest erupts in", "Simulated protests grow as frustration with the response mounts."),
    "conflict_escalation": _simple("Conflict escalates near", "Simulated fighting widens. Neighboring countries raise their alert levels."),
    "ceasefire": _simple("Ceasefire declared in", "Simulated truce takes hold. Aid convoys prepare to move in."),
    "recovery": _recovery,
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
    copy = TEMPLATES.get(event["type"], _generic)(event)
    headline, dek = copy[0], copy[1]
    used = copy[2] if len(copy) > 2 else ()
    figures = impact_sentence(event["type"], read_impacts(event), skip=used)
    if figures:
        dek = f"{dek} {figures}"
    loc = event["location"]
    return {
        "id": f"news-{event['id']}",
        "event_id": event["id"],
        "event_type": event["type"],
        "severity": event.get("severity"),
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


class WireFeed:
    """Live WORLD//WIRE state driven by stream messages (contracts/stream.schema.json).

    `event` messages add one applied event, `snapshot` messages (connect, seek,
    replay) replace everything, and `clock` messages carry no news. Events that
    are not applied are ignored, so rejected or proposed events never appear.
    """

    def __init__(self) -> None:
        self._events: dict[str, Event] = {}

    def apply(self, message: dict[str, Any]) -> bool:
        """Apply one message. Returns True when the visible feed may have changed."""
        kind = message.get("kind")
        if kind == "snapshot":
            self._events = {e["id"]: e for e in message.get("events", []) if e.get("status") == "applied"}
            return True
        if kind == "event":
            event = message["event"]
            if event.get("status") != "applied":
                return False
            self._events[event["id"]] = event
            return True
        return False

    @property
    def items(self) -> list[NewsItem]:
        return derive_news(self._events.values())


def news_from_stream(messages: Iterable[dict[str, Any]]) -> list[NewsItem]:
    """Fold a sequence of stream messages into the resulting feed."""
    feed = WireFeed()
    for message in messages:
        feed.apply(message)
    return feed.items
