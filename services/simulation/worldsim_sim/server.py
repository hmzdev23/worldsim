"""FastAPI server for the simulation stream (SIM-001 #4, SIM-004 #49).

Fixture demo (the simulation the server was started with):
  GET  /health     liveness
  GET  /snapshot   current snapshot message (same shape as the stream's)
  GET  /timeline   every applied event, including ones the clock has not reached
  POST /events     ingest a Director batch; returns it with statuses set
  POST /control    playback control (same body as a WebSocket control message)
  WS   /stream     snapshot on connect, then event and clock messages
  GET  /satire     satire layer (?tone=satirical|straight) for released events
  GET  /starters   starter scenarios (a prompt and an offline fixture each)

Scenario runs created from a prompt, each fully isolated (see scenarios.py):
  POST /scenarios                 {"prompt", "fixture"?, "tone"?} -> 202, run in `generating`.
                                  Every run gets a new random `seed`, so no two runs repeat.
  GET  /scenarios/{id}            status: generating | ready | failed
  GET  /scenarios/{id}/snapshot   like /snapshot, for this run
  GET  /scenarios/{id}/timeline   like /timeline, for this run
  GET  /scenarios/{id}/result     the run's canonical result: seed, prompt and every event.
                                  The map and the recap film both read this.
  GET  /scenarios/{id}/news       WORLD//WIRE items for this run's released events
  GET  /scenarios/{id}/satire     satire layer (?tone=, default the run's tone) for released events
  POST /scenarios/{id}/control    like /control, for this run
  WS   /scenarios/{id}/stream     like /stream, for this run

Each engine owns its state. A background task advances every simulation once
per tick and broadcasts the resulting messages to that simulation's clients.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import math
from typing import Any, Optional

from fastapi import Body, FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .engine import Message, Simulation
from .scenarios import (
    DEFAULT_TONE, MAX_PROMPT_CHARS, TONES, Channel, RegistryFull, Run, ScenarioRegistry, news_response, satire_response,
    starters,
)

log = logging.getLogger("worldsim_sim")


def apply_control(sim: Simulation, control: Any) -> Message:
    """Apply one control message and return the message to broadcast.

    {"action": "play", "until_next_event"?: true} | {"action": "pause"} | {"action": "speed", "speed": 4}
    | {"action": "seek", "sim_time_minutes": 400} | {"action": "replay"}
    Raises ValueError for anything else.
    """
    if not isinstance(control, dict):
        raise ValueError("control must be a JSON object")
    action = control.get("action")
    if action == "play":
        # Optional: stop at the next event (story playback). Not a stream-contract message field.
        return sim.play(until_next_event=control.get("until_next_event") is True)
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
                await channel.broadcast(channel.sim.tick(ticks))

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

    async def control(channel: Channel, body: Any) -> Message:
        try:
            message = apply_control(channel.sim, body)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        await channel.broadcast([message])
        return message

    async def serve(ws: WebSocket, channel: Channel) -> None:
        await ws.accept()
        await ws.send_json(channel.sim.snapshot())
        channel.clients.add(ws)
        try:
            while True:
                body = await ws.receive_json()
                try:
                    message = apply_control(channel.sim, body)
                except ValueError as exc:
                    # The stream contract has no error message kind; log and ignore.
                    log.warning("ignored control %r: %s", body, exc)
                    continue
                await channel.broadcast([message])
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

    def tone_of(value: Optional[str], default: str) -> str:
        tone = value or default
        if tone not in TONES:
            raise HTTPException(status_code=422, detail=f"tone must be one of {', '.join(TONES)}")
        return tone

    @app.get("/satire")
    async def satire(tone: Optional[str] = None) -> dict[str, Any]:
        # Released events only, so it always matches the clock (pause, seek, replay, reset).
        return satire_response(sim.snapshot(), tone_of(tone, "satirical"))

    @app.get("/starters")
    async def starter_list() -> dict[str, Any]:
        return {"label": "FICTIONAL SIMULATION", "starters": starters()}

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
        tone = body.get("tone", DEFAULT_TONE)
        if tone not in TONES:
            raise HTTPException(status_code=422, detail=f"tone must be one of {', '.join(TONES)}")
        if not isinstance(prompt, str) or len(prompt) > MAX_PROMPT_CHARS:
            raise HTTPException(status_code=422, detail=f"prompt must be text of at most {MAX_PROMPT_CHARS} characters")
        if fixture is not None and not isinstance(fixture, str):
            raise HTTPException(status_code=422, detail="fixture must be a fixture name")
        if not prompt.strip():
            raise HTTPException(status_code=422, detail="Describe a scenario to simulate")
        try:
            run = await registry.create(prompt.strip(), fixture, tone)
        except RegistryFull as exc:
            return JSONResponse(status_code=429, content={"detail": str(exc)})
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

    @app.get("/scenarios/{run_id}/result")
    async def scenario_result(run_id: str) -> dict[str, Any]:
        run = find(run_id)
        return run.result(ready(run_id).sim)

    @app.get("/scenarios/{run_id}/news")
    async def scenario_news(run_id: str) -> dict[str, Any]:
        # Released events only (a snapshot), never the future.
        return news_response(ready(run_id).sim.snapshot())

    @app.get("/scenarios/{run_id}/satire")
    async def scenario_satire(run_id: str, tone: Optional[str] = None) -> dict[str, Any]:
        run = find(run_id)
        channel = ready(run_id)
        return satire_response(channel.sim.snapshot(), tone_of(tone, run.tone))

    @app.post("/scenarios/{run_id}/control")
    async def scenario_control(run_id: str, body: dict[str, Any] = Body(...)) -> Message:
        return await control(ready(run_id), body)

    @app.websocket("/scenarios/{run_id}/stream")
    async def scenario_stream(ws: WebSocket, run_id: str) -> None:
        run = registry.get(run_id)
        if run is None or run.channel is None:
            # 4404: unknown run; 4409: not ready yet (poll GET /scenarios/{id}).
            await ws.close(code=4404 if run is None else 4409)
            return
        await serve(ws, run.channel)

    return app
