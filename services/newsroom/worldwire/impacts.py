"""Read and phrase `payload.impacts` snapshots for WORLD//WIRE.

Shape agreed for DIR-003 (#26) in team thread #13:

    "impacts": {
      "basis": "fictional_estimate",      # required marker
      "deaths", "injured", "missing", "displaced",
      "households_without_power", "households_without_water",
      "economic_loss_usd", "flooded_area_km2", "contaminated_area_km2", "debris_tonnes",
      "aid_countries": [...], "aid_personnel", "aid_cargo_tonnes"
    }

Values are scenario-wide estimates *as of the event that carries them*, never
deltas, so the newsroom reports the latest snapshot as given and never adds
snapshots together. An omitted key means "no estimate yet", not zero. Every
sentence built here says the figures are simulated estimates.
"""

from __future__ import annotations

import math
from typing import Any

BASIS = "fictional_estimate"
COUNT_FIELDS = (
    "deaths",
    "injured",
    "missing",
    "displaced",
    "households_without_power",
    "households_without_water",
    "aid_personnel",
)
MEASURE_FIELDS = (
    "economic_loss_usd",
    "flooded_area_km2",
    "contaminated_area_km2",
    "debris_tonnes",
    "aid_cargo_tonnes",
)

Impacts = dict[str, Any]


def number(value: Any) -> float | None:
    """A finite, non-negative number, or None."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    if not math.isfinite(value) or value < 0:
        return None
    return value


def text(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def read_impacts(event: dict[str, Any]) -> Impacts:
    """Return the event's valid impact fields.

    Snapshots without the `basis: "fictional_estimate"` marker are ignored, and
    malformed fields are dropped rather than guessed.
    """
    raw = event.get("payload", {}).get("impacts")
    if not isinstance(raw, dict) or raw.get("basis") != BASIS:
        return {}
    impacts: Impacts = {}
    for key in COUNT_FIELDS + MEASURE_FIELDS:
        value = number(raw.get(key))
        if value is not None:
            impacts[key] = value
    countries = raw.get("aid_countries")
    if isinstance(countries, list):
        names = [text(c) for c in countries if text(c)]
        if names:
            impacts["aid_countries"] = names
    return impacts


def fmt_count(value: float) -> str:
    """12400 -> '12,400'; 1800000 -> '1.8 million'."""
    if value >= 1_000_000_000:
        return f"{value / 1_000_000_000:.1f}".rstrip("0").rstrip(".") + " billion"
    if value >= 1_000_000:
        return f"{value / 1_000_000:.1f}".rstrip("0").rstrip(".") + " million"
    return f"{round(value):,}"


def fmt_usd(value: float) -> str:
    return "$" + fmt_count(value)


def fmt_tonnes(value: float) -> str:
    return f"{fmt_count(value)} tonne{'' if value == 1 else 's'}"


# Which figures matter for which kind of story.
CASUALTIES = (("deaths", "dead"), ("injured", "injured"), ("missing", "missing"))
DISPLACEMENT = (("displaced", "displaced"),)
UTILITIES = (
    ("households_without_power", "households without power"),
    ("households_without_water", "households without water"),
)
ECONOMY = (("economic_loss_usd", "in economic losses"),)
ENVIRONMENT = (
    ("contaminated_area_km2", "contaminated"),
    ("flooded_area_km2", "flooded"),
    ("debris_tonnes", "of debris"),
)
AID = (("aid_personnel", "aid personnel deployed"), ("aid_cargo_tonnes", "of relief cargo"))

GROUPS_BY_TYPE: dict[str, tuple[tuple[tuple[str, str], ...], ...]] = {
    "tsunami_warning": (DISPLACEMENT, CASUALTIES),
    "evacuation": (DISPLACEMENT,),
    "infrastructure_failure": (UTILITIES,),
    "cyber_attack": (UTILITIES,),
    "government_response": (CASUALTIES, DISPLACEMENT),
    "economic_shock": (ECONOMY,),
    "contamination": (ENVIRONMENT,),
    "recovery": (UTILITIES, DISPLACEMENT),
    "civil_unrest": (DISPLACEMENT,),
    "international_aid": (AID,),
}
DEFAULT_GROUPS = (CASUALTIES,)


def _phrase(key: str, word: str, value: float) -> str:
    if key == "economic_loss_usd":
        return f"{fmt_usd(value)} {word}"
    if key in ("flooded_area_km2", "contaminated_area_km2"):
        return f"{fmt_count(value)} km² {word}"
    if key in ("debris_tonnes", "aid_cargo_tonnes"):
        return f"{fmt_tonnes(value)} {word}"
    return f"{fmt_count(value)} {word}"


def impact_sentence(event_type: str, impacts: Impacts, skip: tuple[str, ...] = ()) -> str:
    """One labeled sentence of the figures relevant to this event type, or ''."""
    phrases = [
        _phrase(key, word, impacts[key])
        for group in GROUPS_BY_TYPE.get(event_type, DEFAULT_GROUPS)
        for key, word in group
        if key in impacts and key not in skip
    ]
    if not phrases:
        return ""
    return "Simulated estimates so far: " + ", ".join(phrases) + "."
