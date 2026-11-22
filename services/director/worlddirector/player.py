"""Player mode catalogue (prototype, not merged): scenario variables, roles and canned actions.

A player spec is an optional file per scenario, `fixtures/player/<fixture>.json`.
Scenarios without one (and every existing fixture and the Japan demo) are
unaffected. `generic.json` covers model-generated runs, which have no fixture.

A spec holds:
  variables  fixed premises, independent variables the player controls (name,
             options or range, default) and dependent outcomes the score reads
  triggers   rules that open a decision point (severity, new region, outbreak in
             a new place, event type), a minimum gap, and the bounded deferral
  roles      fictional decision-makers
  actions    high-level, fictional policy choices. Each says which roles may
             pick it, which trigger event types it answers ("*" for any), the
             one-line trade-off, the intervention event it becomes, and its
             canned effects on what happens next (the branch fixture)

Everything here is offline and deterministic. Free text from the player goes
through the same input checks as a scenario prompt (`check_free_text`).
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Optional

from .contract import EVENT_TYPES, VISUALS
from .director import FIXTURES_DIR, _clean_scenario
from .errors import DirectorError

PLAYER_DIR = FIXTURES_DIR / "player"
GENERIC = "generic"
FREE_TEXT_MAX = 280
OPTION_LIMIT = 3  # catalogue actions per card; "Do nothing" is always added
MEASURES = ("affected_countries", "peak_severity", "severity_load", "outbreak_places", "time_to_first_aid", "impact")
RULE_KINDS = ("severity", "new_region", "new_outbreak_place", "event_type")
EFFECT_KEYS = ("severity_scale", "impacts_scale", "drop", "shift", "consequences")

# Words that turn a policy choice into operational instructions. Free text is
# a decision for a fictional role, not a how-to, so these are refused.
_OPERATIONAL = re.compile(
    r"\b(how to (make|build|synthesi[sz]e|weaponi[sz]e)|step[- ]by[- ]step|recipe for|instructions for"
    r"|weaponi[sz]e|detonat\w* (a|the)|build a bomb)\b",
    re.IGNORECASE,
)


def _path(name: str) -> Path:
    if not re.fullmatch(r"[a-z0-9-]+", name or ""):
        raise DirectorError("invalid_request", f"Invalid player spec name {name!r}")
    return PLAYER_DIR / f"{name}.json"


def has_player_spec(fixture: Optional[str]) -> bool:
    return bool(fixture) and _path(fixture).is_file()


def load_player_spec(fixture: Optional[str]) -> dict:
    """The validated spec for a fixture run, or the generic spec for a model run (fixture None)."""
    name = fixture or GENERIC
    path = _path(name)
    if not path.is_file():
        raise DirectorError("fixture_missing", f"No player spec for {name!r}")
    spec = json.loads(path.read_text(encoding="utf-8"))
    validate_spec(spec)
    return spec


def list_player_specs() -> list[dict]:
    """Scenarios that can be played, with their roles, for the role picker."""
    out = []
    for path in sorted(PLAYER_DIR.glob("*.json")):
        if path.stem == GENERIC:
            continue
        spec = load_player_spec(path.stem)
        out.append({
            "fixture": spec["fixture"],
            "title": spec["title"],
            "summary": spec.get("summary", ""),
            "roles": [{"id": r["id"], "title": r["title"], "summary": r.get("summary", "")} for r in spec["roles"]],
        })
    return out


def validate_spec(spec: dict) -> None:
    """Check a spec's shape and that every action is usable. Raises DirectorError('invalid_spec')."""
    def bad(message: str):
        raise DirectorError("invalid_spec", f"{spec.get('fixture', '?')}: {message}")

    for key in ("fixture", "title", "label", "variables", "triggers", "roles", "actions"):
        if key not in spec:
            bad(f"missing {key}")
    variables = spec["variables"]
    names = set()
    for var in variables.get("independent", []):
        names.add(var["name"])
        if "options" in var:
            if var["default"] not in var["options"]:
                bad(f"default of {var['name']} is not one of its options")
        elif "range" in var:
            low, high = var["range"]
            if not low <= var["default"] <= high:
                bad(f"default of {var['name']} is outside its range")
        else:
            bad(f"independent variable {var['name']} needs options or a range")
    for var in variables.get("dependent", []):
        if var.get("measure") not in MEASURES:
            bad(f"dependent variable {var.get('name')} has unknown measure {var.get('measure')!r}")
        if var.get("better") not in ("lower", "higher") or not var.get("scale", 0) > 0 or not var.get("weight", 0) > 0:
            bad(f"dependent variable {var['name']} needs better, a positive scale and a positive weight")
        if var["measure"] == "impact" and not var.get("key"):
            bad(f"dependent variable {var['name']} needs an impacts key")
    triggers = spec["triggers"]
    for rule in triggers.get("rules", []):
        if rule.get("kind") not in RULE_KINDS:
            bad(f"unknown trigger kind {rule.get('kind')!r}")
    gap_ok = triggers.get("min_gap_minutes", 0) > 0 or 0 < triggers.get("min_gap_fraction", 0) < 1
    defer_ok = triggers.get("defer_minutes", 0) > 0 or 0 < triggers.get("defer_fraction", 0) < 1
    if not gap_ok or not defer_ok or triggers.get("max_deferrals") != 2:
        bad("triggers need a minimum gap, a deferral length and max_deferrals 2")
    roles = {role["id"] for role in spec["roles"]}
    ids = set()
    for action in spec["actions"]:
        aid = action.get("id", "")
        if not re.fullmatch(r"[a-z0-9_]+", aid) or aid in ids or aid in ("do_nothing", "decide_later"):
            bad(f"bad or duplicate action id {aid!r}")
        ids.add(aid)
        if not set(action.get("roles", [])) <= roles or not action.get("roles"):
            bad(f"action {aid} names unknown roles")
        for event_type in action.get("event_types", []):
            if event_type != "*" and event_type not in EVENT_TYPES:
                bad(f"action {aid} answers unknown event type {event_type}")
        intervention = action.get("intervention", {})
        if intervention.get("type") not in EVENT_TYPES:
            bad(f"action {aid} has no valid intervention type")
        if not action.get("label") or not action.get("tradeoff"):
            bad(f"action {aid} needs a label and a one-line trade-off")
        if not isinstance(action.get("cost"), (int, float)) or action["cost"] < 0:
            bad(f"action {aid} needs a non-negative cost")
        for key, value in action.get("sets", {}).items():
            if key not in names:
                bad(f"action {aid} sets unknown variable {key}")
        effects = action.get("effects", {})
        for key in effects:
            if key not in EFFECT_KEYS:
                bad(f"action {aid} has unknown effect {key}")
        for item in effects.get("consequences", []):
            if item.get("type") not in EVENT_TYPES or item.get("kind") not in ("benefit", "side_effect"):
                bad(f"action {aid} has a consequence with a bad type or kind")
            if not item.get("after_minutes", 0) > 0 or not item.get("description"):
                bad(f"action {aid} consequences need after_minutes > 0 and a description")


def action(spec: dict, action_id: str) -> dict:
    for item in spec["actions"]:
        if item["id"] == action_id:
            return item
    raise DirectorError("invalid_request", f"Unknown action {action_id!r}")


def options_for(spec: dict, role: str, event_type: str, limit: int = OPTION_LIMIT) -> list[dict]:
    """Catalogue actions a role can take on an event type: specific matches first, then general ones.

    The order is the catalogue's own, so the card is the same every time.
    """
    allowed = [a for a in spec["actions"] if role in a["roles"]]
    specific = [a for a in allowed if event_type in a.get("event_types", [])]
    general = [a for a in allowed if "*" in a.get("event_types", []) and a not in specific]
    return [{"id": a["id"], "label": a["label"], "tradeoff": a["tradeoff"]} for a in (specific + general)[:limit]]


def intervention_visual(event_type: str) -> str:
    return VISUALS[event_type]


def check_free_text(text: str) -> str:
    """The player's own decision, checked like a scenario prompt. Returns the cleaned text."""
    if not isinstance(text, str) or not text.strip():
        raise DirectorError("invalid_scenario", "Describe your decision in a few words.")
    if len(text.strip()) > FREE_TEXT_MAX:
        raise DirectorError("invalid_scenario", f"Keep your decision under {FREE_TEXT_MAX} characters.")
    cleaned = _clean_scenario(text)
    if _OPERATIONAL.search(cleaned):
        raise DirectorError("invalid_scenario", "Describe a high-level policy decision, not operational instructions.")
    return cleaned


def continue_with_decision(text: str, *, role_title: str, history: dict, simulation_id: str, branch_id: str,
                           timeout_s: float = 240, runner: Any = None) -> dict:
    """Model path for free text: predict what follows the player's decision from the run's history.

    Only used for model runs (no fixture). Raises DirectorError like `generate`.
    """
    from .director import generate  # local import keeps fixture-only use light

    cleaned = check_free_text(text)
    scenario = (f"Continue this fictional simulation. A fictional {role_title} has just made this high-level "
                f"policy decision: {cleaned}. Predict its plausible, clearly fictional consequences.")
    kwargs = {"runner": runner} if runner is not None else {}
    return generate(scenario, history=history, simulation_id=simulation_id, branch_id=branch_id,
                    timeout_s=timeout_s, **kwargs)
