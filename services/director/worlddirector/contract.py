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

MAX_EVENTS = 12
MAX_SCENARIO_CHARS = 2000
MAX_SIM_MINUTES = 30 * 24 * 60  # 30 simulated days

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
REQUIRED_PAYLOAD: dict = {
    "earthquake": ("magnitude", "depth_km"),
    "aftershock": ("magnitude", "depth_km"),
    "other_hazard": ("label",),
}


def _nullable(kind: str, description: str) -> dict:
    return {"anyOf": [{"type": kind}, {"type": "null"}], "description": description}


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
                    "caused_by": {
                        "type": "array",
                        "items": {"type": "integer"},
                        "description": "0-based indexes of earlier events in this list that caused this one.",
                    },
                },
                "required": [
                    "type",
                    "sim_time_minutes",
                    "location",
                    "severity",
                    "description",
                    *PAYLOAD_FIELDS,
                    "caused_by",
                ],
                "additionalProperties": False,
            },
        }
    },
    "required": ["events"],
    "additionalProperties": False,
}
