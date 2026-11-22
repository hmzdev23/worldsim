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
    (type, place) and (type, country). `earlier` holds the earlier applied
    events by ID, for causal follow-ups (`parent_ids`). Copy for an event
    depends only on what came before it, so seeking or replaying never
    rewrites an earlier story.
    """

    impacts: Impacts
    previous: Impacts | None = None
    seen: Counter = field(default_factory=Counter)
    earlier: dict[str, Event] = field(default_factory=dict)

    def parents(self, event: Event) -> list[Event]:
        """Earlier applied events this one lists in `parent_ids`, oldest first."""
        ids = event.get("parent_ids") if isinstance(event.get("parent_ids"), list) else []
        return [self.earlier[i] for i in ids if i in self.earlier]

    def places(self, event_type: str, key: str = "", value: str = "") -> list[str]:
        """Distinct places of earlier `event_type` events (optionally with payload[key] == value)."""
        found: list[str] = []
        for other in self.earlier.values():
            if other["type"] != event_type or (key and _payload_text(other, key).lower() != value.lower()):
                continue
            place = _where(other)
            if place and place not in found:
                found.append(place)
        return found

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


def _where(event: Event) -> str:
    """The short place name: the location's name, else its country."""
    loc = event["location"]
    return loc.get("name") or loc.get("country") or ""


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
    if ctx.repeats(event):
        return _fit(event, lambda p: f"More outages hit {p}")
    return _fit(event, lambda p: f"{_severity_word(event)}infrastructure failure hits {p}")


def _government_response(event: Event, ctx: Context) -> str:
    actor = event["location"].get("country") or "Government"
    verb = "steps up" if ctx.repeats(event, "country") else "mobilizes"
    where = event["location"].get("name") or "affected areas"
    if where.lower() == actor.lower():  # not "Singapore mobilizes ... in Singapore"
        return _fit(event, lambda p: f"{actor} {verb} emergency response")
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
    verb = "New eruption near" if ctx.repeats(event) else "Volcano erupts near"
    return _fit(event, lambda p: f"{verb} {p}{scale}")


def _disease_outbreak(event: Event, ctx: Context) -> str:
    """First report, a new place, or growth in the same place.

    "Spreads to" is used only when the event lists an earlier outbreak as a
    parent, so the link comes from the scenario rather than being assumed.
    """
    pathogen = _payload_text(event, "pathogen") or "disease"
    if ctx.repeats(event):
        return _fit(event, lambda p: f"{pathogen} outbreak grows in {p}")
    if any(parent["type"] == "disease_outbreak" for parent in ctx.parents(event)):
        return _fit(event, lambda p: f"{pathogen} spreads to {p}")
    if ctx.places("disease_outbreak"):
        return _fit(event, lambda p: f"{pathogen} cases confirmed in {p}")
    return _fit(event, lambda p: f"{pathogen} outbreak reported in {p}")


def _outbreak_reach(event: Event, ctx: Context) -> str:
    """'Outbreaks now reported in 3 places.' once a pathogen reaches a new place, or ''."""
    if event["type"] != "disease_outbreak":
        return ""
    places = ctx.places("disease_outbreak", "pathogen", _payload_text(event, "pathogen"))
    if not places or _where(event) in places:
        return ""
    return f"Outbreaks now reported in {len(places) + 1} places."


def _military_strike(event: Event, ctx: Context) -> str:
    origin = _payload_text(event, "origin")
    again = ctx.repeats(event) > 0
    if origin and origin.lower() != "unknown":
        return _fit(event, lambda p: f"{origin} launches {'another ' if again else ''}strike on {p}")
    return _fit(event, lambda p: f"{'Another' if again else 'Military'} strike hits {p}")


def _cyber_attack(event: Event, ctx: Context) -> str:
    target = _payload_text(event, "target")
    kind = "New cyberattack" if ctx.repeats(event) else "Cyberattack"
    if target:
        return _fit(event, lambda p: f"{kind} hits {target} in {p}")
    return _fit(event, lambda p: f"{kind} disrupts systems in {p}")


def _other_hazard(event: Event, ctx: Context) -> str:
    label = _payload_text(event, "label")
    if label:
        return _fit(event, lambda p: f"{label} reported in {p}")
    return _fit(event, lambda p: f"Emergency declared in {p}")


def _simple(verb: str, again: str) -> Headline:
    """Headline that is `verb` followed by the place, or `again` for a repeat there."""
    return lambda event, ctx: _fit(event, lambda p: f"{again if ctx.repeats(event) else verb} {p}")


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
    "meteor_impact": (_simple("Meteor strikes", "Another meteor strikes"), "Simulated impact flattens the area around ground zero. Rescue teams are converging."),
    "extreme_weather": (_simple("Extreme weather batters", "Extreme weather returns to"), "Simulated storm brings flooding and high winds. Shelters are opening."),
    "flooding": (_flooding, "Simulated flooding cuts off roads and homes. Rescue boats are searching for stranded residents."),
    "disease_outbreak": (_disease_outbreak, "Simulated cases are rising. Health authorities are tracing contacts and urging precautions."),
    "military_strike": (_military_strike, "Simulated strike damages key sites. Civil defense sirens sound across the region."),
    "nuclear_detonation": (_simple("Nuclear detonation reported near", "Another detonation reported near"), "Simulated blast triggers emergency alerts. Residents downwind are told to shelter in place."),
    "cyber_attack": (_cyber_attack, "Simulated outage spreads across networks. Operators are working to restore service."),
    "alien_contact": (_simple("Unidentified craft reported over", "More unidentified craft over"), "Simulated sightings flood social media. Officials urge calm while they investigate."),
    "other_hazard": (_other_hazard, "Simulated emergency is developing. Authorities are assessing the situation."),
    "evacuation": (_evacuation, "Simulated evacuation routes fill as residents head for safer ground."),
    "contamination": (_contamination, "Simulated hazard zone is declared. Residents are told to avoid local water and produce."),
    "economic_shock": (_economic_shock, "Simulated markets slide and supply chains stall as the crisis spreads."),
    "civil_unrest": (_simple("Unrest erupts in", "Unrest spreads in"), "Simulated protests grow as frustration with the response mounts."),
    "conflict_escalation": (_simple("Conflict escalates near", "Fighting intensifies near"), "Simulated fighting widens. Neighboring countries raise their alert levels."),
    "ceasefire": (_simple("Ceasefire declared in", "Ceasefire renewed in"), "Simulated truce takes hold. Aid convoys prepare to move in."),
    "recovery": (_recovery, "Simulated rebuilding begins as services come back online."),
}
GENERIC_DEK = "Simulated event is developing. Details will follow as the simulation runs."


# How a follow-up names the earlier event that caused it ("Follows the eruption.").
CAUSE_NOUNS = {
    "earthquake": "earthquake", "aftershock": "aftershock", "tsunami_warning": "tsunami warning",
    "volcanic_eruption": "eruption", "meteor_impact": "meteor impact", "extreme_weather": "storm",
    "flooding": "flooding", "disease_outbreak": "outbreak", "military_strike": "strike",
    "nuclear_detonation": "detonation", "cyber_attack": "cyberattack", "alien_contact": "sightings",
    "infrastructure_failure": "outage", "contamination": "contamination", "economic_shock": "economic shock",
    "civil_unrest": "unrest", "conflict_escalation": "escalation", "evacuation": "evacuation",
}


def _cause(event: Event, ctx: Context) -> str:
    """'Follows the eruption in Reykjanes Peninsula.' when a parent is a different kind of event, or ''."""
    parents = [p for p in ctx.parents(event) if p["type"] != event["type"] and p["type"] in CAUSE_NOUNS]
    if not parents:
        return ""
    parent = parents[-1]
    place = _where(parent)
    if not place or place == _where(event):
        where = ""
    else:  # "off the coast of Miyagi" already reads as a place phrase
        where = f" {place}" if place[0].islower() else f" in {place}"
    return f"Follows the {CAUSE_NOUNS[parent['type']]}{where}."


def _sentence(text: str) -> str:
    return text + "." if text and not text.endswith((".", "!", "?")) else text


def _dek(event: Event, ctx: Context, lead: str, fallback: str) -> str:
    """Most useful figures first, then the event's own detail, then context, while each fits.

    The first part is always kept. Later parts are added in order and skipped
    when they would push the dek past DEK_MAX. Context is only what the run's
    own earlier events say: places an outbreak has reached, and which earlier
    event this one follows (`parent_ids`).
    """
    figures = impact_sentence(event["type"], ctx.impacts, previous=ctx.previous, max_length=DEK_MAX)
    detail = _sentence(lead or _payload_text(event, "description"))
    # Without figures or detail, the template's "Simulated…" line still leads.
    parts = [part for part in (figures, detail) if part] or [fallback]
    parts += [part for part in (_outbreak_reach(event, ctx), _cause(event, ctx)) if part]
    dek = parts[0]
    for part in parts[1:]:
        if len(dek) + 1 + len(part) <= DEK_MAX:
            dek += " " + part
    return dek


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
    earlier: dict[str, Event] = {}
    headlines: Counter = Counter()
    previous: Impacts | None = {}
    for event in applied:
        impacts = read_impacts(event)
        item = news_for_event(event, Context(impacts, previous, seen.copy(), dict(earlier)))
        if item is not None:
            item["headline"] = _distinct(item["headline"], headlines)
            items.append(item)
        _remember(seen, event)
        earlier[event["id"]] = event
        if impacts:
            previous = impacts
    items.reverse()
    return items


def _distinct(headline: str, used: Counter) -> str:
    """Keep every alert in a run distinct: a repeated headline gets "(update n)".

    Templates already reword most repeats ("Another…", "More…"), so this
    only catches what they can't tell apart, such as two same-minute events
    at one place. It depends only on earlier events, so a story keeps its
    headline after a seek or replay.
    """
    used[headline] += 1
    count = used[headline]
    if count == 1:
        return headline
    return f"{headline} (update {count})"


class WireFeed:
    """Live WORLD//WIRE state driven by stream messages (contracts/stream.schema.json).

    `event` messages add one applied event, `snapshot` messages (connect, seek,
    replay) replace everything, and `clock` messages carry no news. Events that
    are not applied are ignored, so rejected or proposed events never appear.

    A feed follows one run, identified by (`simulation_id`, `branch_id`). A
    snapshot from a different run starts over, and event messages from any
    other run are ignored, so two runs that reuse event IDs never mix.
    """

    def __init__(self) -> None:
        self._events: dict[str, Event] = {}
        self._run: tuple[Any, Any] | None = None

    @staticmethod
    def _run_of(message: dict[str, Any]) -> tuple[Any, Any]:
        return message.get("simulation_id"), message.get("branch_id")

    def apply(self, message: dict[str, Any]) -> bool:
        """Apply one message. Returns True when the visible feed may have changed."""
        kind = message.get("kind")
        if kind == "snapshot":
            self._run = self._run_of(message)
            self._events = {e["id"]: e for e in message.get("events", []) if e.get("status") == "applied"}
            return True
        if kind == "event":
            if self._run is None:
                self._run = self._run_of(message)
            elif self._run_of(message) != self._run:
                return False
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
