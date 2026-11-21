"""Turn applied simulation events into WORLD//WIRE news items.

Input events follow contracts/events.schema.json (v0.1).
Only events whose status is "applied" are reported, so the newsroom never
announces something the simulation has not confirmed. Templates are keyed by
event type, never by scenario, so any prompted crisis gets the same treatment.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field
from typing import Any, Callable, Iterable

from .impacts import Impacts, aid_amount, contributor, impact_sentence, read_impacts

SIMULATED_LABEL = "SIMULATED"
DEFAULT_FOCUS_ZOOM = 6.0
# Alert-ready lengths: the headline is read at a glance over the map, the dek in one breath.
HEADLINE_MAX = 72
DEK_MAX = 160

Event = dict[str, Any]
NewsItem = dict[str, Any]


@dataclass
class Context:
    """What the newsroom knows when an event is applied.

    `previous` is the latest impact snapshot from an earlier applied event
    (None when unknown), and `seen` counts earlier applied events by
    (type, place) and (type, country). Copy for an event depends only on what
    came before it, so seeking or replaying never rewrites an earlier story.
    """

    impacts: Impacts
    previous: Impacts | None = None
    seen: Counter = field(default_factory=Counter)

    def repeats(self, event: Event, scope: str = "name") -> int:
        return self.seen[(event["type"], scope, event["location"].get(scope))]

    def fell(self, key: str) -> bool:
        before = (self.previous or {}).get(key)
        return key in self.impacts and before is not None and self.impacts[key] < before


def _remember(seen: Counter, event: Event) -> None:
    for scope in ("name", "country"):
        seen[(event["type"], scope, event["location"].get(scope))] += 1


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


def _fit(event: Event, make: Callable[[str], str]) -> str:
    """Headline with "Name, Country", or just the name when that is too long."""
    headline = make(_place(event))
    short = event["location"].get("name")
    if len(headline) > HEADLINE_MAX and short:
        headline = make(short)
    return headline[0].upper() + headline[1:]


def _payload_text(event: Event, key: str) -> str:
    value = event.get("payload", {}).get(key)
    return value.strip() if isinstance(value, str) and value.strip() else ""


def _magnitude(event: Event) -> str:
    magnitude = event.get("payload", {}).get("magnitude")
    return f"M{magnitude:.1f} " if isinstance(magnitude, (int, float)) and not isinstance(magnitude, bool) else ""


# Headline builders: (event, context) -> headline, or (headline, lead sentence for the dek).
Headline = Callable[[Event, Context], "str | tuple[str, str]"]


def _earthquake(event: Event, ctx: Context) -> str:
    again = "Another " if ctx.repeats(event) else ""
    return _fit(event, lambda p: f"{again}{_magnitude(event)}earthquake strikes {p}")


def _aftershock(event: Event, ctx: Context) -> str:
    again = "Another " if ctx.repeats(event) else ""
    return _fit(event, lambda p: f"{again}{_magnitude(event)}aftershock rattles {p}")


def _tsunami_warning(event: Event, ctx: Context) -> str:
    verb = "New tsunami warning issued for" if ctx.repeats(event) else "Tsunami warning issued for"
    return _fit(event, lambda p: f"{verb} {p}")


def _evacuation(event: Event, ctx: Context) -> str:
    verb = "More evacuations ordered in" if ctx.repeats(event) else "Evacuations ordered in"
    return _fit(event, lambda p: f"{verb} {p}")


def _flooding(event: Event, ctx: Context) -> str:
    verb = "Flooding spreads across" if ctx.repeats(event) else "Floodwaters swamp"
    return _fit(event, lambda p: f"{verb} {p}")


def _severity_word(event: Event) -> str:
    severity = event.get("severity")
    if not isinstance(severity, (int, float)):
        return ""
    return "major " if severity >= 0.7 else "partial " if severity < 0.4 else ""


def _infrastructure_failure(event: Event, ctx: Context) -> str:
    target = _payload_text(event, "target")
    if target:
        return _fit(event, lambda p: f"{target} knocked out in {p}")
    return _fit(event, lambda p: f"{_severity_word(event)}infrastructure failure hits {p}")


def _government_response(event: Event, ctx: Context) -> str:
    actor = event["location"].get("country") or "Government"
    verb = "steps up" if ctx.repeats(event, "country") else "mobilizes"
    where = event["location"].get("name") or "affected areas"
    return _fit(event, lambda p: f"{actor} {verb} emergency response in {where}")


def _international_aid(event: Event, ctx: Context) -> tuple[str, str]:
    origin = _payload_text(event, "origin")
    sender = origin if origin.lower() != "unknown" else ""
    entry = contributor(ctx.impacts, sender)
    amount = aid_amount(entry, joiner=", ") if entry else ""
    if sender and amount:
        before = contributor(ctx.previous or {}, sender)
        verb = "has now sent" if before else "sends"
        headline = _fit(event, lambda p: f"{sender} {verb} {amount} to {p}")
    elif sender:
        headline = _fit(event, lambda p: f"{sender} sends aid to {p}")
    else:
        headline = _fit(event, lambda p: f"International aid heads to {p}")
    lead = f"Simulated relief: {entry['cargo']}." if entry and "cargo" in entry else ""
    countries = len(ctx.impacts.get("aid_contributors", []))
    if countries > 1:
        lead += f" {countries} countries have sent help so far."
    return headline, lead.strip()


def _economic_shock(event: Event, ctx: Context) -> str:
    target = _payload_text(event, "target")
    if ctx.repeats(event):
        return _fit(event, lambda p: f"Economic shock deepens in {p}")
    if target:
        return _fit(event, lambda p: f"Economic shock hits {target} in {p}")
    return _fit(event, lambda p: f"Economic shock hits {p}")


def _contamination(event: Event, ctx: Context) -> str:
    verb = "Contamination spreads around" if ctx.repeats(event) else "Contamination zone declared around"
    return _fit(event, lambda p: f"{verb} {p}")


def _recovery(event: Event, ctx: Context) -> str:
    if ctx.impacts.get("households_without_power") == 0 and ctx.fell("households_without_power"):
        return _fit(event, lambda p: f"Power restored across {p}")
    if ctx.fell("households_without_power"):
        return _fit(event, lambda p: f"Power returning across {p}")
    if ctx.fell("displaced"):
        return _fit(event, lambda p: f"Displacement eases in {p}")
    if ctx.fell("households_without_water"):
        return _fit(event, lambda p: f"Water service returning in {p}")
    verb = "Recovery continues in" if ctx.repeats(event) else "Recovery under way in"
    return _fit(event, lambda p: f"{verb} {p}")


def _volcanic_eruption(event: Event, ctx: Context) -> str:
    vei = event.get("payload", {}).get("vei")
    scale = f" (VEI {vei})" if isinstance(vei, int) and not isinstance(vei, bool) else ""
    return _fit(event, lambda p: f"Volcano erupts near {p}{scale}")


def _disease_outbreak(event: Event, ctx: Context) -> str:
    pathogen = _payload_text(event, "pathogen") or "disease"
    return _fit(event, lambda p: f"{pathogen} outbreak reported in {p}")


def _military_strike(event: Event, ctx: Context) -> str:
    origin = _payload_text(event, "origin")
    if origin and origin.lower() != "unknown":
        return _fit(event, lambda p: f"{origin} launches strike on {p}")
    return _fit(event, lambda p: f"Military strike hits {p}")


def _cyber_attack(event: Event, ctx: Context) -> str:
    target = _payload_text(event, "target")
    if target:
        return _fit(event, lambda p: f"Cyberattack hits {target} in {p}")
    return _fit(event, lambda p: f"Cyberattack disrupts systems in {p}")


def _other_hazard(event: Event, ctx: Context) -> str:
    label = _payload_text(event, "label")
    if label:
        return _fit(event, lambda p: f"{label} reported in {p}")
    return _fit(event, lambda p: f"Emergency declared in {p}")


def _simple(verb: str) -> Headline:
    """Headline that is `verb` followed by the place."""
    return lambda event, ctx: _fit(event, lambda p: f"{verb} {p}")


def _generic(event: Event, ctx: Context) -> str:
    kind = str(event["type"]).replace("_", " ")
    return _fit(event, lambda p: f"{kind} reported in {p}")


# (headline builder, fallback dek used when the event carries no figures or description)
TEMPLATES: dict[str, tuple[Headline, str]] = {
    "earthquake": (_earthquake, "Simulated shaking is reported. Emergency response assessment is under way."),
    "aftershock": (_aftershock, "Simulated aftershock adds strain to damaged structures. Residents are urged to stay alert."),
    "tsunami_warning": (_tsunami_warning, "Simulated coastal alert in effect. Authorities order evacuation of low-lying areas."),
    "infrastructure_failure": (_infrastructure_failure, "Simulated outages disrupt power, transit, or communications. Crews are assessing damage."),
    "government_response": (_government_response, "Simulated government action deploys rescue teams and emergency services."),
    "international_aid": (_international_aid, "Simulated relief shipment is under way to support the response."),
    "volcanic_eruption": (_volcanic_eruption, "Simulated ash plume grounds flights and coats nearby towns. Residents are told to stay indoors."),
    "meteor_impact": (_simple("Meteor strikes"), "Simulated impact flattens the area around ground zero. Rescue teams are converging."),
    "extreme_weather": (_simple("Extreme weather batters"), "Simulated storm brings flooding and high winds. Shelters are opening."),
    "flooding": (_flooding, "Simulated flooding cuts off roads and homes. Rescue boats are searching for stranded residents."),
    "disease_outbreak": (_disease_outbreak, "Simulated cases are rising. Health authorities are tracing contacts and urging precautions."),
    "military_strike": (_military_strike, "Simulated strike damages key sites. Civil defense sirens sound across the region."),
    "nuclear_detonation": (_simple("Nuclear detonation reported near"), "Simulated blast triggers emergency alerts. Residents downwind are told to shelter in place."),
    "cyber_attack": (_cyber_attack, "Simulated outage spreads across networks. Operators are working to restore service."),
    "alien_contact": (_simple("Unidentified craft reported over"), "Simulated sightings flood social media. Officials urge calm while they investigate."),
    "other_hazard": (_other_hazard, "Simulated emergency is developing. Authorities are assessing the situation."),
    "evacuation": (_evacuation, "Simulated evacuation routes fill as residents head for safer ground."),
    "contamination": (_contamination, "Simulated hazard zone is declared. Residents are told to avoid local water and produce."),
    "economic_shock": (_economic_shock, "Simulated markets slide and supply chains stall as the crisis spreads."),
    "civil_unrest": (_simple("Unrest erupts in"), "Simulated protests grow as frustration with the response mounts."),
    "conflict_escalation": (_simple("Conflict escalates near"), "Simulated fighting widens. Neighboring countries raise their alert levels."),
    "ceasefire": (_simple("Ceasefire declared in"), "Simulated truce takes hold. Aid convoys prepare to move in."),
    "recovery": (_recovery, "Simulated rebuilding begins as services come back online."),
}
GENERIC_DEK = "Simulated event is developing. Details will follow as the simulation runs."


def _dek(event: Event, ctx: Context, lead: str, fallback: str) -> str:
    """Most useful figures first, then the event's own detail if it still fits."""
    figures = impact_sentence(event["type"], ctx.impacts, previous=ctx.previous, max_length=DEK_MAX)
    detail = lead or _payload_text(event, "description")
    if detail and not detail.endswith((".", "!", "?")):
        detail += "."
    parts = [part for part in (figures, detail) if part]
    while parts and len(" ".join(parts)) > DEK_MAX:
        parts.pop()
    return " ".join(parts) or fallback


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


def news_for_event(event: Event, context: Context | None = None) -> NewsItem | None:
    """Build one news item, or return None if the event has not been applied.

    Without a `context` the event is written on its own. `derive_news` passes
    one so that follow-up events read as follow-ups and figures that changed
    lead the dek.
    """
    _validate(event)
    if event["status"] != "applied":
        return None
    ctx = context or Context(read_impacts(event))
    build, fallback = TEMPLATES.get(event["type"], (_generic, GENERIC_DEK))
    copy = build(event, ctx)
    headline, lead = copy if isinstance(copy, tuple) else (copy, "")
    loc = event["location"]
    return {
        "id": f"news-{event['id']}",
        "event_id": event["id"],
        "event_type": event["type"],
        "severity": event.get("severity"),
        "label": SIMULATED_LABEL,
        "headline": headline,
        "dek": _dek(event, ctx, lead, fallback),
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
    applied = sorted(
        (e for e in events if e.get("status") == "applied"),
        key=lambda e: (e["sim_time_minutes"], e.get("sequence", 0), e["id"]),
    )
    items: list[NewsItem] = []
    seen: Counter = Counter()
    previous: Impacts | None = {}
    for event in applied:
        impacts = read_impacts(event)
        item = news_for_event(event, Context(impacts, previous, seen.copy()))
        if item is not None:
            items.append(item)
        _remember(seen, event)
        if impacts:
            previous = impacts
    items.reverse()
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
