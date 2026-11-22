# Simulation engine and stream (SIM-001, #4)

Owns the simulation clock and the authoritative event timeline. It validates incoming events, marks each one `applied` or `rejected`, and streams applied events to clients in canonical `(sim_time_minutes, sequence)` order as [contracts/stream.schema.json](../../contracts/stream.schema.json) messages. It needs no model access.

```bash
python3 -m venv .venv && .venv/bin/pip install -r services/simulation/requirements.txt
cd services/simulation
../../.venv/bin/python -m worldsim_sim --start-minutes 395 --speed 4   # Japan fixture, quake at 402
../../.venv/bin/python -m unittest discover -s ../../tests/simulation  # tests
```

For the complete map + stream demo, return to the repo root and run
`./scripts/run-demo.sh`. It starts the server paused at minute 401 and uses
60 simulated minutes per wall-clock second so the fixture event at minute 402
appears immediately after playback starts.

On Windows the venv interpreter is `.venv\Scripts\python`.

Options: `fixture` (defaults to `contracts/fixtures/japan-earthquake.json`), `--port 8765`, `--start-minutes`, `--speed {1,2,4,16}`, `--paused`, `--minutes-per-second` (the demo's sim minutes per wall second at 1×, default 1), `--tick-seconds` (default 1), `--scenario-pace PERCENT` (scenario runs, default 5; see [Pacing](#pacing-sim-005-58)).

## Endpoints

| Endpoint | What it does |
| --- | --- |
| `WS /stream` | Sends a `snapshot` on connect, then `event` messages as events become due and a `clock` message each tick. Accepts control messages. |
| `POST /control` | Same control body as the WebSocket. Returns the resulting `clock` or `snapshot` message and broadcasts it. |
| `POST /events` | Ingests a Director batch (`events.schema.json`). Returns `{batch, rejections: [{id, reasons}]}`, with each event's `status` set. |
| `GET /snapshot` | The current snapshot message: applied events the clock has reached. |
| `GET /timeline` | Every applied event in the scenario, including ones the clock hasn't reached yet. Read-only. See below. |
| `GET /health` | Liveness check. |

### Control messages

```json
{"action": "play"}
{"action": "pause"}
{"action": "speed", "speed": 4}
{"action": "seek", "sim_time_minutes": 400}
{"action": "replay"}
```

`play`, `pause`, and `speed` broadcast a `clock`. `seek` and `replay` (a seek to 0) broadcast a new `snapshot`, which replaces client state. The stream contract has no error kind, so an invalid control on the WebSocket is logged and ignored. `POST /control` answers it with a 422.

### `GET /timeline`

Use this endpoint to draw a scrubber, mark upcoming events, or plan the next Director batch without colliding with scheduled IDs. It never changes state.

```json
{
  "schema_version": "0.1",
  "simulation_id": "demo-japan-earthquake",
  "branch_id": "main",
  "sim_time_minutes": 401,
  "playback": { "state": "paused", "speed": 1 },
  "end_minutes": 402,
  "events": [ { "id": "evt-0001", "sim_time_minutes": 402, "sequence": 0, "status": "applied", "...": "..." } ]
}
```

- `events` lists every applied event in canonical `(sim_time_minutes, sequence)` order. Each one has the same shape as a snapshot event. Rejected events never appear.
- `sim_time_minutes` and `playback` report the clock. Events with `sim_time_minutes` at or before the clock are exactly the ones in the current `/snapshot`, and the rest are still to come.
- `end_minutes` is the time of the last applied event, or `0` when there are none.
- The list doesn't depend on the clock: seeking or replaying leaves it unchanged. It grows only when `POST /events` applies new events.
- It is an HTTP response, not a stream message, so it has no `kind`. `/snapshot` and the WebSocket are unchanged.

### Scenario end

Playback stops at `end_minutes`. However far one tick would carry the clock (several hundred sim minutes per wall second at 4× or 16×), it stops on that minute, releases every due event once, and switches to `paused`. The last `clock` message, `/snapshot`, and `/timeline` all report the end time. While the clock is at the end, `play` changes nothing until you `seek` or `replay`. A seek past the end is kept as-is, and the clock stays there. When `POST /events` applies a later event, it moves the end so playback can continue. With no events, the end is 0.

Seek and replay can move in either direction. After any mix of seeks, replays, speed changes, and ticks, a client that replaces its state on each `snapshot` and appends each `event` holds exactly the timeline events up to the clock, in order, with no duplicates or gaps. The WebSocket sends one `event` message per event, when the clock reaches it, even when one tick at high speed passes several events. `tests/simulation/test_timeline.py` checks this against the demo fixture and a multi-day test fixture (`tests/simulation/fixtures/multi-day.json`).

## Scenario runs (SIM-004, #49)

A scenario run is a simulation that the browser creates from a prompt. Each run has its own ID, clock, timeline, playback state and stream subscribers. Runs can't affect each other or the fixture demo above. The demo endpoints work exactly as before.

| Endpoint | What it does |
| --- | --- |
| `POST /scenarios` | Body `{"prompt": "..."}`. Responds `202` with the run's status, `generating`, straight away. `422` for an empty prompt or one over 2000 characters. `429` while too many runs are generating; try again shortly. |
| `GET /scenarios/{id}` | The run's status: `generating`, `ready` or `failed`. Poll it after creating a run. `404` for an unknown ID. |
| `GET /scenarios/{id}/timeline` | Same as `/timeline`, for this run. Includes `end_minutes`. |
| `GET /scenarios/{id}/snapshot` | Same as `/snapshot`, for this run. |
| `GET /scenarios/{id}/news` | Amir's `worldwire.news_response` (#51): `{schema_version, simulation_id, branch_id, sim_time_minutes, items}`. `items` holds WORLD//WIRE items, newest first, for events the clock has reached. Future events never appear. |
| `POST /scenarios/{id}/control` | Same control body as `/control`, scoped to this run. |
| `WS /scenarios/{id}/stream` | Same as `/stream`, for this run. Every message has `simulation_id` set to the run ID. |

The run routes other than `GET /scenarios/{id}` answer `409` until the run is `ready`. A WebSocket to a run that isn't ready closes with code `4409`, and to an unknown run with code `4404`. When a run is evicted, its open WebSockets close with code `4410`.

The status body:

```json
{
  "id": "run-3f9a1c2b7e",
  "status": "ready",
  "title": "A novel flu spreads from a port city",
  "simulation_id": "run-3f9a1c2b7e",
  "branch_id": "main",
  "start_minutes": 189,
  "end_minutes": 4500,
  "event_count": 8,
  "sim_time_minutes": 189,
  "playback": { "state": "paused", "speed": 1 },
  "pacing": { "mode": "relative", "fraction_per_tick": 0.05, "start_minutes": 189, "span_minutes": 4311, "minutes_per_tick": 215.55, "tick_seconds": 1 }
}
```

- **Generation progress:** while a run is `generating`, the status also has `stage`, `elapsed_s` (since the run was created) and `stage_elapsed_s`. `stage` is the step actually running, never a percentage:
  - `queued`, then `starting`;
  - the Director's own stages, `prompt`, `model`, `parse` and `validate` (`fixture` instead of `model` and `parse` for fixture runs), when the Director reports them (`worlddirector.Stages`, #61). An older Director stays on `starting`;
  - `applying` while the simulation checks and applies the batch.

  A `ready` or `failed` run reports `generation_s` instead. For example: `{"status": "generating", "stage": "model", "elapsed_s": 41.3, "stage_elapsed_s": 40.9, ...}`.
- **How a run starts:** the run ID is also its `simulation_id`, and the Director builds the batch with it. A run becomes `ready` only once every event in the batch is applied. It starts paused, one minute before its first event, and like the demo it stops at its own `end_minutes`.
- **If generation fails:**
  - Any failure fails the run, including a rejected event, so a run is never only partly ready.
  - The status includes the Director's UI-safe error (`worlddirector.public_error`, #50): `{"error", "state", "retryable", "status", "message"}`.
  - `state` is one of `invalid_prompt`, `invalid_request`, `timeout`, `invalid_output` or `unavailable`. `message` is short text you can show in the UI, and `retryable` says whether to offer "Try again".
  - A batch that doesn't apply reports `invalid_events` (`invalid_output`), and anything unexpected reports `internal_error` (`unavailable`).
  - Raw model output and error details are only written to the server log.
  - To retry, create a new run.
- **How the Director is called:** through `worlddirector.prepare_scenario` (#50), in a worker thread, so it never blocks the clock or other requests, with a timeout (`--director-timeout`, default 180 s). At most 2 runs generate at once, and the server keeps the 16 newest runs.
- **Offline runs:** `--scenario-fixture NAME` makes every run use that Director fixture instead of a model, for example `--scenario-fixture global-pandemic` or `iceland-eruption`. A prompt is still required. Use it for offline demos and end-to-end tests. A request can also name a fixture with `{"fixture": "global-pandemic"}`.

`tests/simulation/test_scenarios.py` runs offline with a stub Director that returns the Iceland eruption fixture. It covers:

- the run lifecycle
- canonical, non-Japan playback, clamped at the run's end
- seek and replay
- two simultaneous runs plus the demo staying isolated
- news withholding future events
- every failure type, then retrying with a new run
- the limits on concurrent generations and stored runs

One test also uses the real Director callable with its offline fixture.

## Pacing (SIM-005, #58)

The server ticks every `--tick-seconds` (default 1 s). How far one tick moves the clock depends on the simulation's pacing:

- **Scenario runs: relative.** One tick at 1× covers 5% of the run's span (`end_minutes − start_minutes`, from the minute the run starts to its last event). A seven-hour run and a six-month run both play in 20 ticks at 1×, 10 at 2×, 5 at 4× and 2 at 16×. Set the percentage with `--scenario-pace` (default 5).
- **The fixture demo: fixed.** Unchanged: `--minutes-per-second` sim minutes per wall second at 1×, so `./scripts/run-demo.sh` plays the Japan demo as before.

Pacing only decides how far the clock moves. It never schedules events:

- Every event releases at its own `sim_time_minutes`, in canonical order, exactly once, including several events (or same-minute events) crossed in one tick.
- Steps can be fractional (5% of 421 minutes is 21.05). The clock keeps the fraction and reports whole minutes, as before.
- A late wall tick counts as a fraction of a tick more, so wall-clock hiccups don't change the playback length.
- Pause, speed, seek, replay and the end clamp behave as described above. Seek and replay don't change the pace, because the span doesn't depend on the clock. Replay from 0 takes a few more ticks than the span when a run starts later than minute 0.
- When a later event is applied, the span grows and the following ticks grow with it.
- A zero-length span (every event at the start minute) finishes in one tick.
- Each run paces from its own span, so runs never affect each other.

`GET /timeline`, `GET /scenarios/{id}/timeline` and the run status report it as `pacing`. These are HTTP fields only, so stream messages and `contracts/stream.schema.json` are unchanged:

```json
{ "mode": "relative", "fraction_per_tick": 0.05, "start_minutes": 29, "span_minutes": 421, "minutes_per_tick": 21.05, "tick_seconds": 1 }
{ "mode": "fixed", "minutes_per_tick": 60, "tick_seconds": 1 }
```

`minutes_per_tick` is at 1×. Multiply by `playback.speed` for the current rate. There is no control action to change pacing yet. Adding one needs agreement on the stream contract first.

`tests/simulation/test_pacing.py` checks this deterministically on a multi-hour fixture (`tests/simulation/fixtures/multi-hour.json`) and a multi-month fixture (`multi-month.json`), plus the server's ticker with two runs and the demo.

## Validation rules

An event is rejected when any of the following is true:

- It fails `events.schema.json#/$defs/event`.
- Its batch's `schema_version`, `simulation_id`, or `branch_id` does not match the running simulation. In that case the whole batch is rejected.
- Its `id` or its `(sim_time_minutes, sequence)` pair is already in the timeline.
- Its `sim_time_minutes` is earlier than the clock, so the stream never rewrites the past.
- A `parent_ids` entry is unknown or does not come before it in canonical order.

Events already marked `rejected` are skipped. The engine never mutates the input batch.

## Using the engine directly

`worldsim_sim.engine` is pure and deterministic. It reads no wall clock and does no I/O.

```python
from worldsim_sim import Simulation, replay
sim = Simulation.from_batch(batch)        # validates; raises on a bad fixture
sim.ingest(director_batch)                # -> (events with status, rejections)
messages = sim.advance(5)                 # 5 sim minutes × speed -> [event..., clock]
sim = Simulation.from_batch(batch, pace=0.05)  # relative pacing
messages = sim.tick()                     # one tick: 5% of the span × speed
replay(batch, speed=4)                    # offline full replay, like tests/integration/mock_stream.replay
```

Event messages carry the event's own `sim_time_minutes` in the header. The `clock` message that follows carries the current time.
