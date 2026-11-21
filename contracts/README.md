# Contracts (v0.1, proposed)

These are the shared shapes that the Director, simulation, map, and newsroom build against. They are proposed in CONTRACT-001 (#1). Change them only through a PR that the affected owners review, and bump `schema_version` when a change breaks compatibility.

| File | What it describes |
| --- | --- |
| [events.schema.json](events.schema.json) | An event batch: `{schema_version, simulation_id, branch_id, events[]}` |
| [stream.schema.json](stream.schema.json) | One message from the simulation stream: `snapshot`, `event`, or `clock` |
| [fixtures/japan-earthquake.json](fixtures/japan-earthquake.json) | The deterministic demo batch, which validates against `events.schema.json` |

## Rules

- **IDs:** each event `id` (`evt-…`) is stable and unique within a simulation. `parent_ids` lists the events that caused it.
- **Time:** `sim_time_minutes` counts simulated minutes since the start, and `0` is `DAY 1 · 00:00`. Never send wall-clock time.
- **Order:** the canonical order is `(sim_time_minutes, sequence)`. The stream sends events in this order, and snapshots list them in this order.
- **Lifecycle:** the Director sends `proposed` events. The simulation validates each one and marks it `applied` or `rejected`. The stream, map, and newsroom see `applied` events only.
- **Location:** `lat` and `lon` are in WGS84 degrees, and `country_code` is ISO 3166-1 alpha-3.
- **Provenance:** `source` is `fixture`, `model`, `user`, or `numeric`. When the source is `model`, `model` names it.

## Stream

The transport is WebSocket JSON, with one message per frame. After a client connects, the server first sends a `snapshot` with the full current state. It then sends `event` messages as events are applied and `clock` messages on each tick or playback change. After a replay or seek, it sends a new `snapshot`, and the client replaces its state with it. Endpoint paths and the control messages for pause, speed, and replay are left to SIM-001 (#4).

## Checking

```bash
python3 -m venv .venv && .venv/bin/pip install jsonschema
.venv/bin/python -m unittest discover -s tests/contracts -v
```
