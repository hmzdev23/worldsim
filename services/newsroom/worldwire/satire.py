"""Satirical presentation layer for WORLD//WIRE (local experiment).

An optional layer on top of a run's applied events, in one of three tones:

* ``straight``  - the original experience: no satire at all.
* ``satirical`` - plausible events, absurd institutional reactions, deadpan copy.
* ``unhinged``  - the same, escalating as the run goes on.

Everything here is presentation. The event's facts, description and
``payload.impacts`` are never read for jokes about victims and never changed.
When the Director wrote a ``payload.satire`` block (same model call as the
events) it is used as is; otherwise deterministic templates keyed by event
type write the copy, so sample fixtures get satire without any model call.

Every author is invented and every item is labelled FICTIONAL. Output depends
only on the released events, in canonical order, so pause, seek, replay and
reset always show the satire for exactly the current moment.
"""

from __future__ import annotations

import hashlib
import re
from typing import Any, Iterable

from .live import SCHEMA_VERSION, released_events
from .wire import Event, derive_news, format_sim_time

TONES = ("straight", "satirical", "unhinged")
DEFAULT_TONE = "straight"
SATIRE_LABEL = "SATIRE · FICTIONAL"
POST_LABEL = "FICTIONAL"

# Invented entities only. None of these is (or imitates) a real organization or person.
ENTITIES: dict[str, tuple[str, str, str]] = {
    "airline": ("ThriftJet Air", "@ThriftJetAir", "airline"),
    "ministry": ("Ministry of Reassurance", "@MinistryOfReassurance", "government"),
    "dept": ("Dept. of Situational Awareness", "@DeptOfSituations", "government"),
    "committee": ("Committee for Global Stability (Interim)", "@StabilityCommittee", "committee"),
    "brand": ("Brandwell Inc.", "@BrandwellInc", "company"),
    "startup": ("Synergexa", "@Synergexa", "company"),
    "insurer": ("Shrug Mutual Insurance", "@ShrugMutual", "insurer"),
    "think_tank": ("Institute for Hindsight", "@HindsightInst", "think_tank"),
    "anchor": ("Desk Anchor Morgan Vale", "@AnchorMorganVale", "anchor"),
    "resident": ("A Local Resident", "@definitely_a_local", "resident"),
}

# (headline, dek) per event type and tone. Placeholders: {at} ("in Grindavik" or
# "off the coast of Miyagi"), {country}, {origin}, {label}.
HEADLINES: dict[str, dict[str, list[tuple[str, str]]]] = {
    "earthquake": {
        "satirical": [
            ("Earthquake {at} declared 'within acceptable tectonic parameters'",
             "The Ministry of Reassurance confirmed the ground has since stopped moving and thanked it for its cooperation."),
            ("Officials confirm earthquake {at} was 'not on the calendar'",
             "A spokesperson said the shaking had not been approved in advance. A review of the calendar is under way."),
        ],
        "unhinged": [
            ("Government files formal complaint against tectonic plate {at}",
             "The plate has been given 30 days to respond. Its lawyers are expected to plead subduction."),
        ],
    },
    "aftershock": {
        "satirical": [("Aftershock {at} ruled 'technically part of the original earthquake'",
                       "Officials say this means the earthquake is still covered by the earlier press release."),
                      ("Aftershock {at} described as 'a sequel nobody asked for'",
                       "Officials stress the original earthquake remains the definitive edition.")],
        "unhinged": [("Aftershock {at} announces it is 'just getting started'",
                      "Seismologists have asked it to stop giving interviews.")],
    },
    "tsunami_warning": {
        "satirical": [("Coastal authorities ask the ocean to 'stay where it is' {at}",
                       "Sirens sounded on schedule. A pamphlet titled 'The Sea: Know Your Limits' is being printed.")],
        "unhinged": [("Ministry issues cease-and-desist letter to the sea {at}",
                      "The sea has not acknowledged receipt. Lawyers describe its silence as 'tidal'.")],
    },
    "volcanic_eruption": {
        "satirical": [
            ("Volcano {at} promises to respect international aviation norms",
             "Officials express confidence the ash cloud will remain within its designated airspace. The volcano has declined to comment."),
            ("Volcano {at} erupts without filing the required paperwork",
             "Officials say permits for lava were 'never even requested'."),
        ],
        "unhinged": [("Volcano {at} appoints itself head of regional air traffic control",
                      "The ash cloud has issued its first notice to pilots. It just says 'no'.")],
    },
    "meteor_impact": {
        "satirical": [("Meteor lands {at}, well outside its designated landing zone",
                       "The Department of Situational Awareness says it will 'have a word'.")],
        "unhinged": [("Space rock {at} asked to show proof of residency",
                      "Immigration officials say the meteor 'arrived in an irregular manner'.")],
    },
    "extreme_weather": {
        "satirical": [("Forecasters {at} apologise for the weather, deny all involvement",
                       "A spokesperson said the forecast was 'right in spirit'."),
                      ("Weather {at} officially rated 'extremely weather'",
                       "Forecasters add that umbrellas remain 'technically an option'.")],
        "unhinged": [("Government announces it will no longer recognize the weather {at}",
                      "The weather continues regardless. Officials call this 'disrespectful'.")],
    },
    "flooding": {
        "satirical": [("Ministry {at} reminds floodwater that it requires a permit to be there",
                       "Floodwater has not applied. Enforcement options are being reviewed."),
                      ("Officials {at} confirm water is 'wetter than anticipated'",
                       "A task force has been asked to establish where all of it came from.")],
        "unhinged": [("Flooded district {at} rebranded as 'waterfront community'",
                      "Property listings went up within the hour. Snorkel not included.")],
    },
    "disease_outbreak": {
        "satirical": [("Outbreak confirmed {at}; officials 'deeply surprised' for the third time this month",
                       "A spokesperson said nobody could have predicted the thing everyone predicted."),
                      ("Health ministry {at} unveils new slogan: 'Have You Tried Not Coughing?'",
                       "The slogan tested well with a focus group of one minister."),
                      ("Health officials {at} urge the public to 'simply not catch it'",
                       "The official hand-washing infographic has been redesigned for the fourth time this week.")],
        "unhinged": [("Officials {at} declare the virus 'not welcome here', virus unbothered",
                      "A second, more strongly worded declaration is being drafted."),
                     ("Ministry announces outbreak {at} will be 'handled with a strongly worded memo'",
                      "Early drafts of the memo are reportedly also spreading.")],
    },
    "military_strike": {
        "satirical": [("Defence ministries {at} exchange strongly worded press releases",
                       "Analysts say the choice of font suggests further escalation.")],
        "unhinged": [("Both sides {at} claim victory in the war of the press releases",
                      "A third press release has been drafted to clarify the second.")],
    },
    "conflict_escalation": {
        "satirical": [("Diplomats {at} escalate to using bold text in official statements",
                       "Observers warn italics could follow within hours.")],
        "unhinged": [("Diplomats {at} escalate to ALL CAPS",
                      "The international community has urged both parties to 'lower their voices, typographically'.")],
    },
    "nuclear_detonation": {
        "satirical": [("International committee schedules emergency meeting to schedule an emergency meeting",
                       "Delegates agree the situation is serious and that lunch will be provided.")],
        "unhinged": [("Emergency summit postponed after delegates fail to agree on seating chart",
                      "A sub-summit on chairs has been convened. The situation remains fluid.")],
    },
    "cyber_attack": {
        "satirical": [("Officials {at} ask hackers to 'turn it off and on again'",
                       "IT has opened a ticket. Estimated response time: three to five business days.")],
        "unhinged": [("Government responds to cyberattack {at} by printing the internet",
                      "Copies are available at the ministry, Tuesdays only, by appointment.")],
    },
    "alien_contact": {
        "satirical": [("Visitors over {country} asked to fill out customs form in triplicate",
                       "Officials confirm the craft has no valid passport but describe it as 'very shiny'.")],
        "unhinged": [("Aliens over {country} placed on hold by the visa hotline",
                      "Estimated wait time: 400 years. Their call is important to us.")],
    },
    "other_hazard": {
        "satirical": [("{label} {at} added to official list of things that can happen",
                       "Officials say the list is 'comprehensive' and 'now slightly longer'.")],
        "unhinged": [("{label} {at} given its own ministry, mascot and theme song",
                      "The theme song is reportedly 'very catchy, unfortunately'.")],
    },
    "infrastructure_failure": {
        "satirical": [("Officials {at} assure residents the grid is 'mostly theoretical right now'",
                       "Engineers say the lights are 'resting'."),
                      ("Utility {at} confirms outage is 'a feature, not a bug'",
                       "Customers are reminded that darkness is extremely energy-efficient.")],
        "unhinged": [("Ministry {at} replaces failed network with a single very long extension cord",
                      "The cord is reportedly holding up 'about as well as the plan'."),
                     ("Power company {at} launches 'Darkness Premium' subscription",
                      "Subscribers get the same darkness, but with a monthly newsletter.")],
    },
    "government_response": {
        "satirical": [("Officials {at} launch emergency plan, mostly a font change",
                       "Critics say the new font is 'robust but unreadable'."),
                      ("Government {at} responds to crisis by announcing that it is responding",
                       "A spokesperson called the response 'robust, agile and ongoing'.")],
        "unhinged": [("Government {at} names a Minister for the Crisis, who names a Deputy Minister for the Crisis",
                      "The Deputy has already scheduled a crisis about staffing."),
                     ("Government {at} deploys task force to locate previous task force",
                      "The original task force was last seen at a press conference.")],
    },
    "international_aid": {
        "satirical": [("Aid from {origin} lands {at}; officials hold welcome ceremony for the boxes",
                       "The boxes were reportedly 'very well received'. Opening them is scheduled for later."),
                      ("Aid from {origin} arrives {at}, along with a 600-page customs form",
                       "Officials say the supplies will be released as soon as the correct stamp is located.")],
        "unhinged": [("Aid from {origin} lands {at}, followed by a film crew filming it landing",
                      "The documentary is expected before the supplies are unpacked."),
                     ("Aid from {origin} arrives {at}; committee forms to admire it",
                      "Unloading is scheduled to begin once the ribbon-cutting ceremony has been rehearsed.")],
    },
    "evacuation": {
        "satirical": [("Residents {at} evacuated in orderly queues, according to the brochure",
                       "Officials say the brochure is 'aspirational'."),
                      ("Evacuation {at} 'went smoothly', says official who was not there",
                       "Residents report the evacuation map was printed upside down 'for security reasons'.")],
        "unhinged": [("Evacuation {at} paused so officials can evacuate the evacuation plan",
                      "The plan is now safe. Officials are monitoring its condition.")],
    },
    "contamination": {
        "satirical": [("Contamination {at} officially downgraded to 'a vibe'",
                       "Residents are urged to avoid the vibe until further notice."),
                      ("Officials {at} reclassify contaminated zone as 'experiential'",
                       "Visitors are advised not to touch, eat or think about anything inside it.")],
        "unhinged": [("Contaminated zone {at} nominated for heritage status",
                      "Tour operators are offering guided walks of the fence.")],
    },
    "economic_shock": {
        "satirical": [("Economists {at} agree the economy is 'doing a thing'",
                       "Further analysis is expected to confirm it is doing it quite a lot."),
                      ("Markets react to crisis {at} by panicking, as is tradition",
                       "Economists predict things will improve, worsen or stay roughly the same.")],
        "unhinged": [("Stock market {at} closes early 'to have a little lie down'",
                      "Analysts describe the market's mood as 'beige, with notes of dread'.")],
    },
    "civil_unrest": {
        "satirical": [("Protesters {at} demand answers; officials offer a pamphlet instead",
                       "The pamphlet answers several questions nobody asked.")],
        "unhinged": [("Officials {at} respond to protests by protesting the protests",
                      "Both crowds agree the coffee situation is unacceptable.")],
    },
    "ceasefire": {
        "satirical": [("Ceasefire {at} holds while both sides argue over the shape of the table",
                       "A round table was rejected as 'too round'.")],
        "unhinged": [("Ceasefire {at} signed on a napkin, napkin now under armed guard",
                      "Historians are already arguing about the napkin.")],
    },
    "recovery": {
        "satirical": [("Officials {at} cut ribbon on recovery, then ask where the recovery is",
                       "The ribbon has been described as 'the most finished thing in town'."),
                      ("Recovery {at} declared 'basically finished' on day one of recovery",
                       "Crews on the ground described the announcement as 'brave'.")],
        "unhinged": [("Officials {at} unveil statue celebrating the recovery, which is ongoing",
                      "The statue is reportedly further along than the recovery.")],
    },
}
GENERIC = {
    "satirical": [("Something happens {at}; officials confirm they are aware of it",
                   "A spokesperson said the situation remains fluid.")],
    "unhinged": [("Officials {at} form committee to decide whether a committee is needed",
                  "Its first act was to rename itself. The situation remains fluid.")],
}
# Unhinged mode escalates: after the first few events these replace the dek.
ESCALATION = (
    "Committee count now stands at {n}. The situation remains fluid.",
    "A minister insisted everything is fine while standing in it.",
    "Officials have announced a press conference to announce more press conferences.",
    "The crisis has been assigned a mascot. The mascot has resigned.",
)

# Posts: (entity, text, tags). Placeholders as above plus {n} (event number in the run).
POSTS: dict[str, list[tuple[str, str, tuple[str, ...]]]] = {
    "volcanic_eruption": [("airline", "Our new VolcanoFlex™ fare lets you change your flight whenever the volcano changes its mind. Terms and conditions apply.", ("profiteer",))],
    "earthquake": [("ministry", "We can confirm the ground has been asked to remain still. The situation remains fluid.", ("fluid",))],
    "aftershock": [("anchor", "We're live from the aftershock, which my producer says is 'basically the earthquake, again'.", ())],
    "tsunami_warning": [("insurer", "Water damage is covered unless the water came from the sea, a river, the sky or a pipe. See clause 94(b).", ("profiteer",))],
    "flooding": [("brand", "Our new SplashGuard™ socks are perfect for wading through regional flooding. Limited time only.", ("profiteer",))],
    "infrastructure_failure": [("startup", "Introducing CandleBox™ Premium: the outage-ready subscription. Now three times the price.", ("profiteer",))],
    "government_response": [
        ("dept", "We are deploying a rapid response unit to assess whether a rapid response is needed. Press conference at 14:00.", ("press_conference",)),
        ("ministry", "Today's briefing has been moved to tomorrow so we can brief you on why it was moved.", ("press_conference",)),
    ],
    "international_aid": [
        ("committee", "We warmly welcome the aid from {origin} and have formed a working group to decide where to put it.", ("committee",)),
        ("anchor", "Aid from {origin} is here. Our reporter is standing next to a box. We'll stay with the box.", ()),
    ],
    "evacuation": [("airline", "ThriftJet now offers Evacuation Class: same seat, louder announcements. Bags extra.", ("profiteer",))],
    "contamination": [("dept", "The zone is safe to look at from a distance of approximately elsewhere. The situation remains fluid.", ("fluid",))],
    "economic_shock": [("startup", "Synergexa shares are up 4% after we announced we are 'monitoring the situation'.", ("profiteer",))],
    "disease_outbreak": [
        ("brand", "New ImmunoSip™ smoothie: does nothing, tastes like hope. Not medical advice.", ("profiteer",)),
        ("airline", "ThriftJet reminds passengers that our seats are 'basically a bubble' if you believe hard enough.", ()),
        ("ministry", "Our new guidance replaces last week's guidance, which replaced the guidance before that. The situation remains fluid.", ("fluid",)),
    ],
    "cyber_attack": [("startup", "Our servers are fine. Unrelatedly, our servers are down. We apologise for any inconvenience.", ("apology",))],
    "alien_contact": [("airline", "Intergalactic routes now available. Standard baggage fees apply to tentacles.", ("profiteer",))],
    "military_strike": [("committee", "The council has expressed concern. Deep concern is scheduled for next Tuesday.", ("committee",))],
    "conflict_escalation": [("anchor", "Our analyst says this is either an escalation or a de-escalation. More after the break.", ())],
    "nuclear_detonation": [("committee", "Emergency session convened. First item on the agenda: whether this is on the agenda.", ("committee",))],
    "civil_unrest": [("ministry", "We hear your concerns and have scheduled a listening session for next quarter.", ("press_conference",))],
    "ceasefire": [("committee", "The committee congratulates itself on the ceasefire, which it read about this morning.", ("committee",))],
    "recovery": [("brand", "We apologise for any inconvenience the crisis caused. The crisis was not us. Use code BACK20.", ("apology", "profiteer"))],
    "meteor_impact": [("insurer", "Reminder: our policies cover acts of God, but meteors are an act of Space. Please read the small print.", ("profiteer",))],
    "extreme_weather": [("think_tank", "Our new report concludes the storm was entirely predictable, now that it has happened.", ())],
    "other_hazard": [("think_tank", "We have published a 300-page report on {label}. Page one says 'hmm'.", ())],
}
GENERAL_POSTS: list[tuple[str, str, tuple[str, ...]]] = [
    ("committee", "We have established a subcommittee to determine whether this constitutes a precedent.", ("committee",)),
    ("ministry", "Press conference at 15:00 to announce the time of the next press conference. The situation remains fluid.", ("press_conference", "fluid")),
    ("brand", "Brandwell stands with {country} during these difficult times. Use code CRISIS10 for 10% off.", ("profiteer",)),
    ("resident", "My neighbour says it's fine. My neighbour has also left.", ()),
    ("anchor", "We are now live from the scene, which I'm told is somewhere behind me.", ()),
    ("think_tank", "Our experts confirm this is unprecedented, apart from the precedents.", ()),
    ("brand", "We apologise for our earlier post. Use code SORRY15 for 15% off.", ("apology", "profiteer")),
]
UNHINGED_POSTS: list[tuple[str, str, tuple[str, ...]]] = [
    ("committee", "The Subcommittee on Subcommittees has voted to create subcommittee #{n}.", ("committee",)),
    ("startup", "Introducing the Apocalypse Bundle™: three crises for the price of two.", ("profiteer",)),
    ("ministry", "The minister says things have never been better. Aides confirm the minister is standing on a desk. The situation remains fluid.", ("press_conference", "fluid")),
    ("insurer", "Shrug Mutual apologises for the crisis, which we did not cause, and for our premiums, which we did.", ("apology", "profiteer")),
    ("resident", "update: the committee knocked on my door to ask if I'd like to join a committee", ("committee",)),
]

# Tags are also detected in Director-written posts, so the absurdity index
# counts the same things whoever wrote the post.
_TAG_PATTERNS = {
    "committee": re.compile(r"\b(sub)?committees?\b|\btask ?force\b|\bworking group\b", re.I),
    "press_conference": re.compile(r"press (conference|briefing)|\bbriefing\b", re.I),
    "apology": re.compile(r"\bapologi[sz]e|\bsorry\b", re.I),
    "fluid": re.compile(r"remains? fluid", re.I),
    "profiteer": re.compile(r"™|\bpromo|\bdiscount|% off|\bcode [A-Z0-9]+|\bfare\b|\bsubscription\b|\bbundle\b|\bshares are up\b", re.I),
}

ABSURDITY_METRICS = (
    ("press_conferences", "Press conferences held"),
    ("committees", "Committees established"),
    ("apologies", "Corporate apologies issued"),
    ("fluid", "'The situation remains fluid'"),
    ("profiteers", "Companies spotting an opportunity"),
)


def check_tone(tone: str) -> str:
    if tone not in TONES:
        raise ValueError(f"tone must be one of {', '.join(TONES)}")
    return tone


def _country(name: str) -> str:
    """'the United States', 'the Philippines'; most country names take no article."""
    return f"the {name}" if name.startswith(("United ", "Republic ")) or name in ("Netherlands", "Philippines") else name


def _fields(event: Event, n: int) -> dict[str, str]:
    loc = event.get("location", {})
    name, country = loc.get("name") or "", loc.get("country") or "the region"
    if not name:
        at = f"in {country}"
    elif name[0].islower():  # "off the coast of Miyagi" already reads as a place phrase
        at = name
    else:
        at = f"in {name}"
    payload = event.get("payload", {})
    origin = payload.get("origin") if isinstance(payload.get("origin"), str) else ""
    label = payload.get("label") if isinstance(payload.get("label"), str) else ""
    return {
        "at": at,
        "country": country,
        "origin": _country(origin) if origin and origin.lower() != "unknown" else "abroad",
        "label": (label or "Unexplained phenomenon").capitalize(),
        "n": str(n),
    }


def _fill(template: str, fields: dict[str, str]) -> str:
    text = template.format(**fields)
    return text[0].upper() + text[1:] if text else text


def _tags(text: str, explicit: Iterable[str] = ()) -> list[str]:
    found = set(explicit) | {tag for tag, pattern in _TAG_PATTERNS.items() if pattern.search(text)}
    return [tag for tag, _ in _TAG_PATTERNS.items() if tag in found]


def _director_satire(event: Event) -> dict[str, Any] | None:
    satire = event.get("payload", {}).get("satire")
    return satire if isinstance(satire, dict) and isinstance(satire.get("headline"), str) else None


def _template_copy(event: Event, tone: str, n: int, used: dict[str, int], committees: int) -> tuple[str, str]:
    kind = event["type"]
    options = HEADLINES.get(kind, GENERIC).get(tone) or GENERIC[tone]
    # Rotate through a type's options so repeats in one run read differently.
    start = int(hashlib.sha256(f"{event['id']}|{kind}|{tone}".encode()).hexdigest()[:8], 16)
    headline, dek = options[(start + used.get(kind, 0)) % len(options)]
    fields = _fields(event, n)
    dek = _fill(dek, fields)
    if tone == "unhinged" and n > 3:  # escalate: each later event adds one more absurd line
        dek += " " + _fill(ESCALATION[(n - 4) % len(ESCALATION)], {**fields, "n": str(committees)})
    return _fill(headline, fields), dek


def _template_posts(event: Event, tone: str, n: int, repeat: int) -> list[tuple[str, str, tuple[str, ...]]]:
    """One type-specific post (rotating on repeats), one general, one escalating in unhinged mode.

    General posts step through the list (3 is coprime with its length), so a
    run never shows the same general post twice in a row.
    """
    specific = POSTS.get(event["type"], [])
    chosen = [specific[repeat % len(specific)]] if specific else []
    chosen.append(GENERAL_POSTS[(n * 3) % len(GENERAL_POSTS)])
    if tone == "unhinged":
        chosen.append(UNHINGED_POSTS[(n - 1) % len(UNHINGED_POSTS)])
    return chosen


def satire_for_events(events: Iterable[Event], tone: str) -> dict[str, list[dict[str, Any]]]:
    """Satirical wire items, fictional posts and absurdity metrics for applied events.

    Returns {"items": [...], "posts": [...], "absurdity": [...]}, items and
    posts newest first. Input events are never modified.
    """
    check_tone(tone)
    applied = sorted(
        (e for e in events if e.get("status") == "applied"),
        key=lambda e: (e["sim_time_minutes"], e.get("sequence", 0), e["id"]),
    )
    if tone == "straight" or not applied:
        return {"items": [], "posts": [], "absurdity": []}
    facts = {item["event_id"]: item for item in derive_news(applied)}
    items: list[dict[str, Any]] = []
    posts: list[dict[str, Any]] = []
    used: dict[str, int] = {}
    for n, event in enumerate(applied, start=1):
        director = _director_satire(event)
        if director:
            headline, dek = director["headline"], director.get("dek") or ""
            raw_posts = [(p.get("author", ""), p.get("handle", ""), p.get("kind", "other"), p.get("text", ""), ())
                         for p in director.get("posts") or [] if isinstance(p, dict)]
            source = "director"
        else:
            committees = sum("committee" in p["tags"] for p in posts)
            headline, dek = _template_copy(event, tone, n, used, committees)
            fields = _fields(event, n)
            raw_posts = [(*ENTITIES[key], _fill(text, fields), tags)
                         for key, text, tags in _template_posts(event, tone, n, used.get(event["type"], 0))]
            source = "template"
        used[event["type"]] = used.get(event["type"], 0) + 1
        loc = event["location"]
        stamp = {
            "event_id": event["id"],
            "sim_time_minutes": event["sim_time_minutes"],
            "sequence": event.get("sequence", 0),
            "sim_time_label": format_sim_time(event["sim_time_minutes"]),
            "provenance": source,
        }
        items.append({
            "id": f"satire-{event['id']}",
            "event_type": event["type"],
            "severity": event.get("severity"),
            "label": SATIRE_LABEL,
            "headline": headline,
            "dek": dek,
            "original_headline": facts[event["id"]]["headline"],
            "focus": {"event_id": event["id"], "lat": loc["lat"], "lon": loc["lon"], "zoom": 6.0},
            **stamp,
        })
        for j, (author, handle, kind, text, tags) in enumerate(raw_posts):
            posts.append({
                "id": f"post-{event['id']}-{j}",
                "author": author,
                "handle": handle,
                "kind": kind,
                "text": text,
                "label": POST_LABEL,
                "tags": _tags(text, tags),
                **stamp,
            })
    items.reverse()
    posts.sort(key=lambda p: (p["sim_time_minutes"], p["sequence"], p["id"]), reverse=True)
    return {"items": items, "posts": posts, "absurdity": absurdity(applied, posts)}


def absurdity(applied: list[Event], posts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Satirical counters derived from released events and posts only. Never from impacts."""
    def count(tag: str) -> int:
        return sum(tag in p["tags"] for p in posts)

    values = {
        "press_conferences": count("press_conference") + sum(e["type"] == "government_response" for e in applied),
        "committees": count("committee"),
        "apologies": count("apology"),
        "fluid": count("fluid"),
        "profiteers": len({p["handle"] for p in posts if "profiteer" in p["tags"]}),
    }
    return [{"key": key, "label": label, "value": values[key]} for key, label in ABSURDITY_METRICS]


def satire_response(snapshot: dict[str, Any], tone: str) -> dict[str, Any]:
    """The satire layer for one run at one moment (like `news_response`).

    Only applied events at or before the snapshot's `sim_time_minutes` count.
    """
    check_tone(tone)
    for key in ("simulation_id", "branch_id", "sim_time_minutes"):
        if key not in snapshot:
            raise ValueError(f"snapshot is missing {key!r}")
    now = snapshot["sim_time_minutes"]
    if isinstance(now, bool) or not isinstance(now, int) or now < 0:
        raise ValueError("sim_time_minutes must be a non-negative integer")
    layer = satire_for_events(released_events(snapshot.get("events", []), now), tone)
    return {
        "schema_version": snapshot.get("schema_version", SCHEMA_VERSION),
        "simulation_id": snapshot["simulation_id"],
        "branch_id": snapshot["branch_id"],
        "sim_time_minutes": now,
        "tone": tone,
        **layer,
    }
