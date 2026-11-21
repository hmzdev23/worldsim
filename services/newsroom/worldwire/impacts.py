"""Read and phrase `payload.impacts` snapshots for WORLD//WIRE.

Impact values are fictional, cumulative estimates *as of the event that
carries them* (never deltas). The newsroom therefore reports the latest value
it is given and never adds snapshots together. Every sentence built here says
it is a simulated estimate. Field names follow the proposal in issue #13 and
will track whatever DIR-003 (#26) publishes.
"""

from __future__ import annotations

import math
from typing import Any

COUNT_FIELDS = (
    "deaths",
    "injuries",
    "missing",
    "displaced",
    "sheltered",
    "households_without_power",
    "households_without_water",
)
MEASURE_FIELDS = ("economic_loss_usd", "flooded_area_km2", "debris_tonnes")

Impacts = dict[str, Any]


def _number(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    if not math.isfinite(value) or value < 0:
        return None
    return value


def read_impacts(event: dict[str, Any]) -> Impacts:
    """Return the event's valid impact fields. Malformed fields are dropped, not guessed."""
    raw = event.get("payload", {}).get("impacts")
    if not isinstance(raw, dict):
        return {}
    impacts: Impacts = {}
    for key in COUNT_FIELDS + MEASURE_FIELDS:
        value = _number(raw.get(key))
        if value is not None:
            impacts[key] = value
    contributors = []
    for entry in raw.get("aid_contributors") or []:
        if not isinstance(entry, dict):
            continue
        country = entry.get("country")
        if not isinstance(country, str) or not country.strip():
            continue
        clean = {"country": country.strip()}
        for key in ("personnel", "cargo_tonnes"):
            value = _number(entry.get(key))
            if value is not None:
                clean[key] = value
        cargo = entry.get("cargo")
        if isinstance(cargo, str) and cargo.strip():
            clean["cargo"] = cargo.strip()
        contributors.append(clean)
    if contributors:
        impacts["aid_contributors"] = contributors
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


def contributor(impacts: Impacts, country: str | None) -> dict[str, Any] | None:
    if not country:
        return None
    for entry in impacts.get("aid_contributors", []):
        if entry["country"].lower() == country.lower():
            return entry
    return None


def aid_amount(entry: dict[str, Any]) -> str:
    """'500 personnel and 120 tonnes of aid', or '' when no quantities are given."""
    parts = []
    if "personnel" in entry:
        parts.append(f"{fmt_count(entry['personnel'])} personnel")
    if "cargo_tonnes" in entry:
        parts.append(f"{fmt_tonnes(entry['cargo_tonnes'])} of aid")
    return " and ".join(parts)


# Which figures matter for which kind of story.
CASUALTIES = (("deaths", "dead"), ("injuries", "injured"), ("missing", "missing"))
DISPLACEMENT = (("displaced", "displaced"), ("sheltered", "in shelters"))
UTILITIES = (
    ("households_without_power", "households without power"),
    ("households_without_water", "households without water"),
)
ECONOMY = (("economic_loss_usd", "in economic losses"),)
ENVIRONMENT = (("flooded_area_km2", "flooded"), ("debris_tonnes", "of debris"))

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
    "international_aid": (),
}
DEFAULT_GROUPS = (CASUALTIES,)


def _phrase(key: str, word: str, value: float) -> str:
    if key == "economic_loss_usd":
        return f"{fmt_usd(value)} {word}"
    if key == "flooded_area_km2":
        return f"{fmt_count(value)} km² {word}"
    if key == "debris_tonnes":
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
