"""Player mode (prototype): the player's decisions branch the run (design: docs/plans/player-mode.md).

A player session wraps one scenario run. The run starts as segment `main`, the
unchanged scenario. While it plays, the session watches for decision points:
an event that matches one of the spec's trigger rules, at least the minimum
gap after the previous point. The clock stops on that event's minute (an
engine breakpoint), and the point waits for the player:

  * an action from the catalogue: the run forks a new segment (branch `b1`,
    `b2`, ...) at that minute. The segment holds the past unchanged, the
    decision itself as an applied event (provenance "user"), and the future
    rewritten by the action's canned effects. Consequence events cite the
    decision as a parent (provenance "numeric"). The parent segment is never
    changed.
  * "Do nothing" (also the player's "skip"): logged, no fork.
  * free text: checked by the Director. Offline (fixture runs) it is logged
    but not simulated and scores as do nothing. On a model run it forks a
    segment from the Director's continuation.
  * "Decide later": playback resumes for `defer_minutes` of simulated time,
    at most twice. When the second deferral runs out, the point resolves to
    "do nothing" by itself.

Seeking back to before a decision voids it and every later one (the caller
must confirm), and the run returns to the segment that was active then.

Everything here is deterministic: the same fixture and decision log always
give the same segments and the same score.
"""

from __future__ import annotations

import copy
import math
from dataclasses import dataclass, field
from typing import Any, Callable

from .engine import SCHEMA_VERSION, Event, Message, Simulation, canonical_key

RESPONSE_TYPES = {"government_response", "international_aid", "recovery", "ceasefire"}
DO_NOTHING = "do_nothing"
DECIDE_LATER = "decide_later"
OFFLINE_NOTE = "Not simulated offline: your decision is recorded and scored as do nothing."


class PlayerError(Exception):
    """A refused player request. `status` is the HTTP status to answer with."""

    def __init__(self, status: int, message: str, **extra: Any) -> None:
        super().__init__(message)
        self.status = status
        self.extra = extra

    def to_json(self) -> dict[str, Any]:
        return {"detail": str(self), **self.extra}


def is_user(event: Event) -> bool:
    return (event.get("provenance") or {}).get("source") == "user"


def is_hazard(event: Event) -> bool:
    return not is_user(event) and event["type"] not in RESPONSE_TYPES


def place(event: Event) -> str:
    loc = event["location"]
    return loc.get("name") or loc.get("country") or "an unnamed place"


def format_minutes(minutes: float) -> str:
    """'3 days', '5 hours', '40 minutes': a duration in simulated time."""
    minutes = int(round(minutes))
    if minutes >= 2880 and minutes % 1440 == 0 or minutes >= 4320:
        days = round(minutes / 1440, 1)
        return f"{days:g} day{'s' if days != 1 else ''}"
    if minutes >= 120:
        hours = round(minutes / 60, 1)
        return f"{hours:g} hours"
    return f"{minutes} minute{'s' if minutes != 1 else ''}"


def sim_time_label(minutes: float) -> str:
    minutes = int(minutes)
    day, rest = divmod(minutes, 1440)
    return f"DAY {day + 1} · {rest // 60:02d}:{rest % 60:02d}"


# ---- outcomes (dependent variables) ------------------------------------------


def measure(spec: dict, timeline: list[Event]) -> dict[str, float | None]:
    """Dependent variables for a whole segment timeline, as the scenario would end."""
    hazards = [e for e in timeline if is_hazard(e)]
    first = timeline[0]["sim_time_minutes"] if timeline else 0
    end = timeline[-1]["sim_time_minutes"] if timeline else 0
    last_impacts: dict[str, Any] = {}
    for event in timeline:
        impacts = (event.get("payload") or {}).get("impacts")
        if isinstance(impacts, dict) and impacts.get("basis") == "fictional_estimate":
            last_impacts = impacts
    aid = [e["sim_time_minutes"] for e in timeline if e["type"] == "international_aid" and not is_user(e)]
    values: dict[str, float | None] = {}
    for var in spec["variables"]["dependent"]:
        kind = var["measure"]
        if kind == "affected_countries":
            values[var["name"]] = len({e["location"].get("country_code") for e in hazards})
        elif kind == "peak_severity":
            values[var["name"]] = round(max((e["severity"] for e in hazards), default=0.0), 3)
        elif kind == "severity_load":
            values[var["name"]] = round(sum(e["severity"] for e in hazards), 3)
        elif kind == "outbreak_places":
            values[var["name"]] = len({place(e) for e in hazards if e["type"] == "disease_outbreak"})
        elif kind == "time_to_first_aid":
            # No aid at all counts as the whole scenario plus a day.
            values[var["name"]] = (min(aid) - first) if aid else (end - first + 1440)
        elif kind == "impact":
            value = last_impacts.get(var["key"])
            values[var["name"]] = value if isinstance(value, (int, float)) and not isinstance(value, bool) else None
    return values


def relative_change(var: dict, value: float | None, baseline: float | None) -> float | None:
    """How much better `value` is than `baseline`, from -1 (much worse) to 1, against the variable's scale."""
    if value is None or baseline is None:
        return None
    gain = (baseline - value) if var["better"] == "lower" else (value - baseline)
    ratio = gain / max(abs(baseline), 1e-9) if baseline else (0.0 if gain == 0 else math.copysign(1.0, gain))
    return max(-1.0, min(1.0, ratio / var["scale"]))


def weighted_change(spec: dict, values: dict, baseline: dict) -> float:
    total = weights = 0.0
    for var in spec["variables"]["dependent"]:
        change = relative_change(var, values.get(var["name"]), baseline.get(var["name"]))
        if change is None:
            continue
        total += var["weight"] * change
        weights += var["weight"]
    return total / weights if weights else 0.0


# ---- branching: rewrite the future with an action's canned effects ----------


def apply_effects(future: list[Event], decision: Event, effects: dict, *, at: int, trigger: Event,
                  visuals: dict[str, str]) -> tuple[list[Event], dict[str, Any]]:
    """The parent's future after `decision`, rewritten by `effects`. Pure: inputs are not changed.

    Returns (events, report). Events keep valid causal order: dropped events'
    children inherit their parents, shifted events never move before a parent
    or before the decision, and every event gets a unique (minute, sequence).
    """
    events = [copy.deepcopy(e) for e in sorted(future, key=canonical_key)]
    report: dict[str, Any] = {"dropped": [], "shifted": [], "added": [], "scaled": {}}

    # 1. Drop the next N events of a type; their children inherit their parents.
    removed: dict[str, list[str]] = {}
    for rule in effects.get("drop", []):
        candidates = [e for e in events if e["type"] == rule["type"] and e["id"] not in removed]
        for event in candidates[: rule.get("count", 1)]:
            removed[event["id"]] = list(event["parent_ids"])
            report["dropped"].append({"id": event["id"], "type": event["type"], "place": place(event),
                                      "minute": event["sim_time_minutes"]})

    def resolve(ids: list[str]) -> list[str]:
        out: list[str] = []
        for pid in ids:
            for real in (resolve(removed[pid]) if pid in removed else [pid]):
                if real not in out:
                    out.append(real)
        return out

    events = [e for e in events if e["id"] not in removed]
    for event in events:
        event["parent_ids"] = resolve(event["parent_ids"])

    # 2. Scale severity and impact estimates (fictional, rounded).
    sev = effects.get("severity_scale", {})
    for event in events:
        factor = sev.get(event["type"], sev.get("*"))
        if factor is not None:
            event["severity"] = round(min(1.0, max(0.0, event["severity"] * factor)), 3)
    imp = effects.get("impacts_scale", {})
    if imp:
        report["scaled"] = dict(imp)
        for event in events:
            impacts = (event.get("payload") or {}).get("impacts")
            if not isinstance(impacts, dict):
                continue
            for key, factor in imp.items():
                value = impacts.get(key)
                if isinstance(value, (int, float)) and not isinstance(value, bool):
                    impacts[key] = int(round(value * factor)) if float(value).is_integer() else round(value * factor, 2)

    # 3. Consequences of the decision itself, located where the trigger happened.
    did = decision["payload"]["decision"]["id"]
    for index, item in enumerate(effects.get("consequences", []), start=1):
        event = {
            "id": f"evt-{did}-c{index}",
            "sim_time_minutes": at + int(item["after_minutes"]),
            "sequence": 0,
            "type": item["type"],
            "status": "applied",
            "location": copy.deepcopy(trigger["location"]),
            "severity": float(item.get("severity", 0.3)),
            "visual": visuals[item["type"]],
            "payload": {"description": item["description"], "decision_effect": item["kind"]},
            "parent_ids": [decision["id"]],
            "provenance": {"source": "numeric"},
        }
        events.append(event)
        report["added"].append({"id": event["id"], "type": item["type"], "kind": item["kind"],
                                "minute": event["sim_time_minutes"], "description": item["description"]})

    # 4. Shift event types in time, then re-time everything in causal order.
    shifts: dict[str, int] = {}
    for rule in effects.get("shift", []):
        shifts[rule["type"]] = shifts.get(rule["type"], 0) + int(rule["minutes"])
    order = {e["id"]: i for i, e in enumerate(sorted(events, key=canonical_key))}
    new_time: dict[str, int] = {decision["id"]: at}
    for event in sorted(events, key=canonical_key):  # parents always sort before children
        wanted = event["sim_time_minutes"] + shifts.get(event["type"], 0)
        floor = max([at + 1] + [new_time[p] for p in event["parent_ids"] if p in new_time])
        new_time[event["id"]] = max(wanted, floor)
        if new_time[event["id"]] != event["sim_time_minutes"] and event["type"] in shifts:
            report["shifted"].append({"id": event["id"], "type": event["type"], "place": place(event),
                                      "from": event["sim_time_minutes"], "to": new_time[event["id"]]})
        event["sim_time_minutes"] = new_time[event["id"]]
    events.sort(key=lambda e: (e["sim_time_minutes"], order[e["id"]]))
    sequence: dict[int, int] = {}
    for event in events:
        event["sequence"] = sequence.get(event["sim_time_minutes"], 0)
        sequence[event["sim_time_minutes"]] = event["sequence"] + 1
    return events, report


# ---- session ------------------------------------------------------------------


@dataclass
class Segment:
    branch_id: str
    sim: Simulation
    parent: str | None = None
    forked_at: int | None = None
    decision_id: str | None = None
    voided: bool = False


@dataclass
class DecisionPoint:
    id: str
    trigger_event_id: str
    trigger_minute: int
    trigger_type: str
    trigger_place: str
    rule: str
    rule_label: str
    situation: str
    headline: str
    options: list[dict]
    status: str = "pending"  # pending | resolved | voided
    deferrals: int = 0
    deadline: int | None = None
    choice: str | None = None  # action | do_nothing | free_text | auto
    option_id: str | None = None
    label: str | None = None
    free_text: str | None = None
    at_minutes: int | None = None
    simulated: bool = False
    branch_id: str | None = None
    parent_branch: str | None = None
    report: dict = field(default_factory=dict)

    def to_json(self) -> dict[str, Any]:
        out = {
            "id": self.id, "status": self.status,
            "trigger": {"event_id": self.trigger_event_id, "minute": self.trigger_minute,
                        "sim_time_label": sim_time_label(self.trigger_minute), "type": self.trigger_type,
                        "place": self.trigger_place, "rule": self.rule, "rule_label": self.rule_label,
                        "headline": self.headline},
            "deferrals": self.deferrals,
        }
        if self.status != "pending":
            out.update(choice=self.choice, option_id=self.option_id, label=self.label, free_text=self.free_text,
                       at_minutes=self.at_minutes, simulated=self.simulated, branch_id=self.branch_id,
                       delay_minutes=(self.at_minutes - self.trigger_minute) if self.at_minutes is not None else None,
                       effects=self.report)
        return out


Headline = Callable[[dict, str], str]  # (snapshot, event_id) -> WORLD//WIRE headline
Continuer = Callable[..., dict]  # Director continuation for free text on model runs


class PlayerSession:
    def __init__(self, *, run_id: str, spec: dict, role: str, sim: Simulation, catalogue: Any,
                 headline: Headline | None = None, continuer: Continuer | None = None, offline: bool = True,
                 on_switch: Callable[[Simulation], None] | None = None) -> None:
        roles = {r["id"]: r for r in spec["roles"]}
        if role not in roles:
            raise PlayerError(422, f"Unknown role {role!r}. Choose one of: {', '.join(roles)}")
        self.run_id = run_id
        self.spec = spec
        self.role = roles[role]
        self.catalogue = catalogue
        self.headline = headline or (lambda snapshot, event_id: "")
        self.continuer = continuer
        self.offline = offline
        self.on_switch = on_switch or (lambda sim: None)
        self.segments = [Segment("main", sim)]
        self.points: list[DecisionPoint] = []
        self._next_point = 1
        self._next_branch = 1
        triggers = spec["triggers"]
        span = max(1, sim.end_minutes - sim.start_minutes)
        self.min_gap = int(triggers.get("min_gap_minutes") or max(1, round(span * triggers["min_gap_fraction"])))
        self.defer_minutes = int(triggers.get("defer_minutes") or max(1, round(span * triggers["defer_fraction"])))
        self.max_deferrals = int(triggers["max_deferrals"])
        self.baseline = measure(spec, sim.timeline)  # the cached no-action outcome
        self.variables = {v["name"]: v["default"] for v in spec["variables"]["independent"]}

    # ---- state ----------------------------------------------------------

    @property
    def active(self) -> Segment:
        return [s for s in self.segments if not s.voided][-1]

    @property
    def sim(self) -> Simulation:
        return self.active.sim

    @property
    def pending(self) -> DecisionPoint | None:
        return next((p for p in self.points if p.status == "pending"), None)

    @property
    def live_points(self) -> list[DecisionPoint]:
        return [p for p in self.points if p.status != "voided"]

    @property
    def finished(self) -> bool:
        sim = self.sim
        return self.pending is None and sim.state == "paused" and sim.now >= sim.end_minutes

    # ---- triggers -------------------------------------------------------

    def _rule_for(self, event: Event, earlier: list[Event]) -> dict | None:
        if is_user(event):
            return None
        for rule in self.spec["triggers"]["rules"]:
            kind = rule["kind"]
            if kind == "severity" and is_hazard(event):
                if event["severity"] >= rule["at_least"]:
                    return rule
                # A mitigated critical event still deserves a policy review. Use
                # its unchanged baseline identity, never invent a new event or
                # show a future baseline result to the player.
                baseline = next((e for e in self.segments[0].sim._timeline if e["id"] == event["id"]), None)
                if (self.spec.get("presentation") and baseline is not None and
                        baseline["severity"] >= rule["at_least"]):
                    return {**rule, "label": "Response review: pressure reduced"}
            if kind == "new_region" and is_hazard(event):
                seen = {e["location"].get("country_code") for e in earlier if is_hazard(e)}
                if seen and event["location"].get("country_code") not in seen:
                    return rule
            if kind == "new_outbreak_place" and event["type"] == "disease_outbreak":
                seen = {place(e) for e in earlier if e["type"] == "disease_outbreak" and not is_user(e)}
                if seen and place(event) not in seen:
                    return rule
            if kind == "event_type" and event["type"] in rule["types"]:
                return rule
        return None

    def next_trigger(self) -> tuple[Event, dict] | None:
        """The next event after the clock that opens a decision point, honouring the minimum gap."""
        sim = self.sim
        last = max((p.trigger_minute for p in self.live_points), default=None)
        timeline = sim._timeline  # read-only use
        for index, event in enumerate(timeline):
            minute = event["sim_time_minutes"]
            if minute <= sim.now or (last is not None and minute < last + self.min_gap):
                continue
            rule = self._rule_for(event, timeline[:index])
            if rule is not None:
                return event, rule
        return None

    def arm(self) -> None:
        """Before each tick: stop the clock at the next trigger or deferral deadline."""
        sim = self.sim
        pending = self.pending
        if pending is not None:
            sim.stop_minute = pending.deadline if pending.deadline is not None and pending.deadline > sim.now else None
            return
        found = self.next_trigger()
        sim.stop_minute = found[0]["sim_time_minutes"] if found else None

    def after_advance(self) -> list[Message]:
        """After each tick: open a decision point, remind, or auto-resolve. Returns extra messages."""
        sim = self.sim
        pending = self.pending
        if not sim.halted:
            if pending is not None and sim.state == "paused" and sim.now >= sim.end_minutes:
                self._resolve(pending, "auto", label="Do nothing (no decision before the end)")
            return []
        sim.halted = False
        if pending is not None and pending.deadline is not None and sim.now >= pending.deadline:
            pending.deadline = None
            if pending.deferrals >= self.max_deferrals:
                self._resolve(pending, "auto", label="Do nothing (decision time ran out)")
                return [sim.play()]
            return []  # paused again: the card comes back
        found = self._trigger_at(sim.now)
        if found is None:  # the future changed since arm(); keep playing
            return [sim.play()]
        self._open(*found)
        return []

    def _trigger_at(self, minute: int) -> tuple[Event, dict] | None:
        timeline = self.sim._timeline
        for index, event in enumerate(timeline):
            if event["sim_time_minutes"] == minute:
                rule = self._rule_for(event, timeline[:index])
                if rule is not None:
                    return event, rule
        return None

    def _open(self, event: Event, rule: dict) -> DecisionPoint:
        snapshot = self.sim.snapshot()
        options = self.catalogue.options_for(self.spec, self.role["id"], event["type"])
        point = DecisionPoint(
            id=f"d{self._next_point}", trigger_event_id=event["id"], trigger_minute=event["sim_time_minutes"],
            trigger_type=event["type"], trigger_place=place(event), rule=rule["id"], rule_label=rule.get("label", rule["id"]),
            situation=self.situation(snapshot["events"], event), headline=self.headline(snapshot, event["id"]),
            options=options,
        )
        self._next_point += 1
        self.points.append(point)
        return point

    def situation(self, released: list[Event], trigger: Event) -> str:
        """A short summary built only from events the clock has reached."""
        hazards = [e for e in released if is_hazard(e)]
        countries = []
        for event in hazards:
            name = event["location"].get("country")
            if name and name not in countries:
                countries.append(name)
        count = len(released)
        parts = [f"So far ({sim_time_label(trigger['sim_time_minutes'])}): {count} event{'s' if count != 1 else ''} reported"]
        if countries:
            shown = ", ".join(countries[:3]) + (f" and {len(countries) - 3} more" if len(countries) > 3 else "")
            parts[0] += f" across {len(countries)} countr{'y' if len(countries) == 1 else 'ies'} ({shown})"
        sentences = [parts[0] + "."]
        if hazards:
            sentences.append(f"Highest severity so far: {round(max(e['severity'] for e in hazards) * 100)}%.")
        impacts = {}
        for event in released:
            value = (event.get("payload") or {}).get("impacts")
            if isinstance(value, dict) and value.get("basis") == "fictional_estimate":
                impacts = value
        figures = [f"{int(impacts[k]):,} {w}" for k, w in (("deaths", "dead"), ("displaced", "displaced"))
                   if isinstance(impacts.get(k), (int, float)) and impacts.get(k)]
        if figures:
            sentences.append("Simulated estimates: " + ", ".join(figures) + ".")
        return " ".join(sentences) + (" Your responsibility: " + self.role["responsibilities"] + "." if self.role.get("responsibilities") else "")

    # ---- decisions ------------------------------------------------------

    def decide(self, decision_id: str, *, option_id: str | None = None, free_text: str | None = None,
               at_minutes: int | None = None, model_batch: dict | None = None) -> list[Message]:
        """Apply the player's answer to the open decision point. Returns messages to broadcast."""
        sim = self.sim
        if isinstance(at_minutes, bool) or not isinstance(at_minutes, int):
            raise PlayerError(422, "at_minutes must be the current simulation minute (an integer)")
        if any(p.status == "resolved" and p.at_minutes == at_minutes for p in self.points):
            raise PlayerError(409, f"A decision was already made at minute {at_minutes}. Only one decision per minute.")
        point = next((p for p in self.points if p.id == decision_id), None)
        if point is None:
            raise PlayerError(404, f"No decision point {decision_id}")
        if point.status != "pending":
            raise PlayerError(409, f"Decision {decision_id} is already {point.status}")
        if at_minutes != sim.now:
            raise PlayerError(409, f"Decisions are made at the current minute ({sim.now}), not {at_minutes}")
        if (option_id is None) == (free_text is None):
            raise PlayerError(422, "Send exactly one of option_id or free_text")

        if option_id == DECIDE_LATER:
            if point.deferrals >= self.max_deferrals:
                raise PlayerError(409, "No deferrals left: choose an option or do nothing")
            point.deferrals += 1
            point.deadline = sim.now + self.defer_minutes
            return [sim.play()]
        if option_id == DO_NOTHING:
            self._resolve(point, "do_nothing", label="Do nothing")
            return [sim.play()]
        if free_text is not None:
            try:
                cleaned = self.catalogue.check_free_text(free_text)
            except Exception as exc:  # DirectorError with a user-facing message
                raise PlayerError(422, str(exc)) from None
            if self.offline or model_batch is None:
                self._resolve(point, "free_text", label="Your own decision (not simulated offline)", free_text=cleaned)
                return [sim.play()]
            return self._fork(point, None, free_text=cleaned, model_batch=model_batch)
        if option_id not in {o["id"] for o in point.options}:
            raise PlayerError(422, f"{option_id!r} is not one of this decision's options")
        return self._fork(point, self.catalogue.action(self.spec, option_id))

    def needs_model(self, free_text: str | None) -> bool:
        return free_text is not None and not self.offline and self.continuer is not None

    def model_batch(self, free_text: str, branch_id: str | None = None) -> dict:
        """Ask the Director what follows the player's free text (model runs only). Runs off the event loop."""
        sim = self.sim
        history = {"schema_version": SCHEMA_VERSION, "simulation_id": self.run_id, "branch_id": sim.branch_id,
                   "events": [e for e in sim.timeline if e["sim_time_minutes"] <= sim.now]}
        return self.continuer(free_text, role_title=self.role["title"], history=history, simulation_id=self.run_id,
                              branch_id=branch_id or f"b{self._next_branch}")

    def _resolve(self, point: DecisionPoint, choice: str, *, label: str, free_text: str | None = None) -> None:
        point.status, point.choice, point.label, point.free_text = "resolved", choice, label, free_text
        point.at_minutes = self.sim.now
        point.deadline = None
        point.simulated = False
        point.branch_id = self.active.branch_id

    def _decision_event(self, point: DecisionPoint, trigger: Event, label: str, event_type: str,
                        severity: float, option_id: str | None) -> Event:
        at = self.sim.now
        same_minute = [e["sequence"] for e in self.sim._timeline if e["sim_time_minutes"] == at]
        return {
            "id": f"evt-{point.id}",
            "sim_time_minutes": at,
            "sequence": max(same_minute, default=-1) + 1,
            "type": event_type,
            "status": "applied",
            "location": copy.deepcopy(trigger["location"]),
            "severity": severity,
            "visual": self.catalogue.intervention_visual(event_type),
            "payload": {
                "description": f"Simulated decision: the {self.role['title'].lower()} chose to "
                               f"{label[0].lower() + label[1:]}.",
                "decision": {"id": point.id, "option_id": option_id, "role": self.role["id"],
                             "role_title": self.role["title"], "label": label},
            },
            "parent_ids": [trigger["id"]],
            "provenance": {"source": "user"},
        }

    def _fork(self, point: DecisionPoint, action: dict | None, *, free_text: str | None = None,
              model_batch: dict | None = None) -> list[Message]:
        parent = self.active
        psim = parent.sim
        at = psim.now
        trigger = next(e for e in psim._timeline if e["id"] == point.trigger_event_id)
        branch_id = f"b{self._next_branch}"
        past = [copy.deepcopy(e) for e in psim._timeline if e["sim_time_minutes"] <= at]
        future = [e for e in psim._timeline if e["sim_time_minutes"] > at]
        if action is not None:
            label = action["label"]
            decision = self._decision_event(point, trigger, label, action["intervention"]["type"],
                                            float(action["intervention"].get("severity", 0.2)), action["id"])
            new_future, report = apply_effects(future, decision, action.get("effects", {}), at=at, trigger=trigger,
                                               visuals=self.catalogue.visuals())
        else:
            label = f"Your own decision: {free_text}"
            decision = self._decision_event(point, trigger, label[:80], "government_response", 0.2, None)
            new_future, report = self._model_future(model_batch, decision, at)
        batch = {"schema_version": SCHEMA_VERSION, "simulation_id": self.run_id, "branch_id": branch_id,
                 "events": past + [decision] + new_future}
        sim = Simulation(simulation_id=self.run_id, branch_id=branch_id, state="paused", pace=psim.pace,
                         minutes_per_tick=psim.minutes_per_tick, start_minutes=psim.start_minutes, speed=psim.speed)
        _, rejected = sim.ingest(batch)
        if rejected:  # a bug in the effects, never the player's fault
            details = "; ".join(f"{r.id}: {', '.join(r.reasons)}" for r in rejected)
            raise PlayerError(500, f"The branch for {point.id} did not validate: {details}")
        snapshot = sim.seek(at)
        self._next_branch += 1
        self.segments.append(Segment(branch_id, sim, parent=parent.branch_id, forked_at=at, decision_id=point.id))
        point.status, point.choice, point.option_id, point.label = "resolved", "action" if action else "free_text", \
            action["id"] if action else None, label
        point.free_text, point.at_minutes, point.simulated = free_text, at, True
        point.branch_id, point.parent_branch, point.report = branch_id, parent.branch_id, report
        if action is not None:
            self.variables.update(action.get("sets", {}))
        self.on_switch(sim)
        return [snapshot, sim.play()]

    def _model_future(self, batch: dict | None, decision: Event, at: int) -> tuple[list[Event], dict]:
        events = [copy.deepcopy(e) for e in (batch or {}).get("events", [])]
        if not events:
            raise PlayerError(502, "The Director returned no events for this decision")
        offset = max(0, at + 1 - min(e["sim_time_minutes"] for e in events))
        known = {decision["id"]}
        for event in sorted(events, key=canonical_key):
            event["sim_time_minutes"] += offset
            event["status"] = "proposed"
            if not any(p in known for p in event["parent_ids"]):
                event["parent_ids"] = [decision["id"], *event["parent_ids"]]
            known.add(event["id"])
        return events, {"added": [{"id": e["id"], "type": e["type"], "kind": "model", "minute": e["sim_time_minutes"],
                                   "description": (e.get("payload") or {}).get("description", "")} for e in events],
                        "dropped": [], "shifted": [], "scaled": {}}

    # ---- seek, void, branch from a decision -----------------------------

    def control(self, body: Any) -> list[Message] | None:
        """Player rules for playback controls. Returns messages, or None to apply the control normally."""
        if not isinstance(body, dict):
            return None
        action = body.get("action")
        pending = self.pending
        if action == "play" and pending is not None and pending.deadline is None:
            raise PlayerError(409, "A decision is waiting. Choose an option, do nothing, or decide later.")
        if action not in ("seek", "replay"):
            return None
        minute = 0 if action == "replay" else body.get("sim_time_minutes")
        if isinstance(minute, bool) or not isinstance(minute, int) or minute < 0:
            raise PlayerError(422, "sim_time_minutes must be a non-negative integer")
        later = self.later_than(minute)
        if later and body.get("void_decisions") is not True:
            raise PlayerError(409, "Seeking back voids later decisions. Confirm with void_decisions: true.",
                              voids=[p.id for p in later])
        self._void(later)
        sim = self.sim
        sim.pause()
        sim.stop_minute = None
        return [sim.seek(minute)]

    def later_than(self, minute: int) -> list[DecisionPoint]:
        return [p for p in self.live_points
                if (p.status == "resolved" and p.at_minutes > minute) or (p.status == "pending" and p.trigger_minute > minute)]

    def _void(self, points: list[DecisionPoint]) -> None:
        if not points:
            return
        ids = {p.id for p in points}
        for point in points:
            point.status = "voided"
        for segment in self.segments:
            if segment.decision_id in ids:
                segment.voided = True
        # Segments forked from a voided segment go too.
        voided = {s.branch_id for s in self.segments if s.voided}
        for segment in self.segments:
            if segment.parent in voided:
                segment.voided = True
                voided.add(segment.branch_id)
        self._recompute_variables()
        self.on_switch(self.sim)

    def _recompute_variables(self) -> None:
        self.variables = {v["name"]: v["default"] for v in self.spec["variables"]["independent"]}
        for point in self.live_points:
            if point.status == "resolved" and point.choice == "action":
                self.variables.update(self.catalogue.action(self.spec, point.option_id).get("sets", {}))

    def branch_from(self, decision_id: str) -> list[Message]:
        """Re-open a past decision: void it and everything after, return to its trigger, ask again."""
        point = next((p for p in self.live_points if p.id == decision_id and p.status == "resolved"), None)
        if point is None:
            raise PlayerError(404, f"No resolved decision {decision_id} to branch from")
        later = [p for p in self.live_points if p is point or (p.status == "resolved" and p.at_minutes > point.at_minutes)
                 or (p.status == "pending")]
        self._void(later)
        sim = self.sim
        sim.pause()
        sim.stop_minute = None
        snapshot = sim.seek(point.trigger_minute)
        trigger = next(e for e in sim._timeline if e["id"] == point.trigger_event_id)
        rule = next((r for r in self.spec["triggers"]["rules"] if r["id"] == point.rule), {"id": point.rule})
        self._open(trigger, rule)
        return [snapshot]

    # ---- views ----------------------------------------------------------

    def current_phase(self) -> dict[str, Any] | None:
        phases = self.spec.get("phases", [])
        reached = [(i, p) for i, p in enumerate(phases) if p["at_minutes"] <= self.sim.now]
        if not reached:
            return None
        index, phase = reached[-1]
        released = self.sim.snapshot()["events"]
        summary = (released[-1].get("payload") or {}).get("description", "") if released else ""
        return {**phase, "summary": summary, "index": index + 1, "total": len(phases)}

    def state_json(self) -> dict[str, Any]:
        sim = self.sim
        pending = self.pending
        out: dict[str, Any] = {
            "mode": "player",
            "label": self.spec.get("label", "SIMULATED"),
            "scenario": {"fixture": self.spec["fixture"], "title": self.spec["title"]},
            "role": dict(self.role),
            "phase": self.current_phase(),
            "branch_id": sim.branch_id,
            "sim_time_minutes": sim.now,
            "finished": self.finished,
            "pending": None,
            "decisions": [p.to_json() for p in self.points if p.status != "pending"],
            "variables": {"fixed": self.spec["variables"].get("fixed", {}), "independent": dict(self.variables)},
            "rules": {"min_gap_minutes": self.min_gap, "defer_minutes": self.defer_minutes,
                      "max_deferrals": self.max_deferrals},
        }
        if pending is not None:
            out["pending"] = {
                **pending.to_json(),
                "situation": pending.situation,
                "waiting": pending.deadline is None,
                "deadline_minutes": pending.deadline,
                "options": pending.options,
                "do_nothing": {"id": DO_NOTHING, "label": "Do nothing", "tradeoff": "Let events run their course."},
                "decide_later": {"id": DECIDE_LATER, "remaining": self.max_deferrals - pending.deferrals,
                                 "defer_minutes": self.defer_minutes,
                                 "defer_label": format_minutes(self.defer_minutes)},
                "free_text": {"max_chars": 280, "simulated": not self.offline and self.continuer is not None,
                              "note": OFFLINE_NOTE if self.offline or self.continuer is None else ""},
            }
        return out

    def summary(self) -> dict[str, Any]:
        from .scoring import summarise  # local import: scoring reads the session

        return summarise(self)
