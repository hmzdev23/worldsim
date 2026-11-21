"""Isolated scenario runs created from a prompt (SIM-004, #49).

A run is one user-created scenario. It has its own ID, Director batch,
`Simulation` (clock, timeline, playback), and set of stream subscribers.
Nothing is shared between runs or with the fixture demo the server was
started with.

Lifecycle: `generating` -> `ready` | `failed`. Generation calls the Director
in a worker thread, off the request and clock loop, with a timeout. A run
only becomes `ready` when every event in the batch is applied. A partial or
invalid batch fails the run, and retrying means creating a new run.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import secrets
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

from .engine import Message, Simulation

log = logging.getLogger("worldsim_sim")

ROOT = Path(__file__).resolve().parents[3]
BRANCH_ID = "main"
MAX_PROMPT_CHARS = 2000

# generator(prompt, *, fixture, simulation_id, branch_id, timeout_s) -> proposed batch.
# Raise an exception with a `code` attribute (worlddirector.DirectorError) to fail.
Generator = Callable[..., dict]

# DirectorError code -> (UI state, retryable, HTTP status, message). Mirrors
# worlddirector.public_error (#50), which is used instead when it is installed.
PUBLIC_ERRORS = {
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
FALLBACK_ERROR = ("unavailable", True, 500, "Something went wrong while preparing the scenario. Try again.")


def _import(package: str, service: str):
    try:
        return __import__(package)
    except ImportError:
        sys.path.insert(0, str(ROOT / "services" / service))
        return __import__(package)


def director_generator(prompt: str, *, fixture: str | None, simulation_id: str, branch_id: str, timeout_s: float) -> dict:
    """The real Director: `prepare_scenario` (#50) when present, else `generate`.

    With `fixture`, no model is called.
    """
    worlddirector = _import("worlddirector", "director")
    call = getattr(worlddirector, "prepare_scenario", None) or worlddirector.generate
    return call(prompt, fixture=fixture, simulation_id=simulation_id, branch_id=branch_id, timeout_s=timeout_s)


def public_error(code: str) -> dict[str, Any]:
    """UI-safe failure: {"error", "state", "retryable", "status", "message"}. Never the raw detail."""
    try:
        worlddirector = _import("worlddirector", "director")
    except ImportError:  # pragma: no cover - the Director ships in this repo
        worlddirector = None
    if worlddirector is not None and hasattr(worlddirector, "public_error"):
        return worlddirector.public_error(worlddirector.DirectorError(code, code))
    state, retryable, status, message = PUBLIC_ERRORS.get(code, FALLBACK_ERROR)
    return {"error": code, "state": state, "retryable": retryable, "status": status, "message": message}


def news_response(snapshot: Message) -> dict[str, Any]:
    """WORLD//WIRE for a run's released snapshot: `worldwire.news_response` (#51) when present."""
    worldwire = _import("worldwire", "newsroom")
    if hasattr(worldwire, "news_response"):
        return worldwire.news_response(snapshot)
    now = snapshot["sim_time_minutes"]
    events = [e for e in snapshot["events"] if e.get("status") == "applied" and e["sim_time_minutes"] <= now]
    return {
        "schema_version": snapshot["schema_version"],
        "simulation_id": snapshot["simulation_id"],
        "branch_id": snapshot["branch_id"],
        "sim_time_minutes": now,
        "items": worldwire.derive_news(events),
    }


class GenerationError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


class RegistryFull(Exception):
    """Too many runs are generating at once."""


@dataclass(eq=False)
class Channel:
    """One simulation plus the WebSocket clients that watch it."""

    sim: Simulation
    clients: set = field(default_factory=set)

    async def broadcast(self, messages: list[Message]) -> None:
        for ws in list(self.clients):
            try:
                for message in messages:
                    await ws.send_json(message)
            except Exception:  # client went away mid-send
                self.clients.discard(ws)

    async def close(self) -> None:
        for ws in list(self.clients):
            with contextlib.suppress(Exception):
                await ws.close(code=4410)
        self.clients.clear()


@dataclass(eq=False)
class Run:
    id: str
    prompt: str
    fixture: str | None
    status: str = "generating"
    title: str = ""
    channel: Channel | None = None
    error: dict[str, Any] | None = None
    start_minutes: int | None = None
    created: float = field(default_factory=time.monotonic)

    def to_json(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "id": self.id,
            "status": self.status,
            "title": self.title,
            "simulation_id": self.id,
            "branch_id": BRANCH_ID,
        }
        if self.channel is not None:
            sim = self.channel.sim
            out.update(
                start_minutes=self.start_minutes,
                end_minutes=sim.end_minutes,
                event_count=len(sim.timeline),
                sim_time_minutes=sim.now,
                playback=sim.playback,
            )
        if self.error is not None:
            out["error"] = self.error
        return out


def _title(prompt: str) -> str:
    text = " ".join(prompt.split())
    return text if len(text) <= 80 else text[:79].rstrip() + "…"


def simulation_for(run_id: str, batch: Any) -> Simulation:
    """A paused simulation holding every event of the batch, or GenerationError."""
    if not isinstance(batch, dict) or not isinstance(batch.get("events"), list) or not batch["events"]:
        raise GenerationError("invalid_events", "Director returned no events")
    sim = Simulation(simulation_id=run_id, branch_id=BRANCH_ID, state="paused")
    _, rejected = sim.ingest(batch)
    if rejected:
        details = "; ".join(f"{r.id}: {', '.join(r.reasons)}" for r in rejected)
        raise GenerationError("invalid_events", f"{len(rejected)} event(s) rejected: {details}")
    return sim


class ScenarioRegistry:
    """In-memory, process-local runs. Bounded in concurrent jobs and total runs."""

    def __init__(
        self,
        generator: Generator = director_generator,
        *,
        timeout_s: float = 180.0,
        max_generating: int = 2,
        max_runs: int = 16,
        fixture: str | None = None,
    ) -> None:
        self.generator = generator
        self.timeout_s = timeout_s
        self.grace_s = 5.0  # backstop beyond timeout_s if the generator ignores it
        self.max_generating = max_generating
        self.max_runs = max_runs
        self.fixture = fixture  # when set, every run uses this Director fixture (offline demo/E2E)
        self._runs: dict[str, Run] = {}
        self._tasks: set[asyncio.Task] = set()

    # ---- reads ----------------------------------------------------------

    def get(self, run_id: str) -> Run | None:
        return self._runs.get(run_id)

    def channels(self) -> list[Channel]:
        return [r.channel for r in self._runs.values() if r.channel is not None]

    # ---- lifecycle --------------------------------------------------------

    async def create(self, prompt: str, fixture: str | None = None) -> Run:
        if sum(r.status == "generating" for r in self._runs.values()) >= self.max_generating:
            raise RegistryFull("Another scenario is still being prepared. Try again shortly.")
        await self._evict()
        run_id = f"run-{secrets.token_hex(5)}"
        fixture = self.fixture or fixture
        run = Run(id=run_id, prompt=prompt, fixture=fixture, title=_title(prompt))
        self._runs[run_id] = run
        task = asyncio.create_task(self._generate(run))
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)
        return run

    async def _generate(self, run: Run) -> None:
        call = lambda: self.generator(  # noqa: E731
            run.prompt, fixture=run.fixture, simulation_id=run.id, branch_id=BRANCH_ID, timeout_s=self.timeout_s
        )
        try:
            # The Director enforces timeout_s itself. This is a backstop, and
            # the worker thread is abandoned rather than killed.
            batch = await asyncio.wait_for(asyncio.to_thread(call), self.timeout_s + self.grace_s)
            sim = simulation_for(run.id, batch)
        except Exception as exc:  # noqa: BLE001 - any failure fails the run, never the server
            self._fail(run, exc)
            return
        if run.id not in self._runs:  # evicted while generating
            return
        first = sim.timeline[0]["sim_time_minutes"]
        run.start_minutes = max(0, first - 1)
        sim.seek(run.start_minutes)
        run.channel = Channel(sim)
        run.status = "ready"

    def _fail(self, run: Run, exc: BaseException) -> None:
        if isinstance(exc, (asyncio.TimeoutError, TimeoutError)):
            code = "codex_timeout"
        else:
            code = getattr(exc, "code", None) or "internal_error"
        log.warning("scenario %s failed (%s): %r %s", run.id, code, exc, getattr(exc, "detail", ""))
        run.status = "failed"
        run.error = public_error(code)

    async def _evict(self) -> None:
        finished = sorted((r for r in self._runs.values() if r.status != "generating"), key=lambda r: r.created)
        while len(self._runs) >= self.max_runs and finished:
            run = finished.pop(0)
            del self._runs[run.id]
            if run.channel is not None:
                await run.channel.close()

    async def close(self) -> None:
        for task in list(self._tasks):
            task.cancel()
        for task in list(self._tasks):
            with contextlib.suppress(asyncio.CancelledError):
                await task
        for channel in self.channels():
            await channel.close()
