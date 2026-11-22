"""Player mode score and end summary (prototype). Server-side, deterministic, no model.

  outcome     up to 60: the scenario's dependent variables at the end of the
              player's branch against the cached no-action baseline. Doing
              nothing scores 30; each variable's `scale` is the relative
              change that earns full credit.
  timeliness  up to 20: simulated minutes from each trigger to the response.
              Deferrals count. A point that ran out of time scores 0.
  balance     up to 20: minus each chosen action's side-effect cost, with
              repeats of the same action costing 1.5x, so always picking the
              strongest action does not win.

The same decision log on the same fixture always gives the same numbers.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from .player import format_minutes, measure, relative_change, sim_time_label, weighted_change

if TYPE_CHECKING:  # pragma: no cover
    from .player import PlayerSession

OUTCOME_MAX, TIMELINESS_MAX, BALANCE_MAX = 60.0, 20.0, 20.0
REPEAT_FACTOR = 1.5


def outcome_points(spec: dict, final: dict, baseline: dict) -> float:
    return round(OUTCOME_MAX / 2 + OUTCOME_MAX / 2 * weighted_change(spec, final, baseline), 1)


def timeliness_points(points: list, window: int) -> tuple[float, list[dict]]:
    rows = []
    for point in points:
        delay = point.at_minutes - point.trigger_minute
        share = 0.0 if point.choice == "auto" else max(0.0, 1.0 - delay / window) if window else 1.0
        rows.append({"id": point.id, "delay_minutes": delay, "share": round(share, 3)})
    if not rows:
        return TIMELINESS_MAX, rows
    return round(TIMELINESS_MAX * sum(r["share"] for r in rows) / len(rows), 1), rows


def balance_points(spec: dict, points: list, action: Any) -> tuple[float, list[dict]]:
    rows, seen, total = [], {}, 0.0
    for point in points:
        if point.choice != "action":
            continue
        cost = float(action(spec, point.option_id)["cost"])
        if seen.get(point.option_id):
            cost *= REPEAT_FACTOR
        seen[point.option_id] = seen.get(point.option_id, 0) + 1
        total += cost
        rows.append({"id": point.id, "option_id": point.option_id, "cost": round(cost, 1)})
    return round(max(0.0, BALANCE_MAX - total), 1), rows


def score(session: "PlayerSession") -> dict[str, Any]:
    spec = session.spec
    points = [p for p in session.live_points if p.status == "resolved"]
    final = measure(spec, session.sim.timeline)
    outcome = outcome_points(spec, final, session.baseline)
    window = session.defer_minutes * session.max_deferrals
    timeliness, timing_rows = timeliness_points(points, window)
    balance, cost_rows = balance_points(spec, points, session.catalogue.action)
    return {
        "total": round(outcome + timeliness + balance, 1),
        "max": OUTCOME_MAX + TIMELINESS_MAX + BALANCE_MAX,
        "components": [
            {"id": "outcome", "label": "Outcome", "points": outcome, "max": OUTCOME_MAX,
             "explanation": "How the end of your branch compares with doing nothing (30 = the same)."},
            {"id": "timeliness", "label": "Timeliness", "points": timeliness, "max": TIMELINESS_MAX,
             "explanation": f"Simulated time from each trigger to your response (full credit at once, none after "
                            f"{format_minutes(window)})."},
            {"id": "balance", "label": "Balance", "points": balance, "max": BALANCE_MAX,
             "explanation": "Side effects of your own actions; repeating the same action costs more."},
        ],
        "detail": {"timeliness": timing_rows, "costs": cost_rows},
        "final": final,
    }


def _fmt(var: dict, value: float | None) -> str:
    if value is None:
        return "no estimate"
    if var["measure"] == "time_to_first_aid":
        return format_minutes(value)
    if var["measure"] == "peak_severity":
        return f"{round(value * 100)}%"
    if var["measure"] == "severity_load":
        return f"{value:.2f}"
    if var.get("key") == "economic_loss_usd":
        return f"${value / 1e9:.2f} billion" if value >= 1e9 else f"${value / 1e6:.0f} million"
    return f"{int(round(value)):,}"


def baseline_rows(spec: dict, final: dict, baseline: dict) -> list[dict]:
    rows = []
    for var in spec["variables"]["dependent"]:
        change = relative_change(var, final.get(var["name"]), baseline.get(var["name"]))
        verdict = "no estimate" if change is None else "better" if change > 0 else "worse" if change < 0 else "same"
        rows.append({"name": var["name"], "label": var["label"], "baseline": baseline.get(var["name"]),
                     "final": final.get(var["name"]), "baseline_text": _fmt(var, baseline.get(var["name"])),
                     "final_text": _fmt(var, final.get(var["name"])), "verdict": verdict,
                     "difference_text": difference_text(var, final.get(var["name"]), baseline.get(var["name"]))})
    return rows


def difference_text(var: dict, value: float | None, baseline: float | None) -> str:
    """'1 fewer', '0.50 higher', '7 days earlier': your timeline against no intervention, in plain words."""
    if value is None or baseline is None:
        return "No estimate"
    delta = value - baseline
    if abs(delta) < 1e-9:
        return "No change"
    size = abs(delta)
    kind = var["measure"]
    if kind == "time_to_first_aid":
        return f"{format_minutes(size)} {'earlier' if delta < 0 else 'later'}"
    if kind == "peak_severity":
        return f"{round(size * 100)} points {'lower' if delta < 0 else 'higher'}"
    if kind == "severity_load":
        return f"{size:.2f} {'lower' if delta < 0 else 'higher'}"
    if var.get("key") == "economic_loss_usd":
        return f"{_fmt(var, size)} {'lower' if delta < 0 else 'higher'}"
    return f"{int(round(size)):,} {'fewer' if delta < 0 else 'more'}"


def component_reasons(session: "PlayerSession", result: dict, baseline: list[dict]) -> dict[str, str]:
    """One plain-language line per score component, from the same numbers the score used."""
    better = sum(1 for r in baseline if r["verdict"] == "better")
    worse = sum(1 for r in baseline if r["verdict"] == "worse")
    if better or worse:
        outcome = (f"{better} outcome measure{'s' if better != 1 else ''} better and {worse} worse than with no "
                   f"intervention. 30 means no difference.")
    else:
        outcome = "Your timeline ended the same as with no intervention, which scores 30 of 60."
    timing = result["detail"]["timeliness"]
    if timing:
        now = sum(1 for r in timing if r["share"] >= 1)
        lapsed = sum(1 for r in timing if r["share"] == 0)
        timeliness = f"You answered {now} of {len(timing)} decision point{'s' if len(timing) != 1 else ''} at once"
        timeliness += f"; {lapsed} got no credit for timing." if lapsed else "."
    else:
        timeliness = "No decision points were reached."
    costs = result["detail"]["costs"]
    if costs:
        labels = {a["id"]: a["label"] for a in session.spec["actions"]}
        spent = ", ".join(f"{labels.get(c['option_id'], c['option_id'])} −{c['cost']:g}" for c in costs)
        balance = f"Starts at 20. {spent}."
    else:
        balance = "You took no actions, so no side-effect costs were deducted."
    return {"outcome": outcome, "timeliness": timeliness, "balance": balance}


def _segment(session: "PlayerSession", branch_id: str):
    return next(s for s in session.segments if s.branch_id == branch_id)


def decision_rows(session: "PlayerSession") -> list[dict]:
    """Each live decision, what it caused, and whether it helped or hurt on its own."""
    spec = session.spec
    rows = []
    for point in session.live_points:
        if point.status != "resolved":
            continue
        row = point.to_json()
        if point.simulated and point.parent_branch:
            after = measure(spec, _segment(session, point.branch_id).sim.timeline)
            before = measure(spec, _segment(session, point.parent_branch).sim.timeline)
            change = weighted_change(spec, after, before)
            row["verdict"] = "helped" if change > 0.005 else "hurt" if change < -0.005 else "no clear change"
        else:
            row["verdict"] = "no change (not simulated)" if point.choice == "free_text" else "no change"
        caused = [f"{a['description']}" for a in point.report.get("added", [])]
        caused += [f"Prevented: {d['type'].replace('_', ' ')} in {d['place']}." for d in point.report.get("dropped", [])]
        caused += [f"{s['type'].replace('_', ' ').capitalize()} in {s['place']} moved from {sim_time_label(s['from'])} "
                   f"to {sim_time_label(s['to'])}." for s in point.report.get("shifted", [])]
        if point.report.get("scaled"):
            caused.append("Changed later fictional impact estimates.")
        row["caused"] = caused
        rows.append(row)
    return rows


def paragraph(session: "PlayerSession", rows: list[dict], baseline: list[dict], result: dict) -> str:
    """A templated, factual summary: only counts and values the run produced."""
    points = [p for p in session.live_points if p.status == "resolved"]
    acted = [p for p in points if p.choice == "action"]
    idle = [p for p in points if p.choice in ("do_nothing", "auto")]
    own = [p for p in points if p.choice == "free_text"]
    sentences = [f"As the {session.role['title'].lower()} (a fictional role), you faced {len(points)} decision "
                 f"point{'s' if len(points) != 1 else ''} and acted on {len(acted)}."]
    if idle:
        sentences.append(f"You let events run on {len(idle)} time{'s' if len(idle) != 1 else ''}.")
    if own:
        sentences.append(f"{len(own)} of your own decision{'s were' if len(own) != 1 else ' was'} recorded but not simulated.")
    changed = [r for r in baseline if r["verdict"] in ("better", "worse")]
    if changed:
        parts = [f"{r['label'][0].lower() + r['label'][1:]} went from {r['baseline_text']} to {r['final_text']}" for r in changed[:3]]
        sentences.append("Compared with doing nothing, " + "; ".join(parts) + ".")
    else:
        sentences.append("The end state matches the no-action baseline.")
    side = sum(1 for p in acted for a in p.report.get("added", []) if a["kind"] == "side_effect")
    if side:
        sentences.append(f"Your actions also caused {side} side effect{'s' if side != 1 else ''}.")
    sentences.append(f"Score: {result['total']:g} of {result['max']:g}. All figures are simulated estimates "
                     f"from a fictional scenario.")
    return " ".join(sentences)


def summarise(session: "PlayerSession") -> dict[str, Any]:
    result = score(session)
    rows = decision_rows(session)
    baseline = baseline_rows(session.spec, result["final"], session.baseline)
    reasons = component_reasons(session, result, baseline)
    for part in result["components"]:
        part["why"] = reasons[part["id"]]
    from .compare import compare  # local import: compare reads the session

    return {
        "finished": session.finished,
        "label": session.spec.get("label", "SIMULATED"),
        "role": {"id": session.role["id"], "title": session.role["title"]},
        "scenario": {"fixture": session.spec["fixture"], "title": session.spec["title"]},
        "score": {k: v for k, v in result.items() if k != "final"},
        "decisions": rows,
        "voided": [p.to_json() for p in session.points if p.status == "voided"],
        "baseline": baseline,
        "paragraph": paragraph(session, rows, baseline, result),
        "variables": {"independent": dict(session.variables)},
        "comparison": compare(session, rows, baseline),
    }
