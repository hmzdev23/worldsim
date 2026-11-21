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

Options: `fixture` (defaults to `contracts/fixtures/japan-earthquake.json`), `--port 8765`, `--start-minutes`, `--speed {1,2,4,16}`, `--paused`, `--minutes-per-second` (sim minutes per wall second at 1×, default 1), `--tick-seconds` (default 1).

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
replay(batch, speed=4)                    # offline full replay, like tests/integration/mock_stream.replay
```

Event messages carry the event's own `sim_time_minutes` in the header. The `clock` message that follows carries the current time.
