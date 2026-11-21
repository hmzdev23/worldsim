# SIM-004 · Isolated scenario sessions

Issue #49. Align the Director callable with #50, the browser routes with #52, and the news adapter with #51.

Owner Anthony. Work in `services/simulation/`, `tests/simulation/`, and local launch wiring needed by the simulation service.

The current FastAPI app owns one simulation seeded at process start. A user-created run needs an independent clock, timeline, and event identity. Use the existing deterministic engine once a validated batch is available.

## Proposed integration surface

Review the route names and status/error shape with Hamza, Mathys, and Amir before wiring consumers.

| Endpoint | Behavior |
| --- | --- |
| `POST /scenarios` | Accept prompt, allocate a run ID, and return a generating state immediately |
| `GET /scenarios/{id}` | Return generating, ready, or failed, with run title and start minute when ready |
| `GET /scenarios/{id}/timeline` | Return the existing timeline shape for this run, including `end_minutes` |
| `WS /scenarios/{id}/stream` | Initial snapshot, then existing event/clock messages and existing playback controls scoped to the run |
| `GET /scenarios/{id}/news` | Return Amir's existing WORLD//WIRE items for this run's released snapshot |

## Implement

- Make the local in-memory runtime own the run registry and bounded generation jobs. Call Mathys's Director wrapper off the request/clock loop. Initialize a paused simulation from the validated batch. Expose a friendly failure if generation or ingest cannot produce a complete playable run.
- Use separate `Simulation` instances and subscriber sets. Scope every control, seek, snapshot, timeline, and news read to the path ID. Keep the existing event and stream contract files. Coordinate additive HTTP details without putting them into event payloads.
- Reuse Amir's snapshot-to-news adapter in the route. Return items with run/branch identity and never pass unreleased timeline events into that adapter. Keep local startup working for the existing Japan demo.
- Document local launch and create a test path with the fixture/stub Director callable. Keep the dev service bound for local use. Coordinate the same-origin browser path with Hamza before the full demo check.

## Done when

A non-Japan run starts paused, plays, emits only its own events with canonical ordering, clamps at its own endpoint, and can seek and replay. A simultaneous second run cannot advance or reset the first. A failed launch surfaces an error and retry can create a new usable run. The legacy Japan smoke check still passes offline.
