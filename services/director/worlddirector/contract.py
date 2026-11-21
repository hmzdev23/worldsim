"""Event vocabulary and the strict output schema the model must follow.

The event envelope mirrors the provisional 0.1 shape used by the newsroom
fixture (issue #1 has not landed a reviewed contract yet). The Director only
*proposes* events; the simulation decides which ones become "applied".
"""

from __future__ import annotations

SCHEMA_VERSION = "0.1-provisional"
MAX_EVENTS = 6
MAX_SCENARIO_CHARS = 2000
MAX_SIM_MINUTES = 30 * 24 * 60  # 30 simulated days

# Event type -> animation key. The model picks the type; the visual is derived
# here so the frontend never receives an animation key it doesn't know.
VISUALS: dict[str, str] = {
    "earthquake": "earthquake_shockwave",
    "aftershock": "earthquake_shockwave",
    "tsunami": "tsunami_wave",
    "infrastructure_failure": "power_grid_failure",
    "evacuation": "evacuation_flow",
    "government_response": "emergency_mobilization",
    "international_aid": "animated_transport_route",
    "public_health": "public_health_alert",
    "economic_impact": "market_shock",
    "recovery": "recovery_pulse",
}
EVENT_TYPES = tuple(VISUALS)


def _nullable_number(description: str) -> dict:
    return {"type": ["number", "null"], "description": description}


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
                        "description": "Minutes since simulation start (day 1 begins at 0).",
                    },
                    "location": {
                        "type": "object",
                        "properties": {
                            "name": {"type": "string"},
                            "country": {"type": "string"},
                            "lat": {"type": "number"},
                            "lon": {"type": "number"},
                        },
                        "required": ["name", "country", "lat", "lon"],
                        "additionalProperties": False,
                    },
                    "severity": {"type": "number", "description": "0.0 (minor) to 1.0 (extreme)."},
                    "description": {"type": "string"},
                    "magnitude": _nullable_number("Earthquake/aftershock magnitude, else null."),
                    "depth_km": _nullable_number("Earthquake/aftershock depth in km, else null."),
                    "origin_country": {
                        "type": ["string", "null"],
                        "description": "Sending country for international_aid, else null.",
                    },
                },
                "required": [
                    "type",
                    "sim_time_minutes",
                    "location",
                    "severity",
                    "description",
                    "magnitude",
                    "depth_km",
                    "origin_country",
                ],
                "additionalProperties": False,
            },
        }
    },
    "required": ["events"],
    "additionalProperties": False,
}
