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
| `GET /snapshot` | The current snapshot message. |
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
