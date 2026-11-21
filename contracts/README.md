# Contracts (v0.1, proposed)

These are the shared shapes that the Director, simulation, map, and newsroom build against. They are proposed in CONTRACT-001 (#1). Change them only through a PR that the affected owners review, and bump `schema_version` when a change breaks compatibility.

| File | What it describes |
| --- | --- |
| [events.schema.json](events.schema.json) | An event batch: `{schema_version, simulation_id, branch_id, events[]}` |
| [stream.schema.json](stream.schema.json) | One message from the simulation stream: `snapshot`, `event`, or `clock` |
| [fixtures/japan-earthquake.json](fixtures/japan-earthquake.json) | The deterministic 72-hour demo chain (see [Japan fixture](#japan-fixture)), which validates against `events.schema.json` |

## Rules

- **IDs:** each event `id` (`evt-…`) is stable and unique within a simulation. `parent_ids` lists the events that caused it.
- **Time:** `sim_time_minutes` counts simulated minutes since the start, and `0` is `DAY 1 · 00:00`. Never send wall-clock time.
- **Order:** the canonical order is `(sim_time_minutes, sequence)`. The stream sends events in this order, and snapshots list them in this order.
- **Lifecycle:** the Director sends `proposed` events. The simulation validates each one and marks it `applied` or `rejected`. The stream, map, and newsroom see `applied` events only.
- **Location:** `lat` and `lon` are in WGS84 degrees, and `country_code` is ISO 3166-1 alpha-3.
- **Provenance:** `source` is `fixture`, `model`, `user`, or `numeric`. When the source is `model`, `model` names it.

## Event types

Types are additive: new values can be added without bumping `schema_version`, so consumers should handle an unknown `type` or `visual` gracefully (for example, a generic marker or headline).

| Group | Types |
| --- | --- |
| Hazards | `earthquake`, `aftershock`, `tsunami_warning`, `volcanic_eruption`, `meteor_impact`, `extreme_weather`, `flooding`, `disease_outbreak`, `military_strike`, `nuclear_detonation`, `cyber_attack`, `alien_contact`, `other_hazard` |
| Consequences | `infrastructure_failure`, `government_response`, `international_aid`, `evacuation`, `contamination`, `economic_shock`, `civil_unrest`, `conflict_escalation`, `ceasefire`, `recovery` |

`other_hazard` is the catch-all for any scenario the list doesn't cover, and it requires `payload.label` (for example, `"solar superstorm"`).

Optional `payload` keys with fixed meanings: `description` (one sentence), `label`, `magnitude` and `depth_km` (required for earthquake and aftershock), `vei`, `diameter_m`, `yield_kt`, `radius_km` (map scale), `origin` (aid sender or attacker), `target`, `pathogen`, and `impacts` (below). On `international_aid` events, `origin` names the sender.

## Impact estimates (`payload.impacts`)

`payload.impacts` is an optional snapshot of **fictional scenario estimates**. Every number in it is invented for the simulation, and the required `"basis": "fictional_estimate"` marker says so. Don't present these numbers as real figures.

- **Values are scenario-wide totals as of that event, never deltas.** To show the state at time T, read `impacts` from the latest applied event at or before T. Don't sum across events.
- **These never decrease:** `deaths`, `injuries`, `economic_loss_usd`, `flooded_area_km2`, `contaminated_area_km2`, `debris_tonnes`, and each `aid_contributors` entry's `personnel` and `cargo_tonnes`. A contributor never disappears from the list.
- **These are current levels and can fall during recovery:** `missing`, `displaced` (people evacuated or without a home now), `sheltered` (of those, people in shelters), `households_without_power`, and `households_without_water`.
- **An omitted key means no estimate yet,** not zero. Only `basis` is required.

```json
"impacts": {
  "basis": "fictional_estimate",
  "deaths": 640, "injuries": 2400, "missing": 1650, "displaced": 212000, "sheltered": 127200,
  "households_without_power": 2300000, "households_without_water": 640000,
  "economic_loss_usd": 14500000000, "flooded_area_km2": 210, "debris_tonnes": 3200000,
  "aid_contributors": [
    { "country": "United States", "personnel": 180, "cargo_tonnes": 60, "cargo": "search-and-rescue teams and relief supplies" }
  ]
}
```

## Japan fixture

[fixtures/japan-earthquake.json](fixtures/japan-earthquake.json) is the deterministic proof of concept, not the product boundary. It is a 72-hour, 20-event chain: earthquake → tsunami warning and evacuation → flooding, aftershocks, and power and water failures → government response → aid from the United States, South Korea, Australia, and Taiwan → contamination and economic impacts → recovery. Every event has `parent_ids` and an `impacts` snapshot. The Director generates it, and a test keeps the two in sync:

```bash
cd services/director && python3 -m worlddirector --fixture japan-earthquake --applied > ../../contracts/fixtures/japan-earthquake.json
cd ../newsroom && python3 -m worldwire ../../contracts/fixtures/japan-earthquake.json > feeds/japan-earthquake.json
```

## Stream

The transport is WebSocket JSON, with one message per frame. After a client connects, the server first sends a `snapshot` with the full current state. It then sends `event` messages as events are applied and `clock` messages on each tick or playback change. After a replay or seek, it sends a new `snapshot`, and the client replaces its state with it. Endpoint paths and the control messages for pause, speed, and replay are left to SIM-001 (#4).

## Checking

```bash
python3 -m venv .venv && .venv/bin/pip install jsonschema
.venv/bin/python -m unittest discover -s tests/contracts -v
```
