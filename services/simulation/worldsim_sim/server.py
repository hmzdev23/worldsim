"""FastAPI server for the simulation stream (SIM-001 #4, SIM-004 #49).

Fixture demo (the simulation the server was started with):
  GET  /health     liveness
  GET  /snapshot   current snapshot message (same shape as the stream's)
  GET  /timeline   every applied event, including ones the clock has not reached
  POST /events     ingest a Director batch; returns it with statuses set
  POST /control    playback control (same body as a WebSocket control message)
  WS   /stream     snapshot on connect, then event and clock messages

Scenario runs created from a prompt, each fully isolated (see scenarios.py):
  POST /scenarios                 {"prompt": "..."} -> 202, run in `generating`
  GET  /scenarios/{id}            status: generating | ready | failed
  GET  /scenarios/{id}/snapshot   like /snapshot, for this run
  GET  /scenarios/{id}/timeline   like /timeline, for this run
  GET  /scenarios/{id}/news       WORLD//WIRE items for this run's released events
  POST /scenarios/{id}/control    like /control, for this run
  WS   /scenarios/{id}/stream     like /stream, for this run

Player mode (prototype, docs/plans/player-mode.md):
  GET  /player/scenarios                 playable fixtures and their roles
  POST /scenarios                        {"prompt", "fixture", "mode": "player", "role"}
  GET  /scenarios/{id}/player            the open decision card, decision log, variables
  POST /scenarios/{id}/decisions         {decision_id, option_id | free_text, at_minutes}
  POST /scenarios/{id}/decisions/{d}/branch   re-open decision d (voids it and later ones)
  GET  /scenarios/{id}/summary           score, decision timeline, baseline comparison

Each engine owns its state. A background task advances every simulation once
per tick and broadcasts the resulting messages to that simulation's clients.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import math
from typing import Any

from fastapi import Body, FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .engine import Message, Simulation
from .player import PlayerError
from .scenarios import MAX_PROMPT_CHARS, Channel, RegistryFull, Run, ScenarioRegistry, news_response

log = logging.getLogger("worldsim_sim")


def apply_control(sim: Simulation, control: Any) -> Message:
    """Apply one control message and return the message to broadcast.

    {"action": "play"} | {"action": "pause"} | {"action": "speed", "speed": 4}
    | {"action": "seek", "sim_time_minutes": 400} | {"action": "replay"}
    Raises ValueError for anything else.
    """
    if not isinstance(control, dict):
        raise ValueError("control must be a JSON object")
    action = control.get("action")
    if action == "play":
        return sim.play()
    if action == "pause":
        return sim.pause()
    if action == "speed":
        return sim.set_speed(control.get("speed"))
    if action == "seek":
        return sim.seek(control.get("sim_time_minutes"))
    if action == "replay":
        return sim.seek(0)
    raise ValueError("action must be play, pause, speed, seek, or replay")


def create_app(
    sim: Simulation,
    *,
    tick_seconds: float = 1.0,
    minutes_per_second: float = 1.0,
    cors_origins: tuple[str, ...] = ("http://localhost:3000", "http://127.0.0.1:3000"),
    scenarios: ScenarioRegistry | None = None,
) -> FastAPI:
    """Every `tick_seconds` the ticker advances each simulation by one tick.

    The demo `sim` keeps its own pacing; with a fixed rate (the default) one
    tick covers `minutes_per_second * tick_seconds` sim minutes at 1×. Scenario
    runs use the registry's relative pacing (5% of the run per tick). Speed
    multiplies either. A late tick counts as a fraction of a tick more.

    `scenarios` defaults to a registry that calls the real Director.
    """
    if not math.isfinite(tick_seconds) or tick_seconds <= 0:
        raise ValueError("tick_seconds must be a positive finite number")
    if not math.isfinite(minutes_per_second) or minutes_per_second <= 0:
        raise ValueError("minutes_per_second must be a positive finite number")
    if sim.pace is None:
        sim.minutes_per_tick = minutes_per_second * tick_seconds
    demo = Channel(sim)
    registry = scenarios if scenarios is not None else ScenarioRegistry()

    async def ticker() -> None:
        loop = asyncio.get_running_loop()
        last = loop.time()
        while True:
            await asyncio.sleep(tick_seconds)
            now = loop.time()
            ticks = (now - last) / tick_seconds
            last = now
            for channel in [demo, *registry.channels()]:
                player = channel.controller
                if player is not None:
                    player.arm()
                messages = channel.sim.tick(ticks)
                if player is not None:
                    messages += player.after_advance()
                await channel.broadcast(messages)

    @contextlib.asynccontextmanager
    async def lifespan(_: FastAPI):
        task = asyncio.create_task(ticker())
        try:
            yield
        finally:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task
            await registry.close()

    app = FastAPI(title="WORLD//SIM simulation", lifespan=lifespan)
    app.add_middleware(CORSMiddleware, allow_origins=list(cors_origins), allow_methods=["*"], allow_headers=["*"])
    app.state.sim = sim
    app.state.scenarios = registry

    def with_tick(body: dict[str, Any]) -> dict[str, Any]:
        if "pacing" in body:
            body["pacing"] = {**body["pacing"], "tick_seconds": tick_seconds}
        return body

    def player_control(channel: Channel, body: Any) -> list[Message]:
        """Apply a control, with player-mode rules first (seek voids, play waits). Raises PlayerError/ValueError."""
        if channel.controller is not None:
            messages = channel.controller.control(body)
            if messages is not None:
                return messages
        return [apply_control(channel.sim, body)]

    async def control(channel: Channel, body: Any) -> Any:
        try:
            messages = player_control(channel, body)
        except PlayerError as exc:
            return JSONResponse(status_code=exc.status, content=exc.to_json())
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        await channel.broadcast(messages)
        return messages[-1]

    async def serve(ws: WebSocket, channel: Channel) -> None:
        await ws.accept()
        await ws.send_json(channel.sim.snapshot())
        channel.clients.add(ws)
        try:
            while True:
                body = await ws.receive_json()
                try:
                    messages = player_control(channel, body)
                except (ValueError, PlayerError) as exc:
                    # The stream contract has no error message kind; log and ignore.
                    # Player seeks that void decisions go through POST .../control.
                    log.warning("ignored control %r: %s", body, exc)
                    continue
                await channel.broadcast(messages)
        except WebSocketDisconnect:
            pass
        finally:
            channel.clients.discard(ws)

    # ---- fixture demo ----------------------------------------------------

    @app.get("/health")
    async def health() -> dict[str, Any]:
        return {"ok": True, "simulation_id": sim.simulation_id, "branch_id": sim.branch_id}

    @app.get("/snapshot")
    async def snapshot() -> Message:
        return sim.snapshot()

    @app.get("/timeline")
    async def timeline() -> dict[str, Any]:
        return with_tick(sim.timeline_view())

    @app.post("/events")
    async def events(batch: dict[str, Any] = Body(...)) -> dict[str, Any]:
        processed, rejections = sim.ingest(batch)
        # Events due now (sim_time == clock) go out immediately, not next tick.
        await demo.broadcast(sim.advance(0))
        return {
            "batch": {**{k: batch.get(k) for k in ("schema_version", "simulation_id", "branch_id")}, "events": processed},
            "rejections": [r.to_json() for r in rejections],
        }

    @app.post("/control")
    async def demo_control(body: dict[str, Any] = Body(...)) -> Message:
        return await control(demo, body)

    @app.websocket("/stream")
    async def stream(ws: WebSocket) -> None:
        await serve(ws, demo)

    # ---- scenario runs ---------------------------------------------------

    def find(run_id: str) -> Run:
        run = registry.get(run_id)
        if run is None:
            raise HTTPException(status_code=404, detail=f"No scenario {run_id}")
        return run

    def ready(run_id: str) -> Channel:
        run = find(run_id)
        if run.channel is None:
            raise HTTPException(status_code=409, detail=f"Scenario {run_id} is {run.status}")
        return run.channel

    @app.post("/scenarios", status_code=202)
    async def create_scenario(body: dict[str, Any] = Body(...)) -> Any:
        prompt = body.get("prompt", "")
        fixture = body.get("fixture")
        mode = body.get("mode", "watch")
        role = body.get("role")
        if mode not in ("watch", "player"):
            raise HTTPException(status_code=422, detail="mode must be watch or player")
        if mode == "player" and not isinstance(role, str):
            raise HTTPException(status_code=422, detail="player mode needs a role")
        if not isinstance(prompt, str) or len(prompt) > MAX_PROMPT_CHARS:
            raise HTTPException(status_code=422, detail=f"prompt must be text of at most {MAX_PROMPT_CHARS} characters")
        if fixture is not None and not isinstance(fixture, str):
            raise HTTPException(status_code=422, detail="fixture must be a fixture name")
        if not prompt.strip():
            raise HTTPException(status_code=422, detail="Describe a scenario to simulate")
        try:
            run = await registry.create(prompt.strip(), fixture, mode=mode, role=role)
        except RegistryFull as exc:
            return JSONResponse(status_code=429, content={"detail": str(exc)})
        except PlayerError as exc:
            return JSONResponse(status_code=exc.status, content=exc.to_json())
        return with_tick(run.to_json())

    @app.get("/scenarios/{run_id}")
    async def scenario(run_id: str) -> dict[str, Any]:
        return with_tick(find(run_id).to_json())

    @app.get("/scenarios/{run_id}/snapshot")
    async def scenario_snapshot(run_id: str) -> Message:
        return ready(run_id).sim.snapshot()

    @app.get("/scenarios/{run_id}/timeline")
    async def scenario_timeline(run_id: str) -> dict[str, Any]:
        return with_tick(ready(run_id).sim.timeline_view())

    @app.get("/scenarios/{run_id}/news")
    async def scenario_news(run_id: str) -> dict[str, Any]:
        # Released events only (a snapshot), never the future.
        return news_response(ready(run_id).sim.snapshot())

    @app.post("/scenarios/{run_id}/control")
    async def scenario_control(run_id: str, body: dict[str, Any] = Body(...)) -> Message:
        return await control(ready(run_id), body)

    # ---- player mode (prototype) ------------------------------------------

    def session(run_id: str):
        channel = ready(run_id)
        if channel.controller is None:
            raise HTTPException(status_code=404, detail=f"Scenario {run_id} is not in player mode")
        return channel, channel.controller

    @app.get("/player/scenarios")
    async def player_scenarios() -> dict[str, Any]:
        return {"label": "SIMULATED", "scenarios": registry.catalogue.list()}

    @app.get("/scenarios/{run_id}/player")
    async def player_state(run_id: str) -> dict[str, Any]:
        return session(run_id)[1].state_json()

    @app.post("/scenarios/{run_id}/decisions")
    async def decide(run_id: str, body: dict[str, Any] = Body(...)) -> Any:
        channel, player = session(run_id)
        free_text = body.get("free_text")
        try:
            batch = None
            if player.needs_model(free_text):
                cleaned = registry.catalogue.check_free_text(free_text)
                batch = await asyncio.to_thread(player.model_batch, cleaned)
            messages = player.decide(body.get("decision_id"), option_id=body.get("option_id"), free_text=free_text,
                                     at_minutes=body.get("at_minutes"), model_batch=batch)
        except PlayerError as exc:
            return JSONResponse(status_code=exc.status, content=exc.to_json())
        except Exception as exc:  # noqa: BLE001 - Director failures on the model path
            code = getattr(exc, "code", None)
            if code is None:
                raise
            return JSONResponse(status_code=422 if code == "invalid_scenario" else 502, content={"detail": str(exc)})
        await channel.broadcast(messages)
        return player.state_json()

    @app.post("/scenarios/{run_id}/decisions/{decision_id}/branch")
    async def branch_from(run_id: str, decision_id: str) -> Any:
        channel, player = session(run_id)
        try:
            messages = player.branch_from(decision_id)
        except PlayerError as exc:
            return JSONResponse(status_code=exc.status, content=exc.to_json())
        await channel.broadcast(messages)
        return player.state_json()

    @app.get("/scenarios/{run_id}/summary")
    async def player_summary(run_id: str) -> dict[str, Any]:
        return session(run_id)[1].summary()

    @app.websocket("/scenarios/{run_id}/stream")
    async def scenario_stream(ws: WebSocket, run_id: str) -> None:
        run = registry.get(run_id)
        if run is None or run.channel is None:
            # 4404: unknown run; 4409: not ready yet (poll GET /scenarios/{id}).
            await ws.close(code=4404 if run is None else 4409)
            return
        await serve(ws, run.channel)

    return app
