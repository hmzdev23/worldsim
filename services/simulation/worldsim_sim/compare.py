"""Player mode: the Alternate Timeline comparison (prototype, docs/plans/player-mode.md).

Timeline A is the run's `main` segment: the unchanged scenario, the same events
the no-action baseline is measured on. Timeline B is the player's active
branch. Both come from the same session, so they share the same fixture, the
same starting clock and every event before the first decision; the only
differences are the ones the player's recorded decisions made through the
canned effects. Nothing here changes a segment: every timeline is read through
`Simulation.timeline`, which returns a copy.

Each difference is attributed to the decision(s) that made it by comparing each
decision's branch with the branch it forked from, so the attribution is exact
within the fictional model (not a causal claim about the real world).
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from .player import format_minutes, is_user, place, sim_time_label

if TYPE_CHECKING:  # pragma: no cover
    from .player import DecisionPoint, PlayerSession

NOTE = ("Both timelines start from the same fictional scenario and use the same simple rules. "
        "Differences come only from your recorded decisions. They are outputs of a game model, "
        "not forecasts or predictions about the real world.")


def _type_label(kind: str) -> str:
    return kind.replace("_", " ").capitalize()


def brief(event: dict) -> dict[str, Any]:
    """The few fields the comparison view needs for one event."""
    payload = event.get("payload") or {}
    return {
        "id": event["id"],
        "minute": event["sim_time_minutes"],
        "time_label": sim_time_label(event["sim_time_minutes"]),
        "type": event["type"],
        "type_label": _type_label(event["type"]),
        "place": place(event),
        "country": event["location"].get("country"),
        "severity": event["severity"],
        "description": payload.get("description", ""),
    }


def _changes(before: dict, after: dict) -> list[dict[str, Any]]:
    out = []
    if before["sim_time_minutes"] != after["sim_time_minutes"]:
        out.append({"kind": "moved", "from": before["sim_time_minutes"], "to": after["sim_time_minutes"]})
    if before["severity"] != after["severity"]:
        out.append({"kind": "severity", "from": before["severity"], "to": after["severity"]})
    return out


def attribute(session: "PlayerSession") -> dict[str, list[str]]:
    """event id -> the live decisions that changed, added or removed it.

    Each simulated decision's branch is compared with the branch it forked
    from; only the future after the fork can differ.
    """
    segments = {s.branch_id: s for s in session.segments}
    owners: dict[str, list[str]] = {}
    for point in session.live_points:
        if point.status != "resolved" or not point.simulated or not point.parent_branch:
            continue
        before = {e["id"]: e for e in segments[point.parent_branch].sim.timeline}
        after = {e["id"]: e for e in segments[point.branch_id].sim.timeline}
        touched = [i for i in before if i not in after]
        touched += [i for i in after if i not in before]
        touched += [i for i in before if i in after and _changes(before[i], after[i])]
        for event_id in touched:
            owners.setdefault(event_id, [])
            if point.id not in owners[event_id]:
                owners[event_id].append(point.id)
    return owners


def _note(status: str, changes: list[dict], consequence: str | None = None) -> str:
    if status == "same":
        return "Same as with no intervention."
    if status == "prevented":
        return "Did not happen in your timeline."
    if status in ("benefit", "side_effect"):
        return "Benefit of your decision." if status == "benefit" else "Side effect of your decision."
    if status == "added":
        return "Only in your timeline."
    parts = []
    for change in changes:
        if change["kind"] == "moved":
            delta = change["to"] - change["from"]
            parts.append(f"{format_minutes(abs(delta))} {'earlier' if delta < 0 else 'later'}")
        else:
            lower = change["to"] < change["from"]
            parts.append(f"{'less' if lower else 'more'} severe ({round(change['from'] * 100)}% → "
                         f"{round(change['to'] * 100)}%)")
    text = "; ".join(parts)
    return text[0].upper() + text[1:] + "."


def _effect_counts(rows: list[dict], decision_id: str) -> dict[str, int]:
    counts = {"prevented": 0, "moved": 0, "less_severe": 0, "more_severe": 0, "benefit": 0, "side_effect": 0}
    for row in rows:
        if decision_id not in row["decisions"] or row["kind"] == "decision":
            continue
        if row["status"] == "prevented":
            counts["prevented"] += 1
        elif row["status"] in ("benefit", "side_effect"):
            counts[row["status"]] += 1
        for change in row["changes"]:
            if change["kind"] == "moved":
                counts["moved"] += 1
            elif change["to"] < change["from"]:
                counts["less_severe"] += 1
            else:
                counts["more_severe"] += 1
    return counts


def _explain(label: str, counts: dict[str, int], verdict: str, simulated: bool, choice: str | None) -> str:
    if not simulated:
        if choice == "free_text":
            return "Recorded but not simulated offline, so both timelines stay the same here."
        if choice == "auto":
            return "Time ran out, so nothing changed here: this point counts as doing nothing."
        return "You let events run, so both timelines stay the same here."
    pieces = []
    words = {"prevented": ("event did not happen", "events did not happen"),
             "moved": ("event moved in time", "events moved in time"),
             "less_severe": ("later event was less severe", "later events were less severe"),
             "more_severe": ("later event was more severe", "later events were more severe"),
             "benefit": ("benefit was added", "benefits were added"),
             "side_effect": ("side effect was added", "side effects were added")}
    for key, (one, many) in words.items():
        if counts[key]:
            pieces.append(f"{counts[key]} {one if counts[key] == 1 else many}")
    effect = ", ".join(pieces) if pieces else "no later event changed"
    judged = {"helped": "On its own it improved the outcome measures",
              "hurt": "On its own it worsened the outcome measures",
              }.get(verdict, "On its own it made no clear difference to the outcome measures")
    return (f"In this fictional model, “{label}”: {effect}. {judged}, compared with the branch just "
            f"before it.")


def _decision_row(point: "DecisionPoint", verdict: str) -> dict[str, Any]:
    minute = point.at_minutes if point.at_minutes is not None else point.trigger_minute
    return {
        "kind": "decision", "id": f"decision-{point.id}", "decision_id": point.id, "status": "decision",
        "minute": minute, "a": None, "b": None, "changes": [], "decisions": [point.id],
        "note": point.label or "", "choice": point.choice, "simulated": point.simulated, "verdict": verdict,
    }


def compare(session: "PlayerSession", decision_rows: list[dict], metrics: list[dict]) -> dict[str, Any]:
    """Timeline A (no intervention) against timeline B (your branch), event by event."""
    spec = session.spec
    main = session.segments[0]
    base = main.sim.timeline
    mine = session.sim.timeline
    base_by_id = {e["id"]: e for e in base}
    mine_by_id = {e["id"]: e for e in mine}
    owners = attribute(session)
    verdicts = {r["id"]: r.get("verdict", "") for r in decision_rows}
    points = [p for p in session.live_points if p.status == "resolved"]

    rows: list[dict[str, Any]] = []
    order: dict[str, tuple] = {}
    for event in base:
        other = mine_by_id.get(event["id"])
        changes = _changes(event, other) if other else []
        status = "prevented" if other is None else "changed" if changes else "same"
        minute = min(event["sim_time_minutes"], other["sim_time_minutes"]) if other else event["sim_time_minutes"]
        rows.append({"kind": "event", "id": event["id"], "status": status, "minute": minute, "a": brief(event),
                     "b": brief(other) if other else None, "changes": changes,
                     "decisions": owners.get(event["id"], []), "note": _note(status, changes)})
        order[event["id"]] = (minute, 0, (other or event)["sequence"])
    for event in mine:
        if event["id"] in base_by_id or is_user(event):
            continue
        effect = (event.get("payload") or {}).get("decision_effect")
        status = effect if effect in ("benefit", "side_effect") else "added"
        rows.append({"kind": "event", "id": event["id"], "status": status, "minute": event["sim_time_minutes"],
                     "a": None, "b": brief(event), "changes": [], "decisions": owners.get(event["id"], []),
                     "note": _note(status, [])})
        order[event["id"]] = (event["sim_time_minutes"], 2, event["sequence"])
    for point in points:
        row = _decision_row(point, verdicts.get(point.id, ""))
        rows.append(row)
        order[row["id"]] = (row["minute"], 1, 0)
    rows.sort(key=lambda r: order[r["id"]])

    decisions = []
    for point in points:
        counts = _effect_counts(rows, point.id)
        decisions.append({
            "id": point.id, "minute": point.at_minutes, "time_label": sim_time_label(point.at_minutes or 0),
            "label": point.label, "choice": point.choice, "option_id": point.option_id,
            "simulated": point.simulated, "branch_id": point.branch_id, "verdict": verdicts.get(point.id, ""),
            "trigger": {"headline": point.headline, "place": point.trigger_place, "rule_label": point.rule_label,
                        "minute": point.trigger_minute},
            "effects": counts,
            "explanation": _explain(point.label or "", counts, verdicts.get(point.id, ""), point.simulated,
                                    point.choice),
        })

    # Identical starting conditions: everything up to the first fork matches exactly.
    forks = [p.at_minutes for p in points if p.simulated and p.at_minutes is not None]
    shared_until = min(forks) if forks else session.sim.end_minutes
    head_a = [e for e in base if e["sim_time_minutes"] <= shared_until]
    head_b = [e for e in mine if e["sim_time_minutes"] <= shared_until and not is_user(e)]
    identical = head_a == head_b

    independent = []
    for var in spec["variables"]["independent"]:
        independent.append({"name": var["name"], "label": var.get("label", var["name"]), "default": var["default"],
                            "final": session.variables.get(var["name"], var["default"])})

    better = sum(1 for m in metrics if m["verdict"] == "better")
    worse = sum(1 for m in metrics if m["verdict"] == "worse")
    if better or worse:
        headline = (f"Your decisions improved {better} of {len(metrics)} outcome measure{'s' if len(metrics) != 1 else ''}"
                    f"{f' and worsened {worse}' if worse else ''}, compared with no intervention.")
    else:
        headline = "Your timeline ended the same as the one with no intervention."

    return {
        "label": spec.get("label", "SIMULATED"),
        "note": NOTE,
        "headline": headline,
        "timelines": {
            "a": {"id": "a", "title": "Timeline A · No intervention", "branch_id": main.branch_id,
                  "events": len(base)},
            "b": {"id": "b", "title": "Timeline B · Your decisions", "branch_id": session.sim.branch_id,
                  "events": len([e for e in mine if not is_user(e)])},
        },
        "initial_conditions": {
            "scenario": spec["title"],
            "summary": spec.get("summary", ""),
            "role": session.role["title"],
            "start_minutes": main.sim.start_minutes,
            "start_label": sim_time_label(base[0]["sim_time_minutes"] if base else main.sim.start_minutes),
            "end_label": sim_time_label(main.sim.end_minutes),
            "fixed": spec["variables"].get("fixed", {}),
            "first_event": brief(base[0]) if base else None,
            "identical": identical,
            "shared_until_minutes": shared_until,
            "shared_until_label": sim_time_label(shared_until),
            "shared_events": len(head_a),
        },
        "settings": independent,
        "metrics": metrics,
        "decisions": decisions,
        "rows": rows,
    }
