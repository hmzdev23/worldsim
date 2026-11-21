# World Director

Turns a hypothetical scenario into a validated batch of **proposed** WORLD//SIM events (DIR-001, #3). Python 3.9+ standard library only. Install `jsonschema` (see the root README) to also check output against the contract.

```bash
cd services/director
python3 -m worlddirector --fixture japan-earthquake        # deterministic, offline, no Codex
python3 -m unittest discover -s ../../tests/director       # tests (Codex is faked)
../../scripts/smoke-demo.sh                                # everyone's checks, Director included
```

The team uses the Japan fixture for development and testing. Actual AI prompting tests will run later on Hamza's computer using his signed-in Codex CLI. Codex mode uses an ephemeral, read-only sandbox and strips API-key environment variables so the signed-in ChatGPT account is used.

## From Python

```python
from worlddirector import DirectorError, generate

try:
    batch = generate(fixture="japan-earthquake", first_id=1)
except DirectorError as err:
    report(err.to_dict())   # {"error": "codex_timeout", "message": "...", "detail": "..."}
```

## Output

A batch that validates against [contracts/events.schema.json](../../contracts/events.schema.json) (v0.1). The event types and visuals are read from that file, so the Director stays in sync with it.

```json
{
  "schema_version": "0.1",
  "simulation_id": "demo-japan-earthquake",
  "branch_id": "main",
  "events": [
    {
      "id": "evt-0001",
      "sim_time_minutes": 402,
      "sequence": 0,
      "type": "earthquake",
      "status": "proposed",
      "location": { "name": "off the coast of Miyagi", "country": "Japan", "country_code": "JPN", "lat": 38.3, "lon": 142.4 },
      "severity": 0.9,
      "visual": "earthquake_shockwave",
      "payload": { "description": "A powerful offshore earthquake ...", "magnitude": 7.8, "depth_km": 24 },
      "parent_ids": [],
      "provenance": { "source": "fixture" }
    }
  ]
}
```

- `status` is always `"proposed"`. The simulation marks events `applied` or `rejected`, and only applied events reach the stream, map, and WORLD//WIRE.
- `provenance` is `{"source": "fixture"}` or `{"source": "model", "model": "gpt-6-luna"}`.
- Events are sorted by `(sim_time_minutes, sequence)`. IDs start at `--first-id` (default 1), so a later batch can continue the sequence.
- `parent_ids` comes from the model's `caused_by` indexes. A cause must be an earlier event in the same batch.
- `visual` is derived from `type` (see `VISUALS` in `worlddirector/contract.py`, which fails on import if any contract type is missing).
- `payload` always has `description`, plus whichever details the model filled for that event: `magnitude` and `depth_km` (required for quakes), `label` (required for `other_hazard`), `vei`, `diameter_m`, `yield_kt`, `radius_km`, `origin`, `target`, and `pathogen`. The meanings are listed in [contracts/README.md](../../contracts/README.md#event-types).
- The `japan-earthquake` fixture covers the six earthquake-family types. Its first event is identical to the shared contract fixture.

## Validation and failures

The model must follow a strict JSON schema (`OUTPUT_SCHEMA`), and its output is checked again locally: 1–12 events, contract types only, no extra keys, an alpha-3 country code, lat/lon/severity/time and payload details in range, magnitude and depth for quakes, a label for `other_hazard`, causes that point backwards in time, and short non-empty text. Nothing is repaired except ordering. The scenario is capped at 2000 characters and passed to the model as delimited data.

| `error` | Meaning |
| --- | --- |
| `invalid_scenario` | Empty or over 2000 characters, or a bad `simulation_id`/`branch_id`/`first_id` |
| `codex_missing` | `codex` is not on PATH |
| `codex_timeout` | No answer within `--timeout` (default 240 s) |
| `codex_failed` | Codex exited non-zero (for example, not logged in). `detail` holds stderr |
| `invalid_json` | Empty response or not JSON |
| `invalid_events` | JSON failed validation. `detail` lists every problem |
| `fixture_missing` | Unknown fixture name |

The CLI prints the batch on stdout and exits 0. On failure it prints the error JSON on stderr and exits 1 (2 for usage errors).
