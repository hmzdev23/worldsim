"""FastAPI server for the simulation stream (SIM-001, #4).

Endpoints:
  GET  /health     liveness
  GET  /snapshot   current snapshot message (same shape as the stream's)
  POST /events     ingest a Director batch; returns it with statuses set
  POST /control    playback control (same body as a WebSocket control message)
  WS   /stream     snapshot on connect, then event and clock messages

The engine owns state. A background task advances it once per tick and
broadcasts the resulting messages to every connected client.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import math
from typing import Any

from fastapi import Body, FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from .engine import Message, Simulation

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
) -> FastAPI:
    """`minutes_per_second` is the sim rate at 1×; speed multiplies it."""
    if not math.isfinite(tick_seconds) or tick_seconds <= 0:
        raise ValueError("tick_seconds must be a positive finite number")
    if not math.isfinite(minutes_per_second) or minutes_per_second <= 0:
        raise ValueError("minutes_per_second must be a positive finite number")
    clients: set[WebSocket] = set()

    async def broadcast(messages: list[Message]) -> None:
        for ws in list(clients):
            try:
                for message in messages:
                    await ws.send_json(message)
            except Exception:  # client went away mid-send
                clients.discard(ws)

    async def ticker() -> None:
        loop = asyncio.get_running_loop()
        last = loop.time()
        while True:
            await asyncio.sleep(tick_seconds)
            now = loop.time()
            messages = sim.advance((now - last) * minutes_per_second)
            last = now
            await broadcast(messages)

    @contextlib.asynccontextmanager
    async def lifespan(_: FastAPI):
        task = asyncio.create_task(ticker())
        try:
            yield
        finally:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task

    app = FastAPI(title="WORLD//SIM simulation", lifespan=lifespan)
    app.add_middleware(CORSMiddleware, allow_origins=list(cors_origins), allow_methods=["*"], allow_headers=["*"])
    app.state.sim = sim

    @app.get("/health")
    async def health() -> dict[str, Any]:
        return {"ok": True, "simulation_id": sim.simulation_id, "branch_id": sim.branch_id}

    @app.get("/snapshot")
    async def snapshot() -> Message:
        return sim.snapshot()

    @app.post("/events")
    async def events(batch: dict[str, Any] = Body(...)) -> dict[str, Any]:
        processed, rejections = sim.ingest(batch)
        # Events due now (sim_time == clock) go out immediately, not next tick.
        await broadcast(sim.advance(0))
        return {
            "batch": {**{k: batch.get(k) for k in ("schema_version", "simulation_id", "branch_id")}, "events": processed},
            "rejections": [r.to_json() for r in rejections],
        }

    @app.post("/control")
    async def control(body: dict[str, Any] = Body(...)) -> Message:
        try:
            message = apply_control(sim, body)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        await broadcast([message])
        return message

    @app.websocket("/stream")
    async def stream(ws: WebSocket) -> None:
        await ws.accept()
        await ws.send_json(sim.snapshot())
        clients.add(ws)
        try:
            while True:
                body = await ws.receive_json()
                try:
                    message = apply_control(sim, body)
                except ValueError as exc:
                    # The stream contract has no error message kind; log and ignore.
                    log.warning("ignored control %r: %s", body, exc)
                    continue
                await broadcast([message])
        except WebSocketDisconnect:
            pass
        finally:
            clients.discard(ws)

    return app
