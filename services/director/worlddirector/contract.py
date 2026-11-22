"""Event vocabulary (read from contracts/events.schema.json) and the strict
output schema the model must follow.

The Director only *proposes* events; the simulation decides which ones become
"applied". Batches follow contracts/events.schema.json v0.1.
"""

from __future__ import annotations

import json
from pathlib import Path

CONTRACTS_DIR = Path(__file__).resolve().parents[3] / "contracts"
_EVENTS_SCHEMA = json.loads((CONTRACTS_DIR / "events.schema.json").read_text(encoding="utf-8"))
_EVENT_DEF = _EVENTS_SCHEMA["$defs"]["event"]["properties"]

SCHEMA_VERSION: str = _EVENTS_SCHEMA["properties"]["schema_version"]["const"]
EVENT_TYPES: tuple = tuple(_EVENT_DEF["type"]["enum"])
CONTRACT_VISUALS: tuple = tuple(_EVENT_DEF["visual"]["enum"])
SLUG_PATTERN: str = _EVENTS_SCHEMA["$defs"]["slug"]["pattern"]
_SATIRE_DEF = _EVENTS_SCHEMA["$defs"]["satire"]["properties"]
_POST_DEF = _SATIRE_DEF["posts"]["items"]["properties"]
SATIRE_POST_KINDS: tuple = tuple(_POST_DEF["kind"]["enum"])
SATIRE_HANDLE_PATTERN: str = _POST_DEF["handle"]["pattern"]
SATIRE_LIMITS: dict = {
    "headline": _SATIRE_DEF["headline"]["maxLength"],
    "dek": _SATIRE_DEF["dek"]["maxLength"],
    "author": _POST_DEF["author"]["maxLength"],
    "text": _POST_DEF["text"]["maxLength"],
    "posts": _SATIRE_DEF["posts"]["maxItems"],
}
# Presentation tones. "straight" is the original serious experience: no satire.
TONES: tuple = ("straight", "satirical", "unhinged")
DEFAULT_TONE = "straight"

MAX_EVENTS = 12
MAX_HISTORY_EVENTS = 200  # prior events shown to the model when continuing
MAX_SCENARIO_CHARS = 2000
MAX_SIM_MINUTES = 365 * 24 * 60  # one simulated year (pandemics and wars run long)

# Event type -> map animation key. The model picks the type and the visual is
# derived here, so the map never receives an animation key it doesn't know.
VISUALS: dict = {
    # hazards
    "earthquake": "earthquake_shockwave",
    "aftershock": "earthquake_shockwave",
    "tsunami_warning": "weather_disaster",
    "volcanic_eruption": "ash_plume",
    "meteor_impact": "impact_blast",
    "extreme_weather": "weather_disaster",
    "flooding": "weather_disaster",
    "disease_outbreak": "contagion_spread",
    "military_strike": "missile_strike",
    "nuclear_detonation": "nuclear_blast",
    "cyber_attack": "cyber_pulse",
    "alien_contact": "alien_arrival",
    "other_hazard": "breaking_news",
    # consequences
    "infrastructure_failure": "power_grid_failure",
    "government_response": "emergency_mobilization",
    "international_aid": "animated_transport_route",
    "evacuation": "evacuation_flow",
    "contamination": "fallout_cloud",
    "economic_shock": "market_shock",
    "civil_unrest": "unrest_hotspot",
    "conflict_escalation": "missile_strike",
    "ceasefire": "recovery_pulse",
    "recovery": "recovery_pulse",
}
QUAKE_TYPES = ("earthquake", "aftershock")

_missing = set(EVENT_TYPES) - set(VISUALS)
_unknown = set(VISUALS.values()) - set(CONTRACT_VISUALS)
if _missing or _unknown:  # fail loudly if the shared contract changes under us
    raise RuntimeError(f"Director visuals out of sync with contract: missing={_missing} unknown={_unknown}")


# Optional payload fields the model may fill: name -> (JSON type, min, max, hint).
# None means "not applicable". Ranges mirror contracts/events.schema.json.
PAYLOAD_FIELDS: dict = {
    "magnitude": ("number", 0, 10, "Required for earthquake/aftershock."),
    "depth_km": ("number", 0, 800, "Required for earthquake/aftershock."),
    "vei": ("integer", 0, 8, "Volcanic explosivity index for volcanic_eruption."),
    "diameter_m": ("number", 0, 100000, "Meteor diameter in meters for meteor_impact."),
    "yield_kt": ("number", 0, 100000, "Nuclear yield in kilotons for nuclear_detonation."),
    "radius_km": ("number", 0, 20000, "Approximate affected radius, for map scale."),
    "origin": ("string", 1, 80, "Aid sender, attacking country, or 'unknown'."),
    "target": ("string", 1, 80, "What was hit, e.g. 'power grid' (cyber_attack, military_strike)."),
    "pathogen": ("string", 1, 80, "Pathogen name for disease_outbreak."),
    "label": ("string", 1, 80, "Short hazard name. Required for other_hazard."),
}

# Impact snapshot fields: scenario-wide totals as of the event (never deltas).
# name -> (JSON type, max, cumulative?). Cumulative values never decrease;
# the others are current levels (people still missing, households still dark).
IMPACT_FIELDS: dict = {
    "deaths": ("integer", 10**10, True),
    "injuries": ("integer", 10**10, True),
    "missing": ("integer", 10**10, False),
    "displaced": ("integer", 10**10, False),
    "sheltered": ("integer", 10**10, False),
    "households_without_power": ("integer", 10**10, False),
    "households_without_water": ("integer", 10**10, False),
    "economic_loss_usd": ("number", 10**15, True),
    "flooded_area_km2": ("number", 10**8, True),
    "contaminated_area_km2": ("number", 10**8, True),
    "debris_tonnes": ("number", 10**12, True),
}
# Per-country aid running totals inside impacts.aid_contributors.
CONTRIBUTOR_FIELDS: dict = {
    "personnel": ("integer", 10**8),
    "cargo_tonnes": ("number", 10**9),
}
IMPACT_BASIS = "fictional_estimate"
MAX_AID_COUNTRIES = 50
REQUIRED_PAYLOAD: dict = {
    "earthquake": ("magnitude", "depth_km"),
    "aftershock": ("magnitude", "depth_km"),
    "other_hazard": ("label",),
}


def _nullable(kind: str, description: str) -> dict:
    return {"anyOf": [{"type": kind}, {"type": "null"}], "description": description}


IMPACTS_SCHEMA: dict = {
    "type": "object",
    "description": (
        "Scenario-wide totals as of this event, never per-event increments. deaths, injuries, "
        "economic_loss_usd, flooded/contaminated area, debris and each aid contributor's totals never "
        "decrease; missing, displaced, sheltered and households without power/water are current levels. "
        "Null = no estimate."
    ),
    "properties": {
        **{k: _nullable(kind, "") for k, (kind, _, _) in IMPACT_FIELDS.items()},
        "aid_contributors": {
            "anyOf": [
                {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "country": {"type": "string"},
                            **{k: _nullable(kind, "") for k, (kind, _) in CONTRIBUTOR_FIELDS.items()},
                            "cargo": _nullable("string", "What this country has sent, e.g. 'medical teams'."),
                        },
                        "required": ["country", *CONTRIBUTOR_FIELDS, "cargo"],
                        "additionalProperties": False,
                    },
                },
                {"type": "null"},
            ],
            "description": "Every country that has sent aid so far, with its running totals.",
        },
    },
    "required": [*IMPACT_FIELDS, "aid_contributors"],
    "additionalProperties": False,
}


SATIRE_SCHEMA: dict = {
    "anyOf": [
        {
            "type": "object",
            "properties": {
                "headline": {"type": "string", "description": "Deadpan satirical headline, under 100 characters."},
                "dek": {"type": "string", "description": "One or two deadpan sentences."},
                "posts": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "author": {"type": "string", "description": "Invented organization or person."},
                            "handle": {"type": "string", "description": "Invented @handle, letters/digits/_ only."},
                            "kind": {"type": "string", "enum": list(SATIRE_POST_KINDS)},
                            "text": {"type": "string", "description": "Under 220 characters."},
                        },
                        "required": ["author", "handle", "kind", "text"],
                        "additionalProperties": False,
                    },
                },
            },
            "required": ["headline", "dek", "posts"],
            "additionalProperties": False,
        },
        {"type": "null"},
    ],
    "description": "Satirical presentation layer for this event, or null in the straight tone.",
}


# Strict structured-output schema: every property required, no extras.
OUTPUT_SCHEMA: dict = {
    "type": "object",
    "properties": {
        "events": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "type": {"type": "string", "enum": list(EVENT_TYPES)},
                    "sim_time_minutes": {
                        "type": "integer",
                        "description": "Minutes since simulation start (DAY 1 00:00 is 0).",
                    },
                    "location": {
                        "type": "object",
                        "properties": {
                            "name": {"type": "string"},
                            "country": {"type": "string"},
                            "country_code": {"type": "string", "description": "ISO 3166-1 alpha-3, e.g. JPN."},
                            "lat": {"type": "number"},
                            "lon": {"type": "number"},
                        },
                        "required": ["name", "country", "country_code", "lat", "lon"],
                        "additionalProperties": False,
                    },
                    "severity": {"type": "number", "description": "0.0 (minor) to 1.0 (extreme)."},
                    "description": {"type": "string"},
                    **{k: _nullable(kind, hint + " Otherwise null.") for k, (kind, _, _, hint) in PAYLOAD_FIELDS.items()},
                    "impacts": IMPACTS_SCHEMA,
                    "satire": SATIRE_SCHEMA,
                    "caused_by": {
                        "type": "array",
                        "items": {"type": "integer"},
                        "description": "0-based indexes of earlier events in this list that caused this one.",
                    },
                    "caused_by_events": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "IDs of events that already happened (from the history) that caused this one.",
                    },
                },
                "required": [
                    "type",
                    "sim_time_minutes",
                    "location",
                    "severity",
                    "description",
                    *PAYLOAD_FIELDS,
                    "impacts",
                    "satire",
                    "caused_by",
                    "caused_by_events",
                ],
                "additionalProperties": False,
            },
        }
    },
    "required": ["events"],
    "additionalProperties": False,
}
