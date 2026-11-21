"""Read and phrase `payload.impacts` snapshots for WORLD//WIRE.

Final DIR-003 (#26) shape, agreed in team thread #13:

    "impacts": {
      "basis": "fictional_estimate",      # required marker
      "deaths", "injuries", "missing", "displaced", "sheltered",
      "households_without_power", "households_without_water",
      "economic_loss_usd", "flooded_area_km2", "contaminated_area_km2", "debris_tonnes",
      "aid_contributors": [{"country", "personnel", "cargo_tonnes", "cargo"}]
    }

Values are scenario-wide estimates *as of the event that carries them*, never
deltas, so the newsroom reports the latest snapshot as given and never adds
snapshots together. Each aid contributor entry is that country's running
total. An omitted key means "no estimate yet"; a zero is not newsworthy and
is left out of copy. Every sentence built
here says the figures are simulated estimates.
"""

from __future__ import annotations

import math
from typing import Any

BASIS = "fictional_estimate"
COUNT_FIELDS = (
    "deaths",
    "injuries",
    "missing",
    "displaced",
    "sheltered",
    "households_without_power",
    "households_without_water",
)
MEASURE_FIELDS = ("economic_loss_usd", "flooded_area_km2", "contaminated_area_km2", "debris_tonnes")

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
    contributors = []
    entries = raw.get("aid_contributors")
    for entry in entries if isinstance(entries, list) else []:
        if not isinstance(entry, dict) or not text(entry.get("country")):
            continue
        clean: dict[str, Any] = {"country": text(entry["country"])}
        for key in ("personnel", "cargo_tonnes"):
            value = number(entry.get(key))
            if value is not None:
                clean[key] = value
        if text(entry.get("cargo")):
            clean["cargo"] = text(entry["cargo"])
        contributors.append(clean)
    if contributors:
        impacts["aid_contributors"] = contributors
    return impacts


def contributor(impacts: Impacts, country: str) -> dict[str, Any] | None:
    """The aid_contributors entry for `country` (case-insensitive), if any."""
    for entry in impacts.get("aid_contributors", []):
        if country and entry["country"].lower() == country.lower():
            return entry
    return None


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


def aid_amount(entry: dict[str, Any], joiner: str = " and ") -> str:
    """'500 personnel and 120 tonnes of aid', or '' when no quantities are given."""
    parts = []
    if "personnel" in entry:
        parts.append(f"{fmt_count(entry['personnel'])} personnel")
    if "cargo_tonnes" in entry:
        parts.append(f"{fmt_tonnes(entry['cargo_tonnes'])} of aid")
    return joiner.join(parts)


# Which figures matter for which kind of story.
CASUALTIES = (("deaths", "dead"), ("injuries", "injured"), ("missing", "missing"))
DISPLACEMENT = (("displaced", "displaced"), ("sheltered", "in shelters"))
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

GROUPS_BY_TYPE: dict[str, tuple[tuple[tuple[str, str], ...], ...]] = {
    "tsunami_warning": (DISPLACEMENT, CASUALTIES),
    "evacuation": (DISPLACEMENT,),
    "flooding": ((("flooded_area_km2", "flooded"),), CASUALTIES),
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
LEAD = "Simulated estimates so far: "


def _phrase(key: str, word: str, value: float) -> str:
    if key == "economic_loss_usd":
        return f"{fmt_usd(value)} {word}"
    if key in ("flooded_area_km2", "contaminated_area_km2"):
        return f"{fmt_count(value)} km² {word}"
    if key == "debris_tonnes":
        return f"{fmt_tonnes(value)} {word}"
    return f"{fmt_count(value)} {word}"


def impact_phrases(
    event_type: str,
    impacts: Impacts,
    previous: Impacts | None = None,
    skip: tuple[str, ...] = (),
) -> list[str]:
    """Figures relevant to this event type, most useful first.

    Zero values are left out. When `previous` (the scenario's last earlier
    snapshot) is given, only the figures this event changed are returned,
    unless it changed none of them.
    """
    keys = [
        (key, word)
        for group in GROUPS_BY_TYPE.get(event_type, DEFAULT_GROUPS)
        for key, word in group
        if impacts.get(key) and key not in skip
    ]
    if previous is not None:
        moved = [(key, word) for key, word in keys if previous.get(key) != impacts[key]]
        keys = moved or keys
    return [_phrase(key, word, impacts[key]) for key, word in keys]


def impact_sentence(
    event_type: str,
    impacts: Impacts,
    skip: tuple[str, ...] = (),
    previous: Impacts | None = None,
    max_length: int | None = None,
) -> str:
    """One labeled sentence of figures, or ''. Drops trailing figures to fit `max_length`."""
    phrases = impact_phrases(event_type, impacts, previous, skip)
    while phrases:
        sentence = LEAD + ", ".join(phrases) + "."
        if max_length is None or len(sentence) <= max_length or len(phrases) == 1:
            return sentence
        phrases.pop()
    return ""
