"""Prompt runner for the scenario service (DIR-005).

prepare_scenario() is the one call the simulation service makes when a
browser submits a prompt: prompt text + the run ID the service allocated ->
a complete, validated batch of proposed events, or a DirectorError. It never
returns a partial batch, so a failed call cannot start a partial run.

public_error() turns any DirectorError into a short, UI-safe state. Raw model
output, stderr and logs stay in err.detail on the server.
"""

from __future__ import annotations

import re
import subprocess
from typing import Optional

from .contract import SLUG_PATTERN
from .director import DEFAULT_EFFORT, DEFAULT_MODEL, DEFAULT_TIMEOUT_S, Runner, _clean_scenario, generate
from .errors import DirectorError
from .timing import Stages, stage

MIN_TIMEOUT_S = 5.0
MAX_TIMEOUT_S = 600.0

# Fixtures a service may request for deterministic, model-free runs.
# Japan continuation needs history, so it is not a standalone run.
RUN_FIXTURES = (
    "iceland-eruption", "global-pandemic", "japan-earthquake", "pacific-tsunami", "vesuvius-eruption",
    "nuclear-war", "zombie-outbreak", "alien-invasion", "sun-disappears", "insect-mutation", "ai-takeover",
)

# code -> (UI state, retryable, HTTP status, message shown to the user)
_PUBLIC = {
    "invalid_scenario": ("invalid_prompt", False, 422, "Describe a fictional scenario in 1 to 2000 characters."),
    "invalid_request": ("invalid_request", False, 400, "The scenario request was malformed."),
    "codex_timeout": ("timeout", True, 504, "The Director took too long to predict this scenario. Try again."),
    "invalid_json": ("invalid_output", True, 502, "The Director's prediction could not be read. Try again."),
    "invalid_events": (
        "invalid_output", True, 502,
        "The Director's prediction did not pass validation. Try again or rephrase the scenario.",
    ),
    "codex_failed": ("unavailable", True, 503, "The Director is unavailable right now. Try again shortly."),
    "codex_missing": ("unavailable", False, 503, "The Director is not set up on this server."),
    "fixture_missing": ("unavailable", False, 500, "The requested sample scenario is not available."),
}  # fmt: skip
_FALLBACK = ("unavailable", True, 500, "Something went wrong while preparing the scenario. Try again.")


def prepare_scenario(
    prompt: str,
    *,
    simulation_id: str,
    branch_id: str = "main",
    timeout_s: float = DEFAULT_TIMEOUT_S,
    fixture: Optional[str] = None,
    model: str = DEFAULT_MODEL,
    effort: str = DEFAULT_EFFORT,
    runner: Runner = subprocess.run,
    stages: Optional[Stages] = None,
) -> dict:
    """Predict a new, independent run and return its proposed event batch.

    simulation_id / branch_id: assigned by the caller and used verbatim.
    timeout_s: bound on the model call, clamped to [5, 600] seconds.
    fixture: replay a checked-in scenario instead of calling the model
             (one of RUN_FIXTURES); the prompt is still validated.
    stages: optional `timing.Stages` to record per-stage wall time and hear
            when each stage starts (prompt, model, parse, validate).
    Always starts from an empty history. Raises DirectorError on any failure.
    """
    for name, value in (("simulation_id", simulation_id), ("branch_id", branch_id)):
        if not isinstance(value, str) or not re.fullmatch(SLUG_PATTERN, value):
            raise DirectorError("invalid_request", f"{name} must match {SLUG_PATTERN}")
    if fixture is not None and fixture not in RUN_FIXTURES:
        raise DirectorError("fixture_missing", f"No run fixture {fixture!r}. Available: {', '.join(RUN_FIXTURES)}")
    if not isinstance(prompt, str) or not prompt.strip():
        raise DirectorError("invalid_scenario", "Scenario prompt is empty")
    try:
        timeout_s = min(MAX_TIMEOUT_S, max(MIN_TIMEOUT_S, float(timeout_s)))
    except (TypeError, ValueError):
        raise DirectorError("invalid_request", "timeout_s must be a number") from None

    if fixture is not None:
        with stage(stages, "prompt"):
            _clean_scenario(prompt)  # same prompt rules as a model run
    try:
        batch = generate(
            prompt,
            fixture=fixture,
            simulation_id=simulation_id,
            branch_id=branch_id,
            first_id=1,
            model=model,
            effort=effort,
            timeout_s=timeout_s,
            runner=runner,
            stages=stages,
        )
    except DirectorError:
        raise
    except Exception as exc:  # e.g. OSError launching codex: still a typed failure
        raise DirectorError("codex_failed", "The Director could not run", repr(exc)) from None

    events = batch.get("events") or []
    if (
        not events
        or batch.get("simulation_id") != simulation_id
        or batch.get("branch_id") != branch_id
        or any(e.get("status") != "proposed" for e in events)
    ):
        raise DirectorError("invalid_events", "The Director returned an incomplete batch")
    return batch


def public_error(err: BaseException) -> dict:
    """UI-safe view of a failure: {"error", "state", "retryable", "status", "message"}.

    Never includes err.detail (raw model output, stderr); log that server-side.
    """
    code = err.code if isinstance(err, DirectorError) else "internal_error"
    state, retryable, status, message = _PUBLIC.get(code, _FALLBACK)
    return {"error": code, "state": state, "retryable": retryable, "status": status, "message": message}
