# World Director

Turns a hypothetical scenario into a validated batch of **proposed** WORLD//SIM events (DIR-001, #3). Python 3.9+ standard library only. Install `jsonschema` (see the root README) to also check output against the contract.

```bash
cd services/director
python3 -m worlddirector --fixture japan-earthquake        # deterministic, offline, no Codex
python3 -m worlddirector "A M7.5 earthquake hits Lima"     # GPT-6 Luna (high) via Codex CLI
python3 -m unittest discover -s ../../tests/director       # tests (Codex is faked)
../../scripts/smoke-demo.sh                                # everyone's checks, Director included
```

Codex mode needs Codex CLI installed and signed in on the demo host (`codex login`). It runs like `scripts/try-director.sh`: ephemeral, read-only sandbox, user config ignored, and `OPENAI_API_KEY`/`CODEX_API_KEY` removed so the signed-in ChatGPT account is used.

## From Python

```python
from worlddirector import DirectorError, generate

try:
    batch = generate("A M7.5 earthquake hits Lima", first_id=1)   # or generate(fixture="japan-earthquake")
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
- `visual` is derived from `type`: earthquake and aftershock → `earthquake_shockwave`, tsunami_warning → `weather_disaster`, infrastructure_failure → `power_grid_failure`, government_response → `emergency_mobilization`, international_aid → `animated_transport_route`.
- `payload` always has `description`. It has `magnitude` and `depth_km` for earthquakes and aftershocks (required), and `origin` for international aid (WORLD//WIRE uses it in the headline).
- The `japan-earthquake` fixture covers all six types. Its first event is identical to the shared contract fixture.

## Validation and failures

The model must follow a strict JSON schema (`OUTPUT_SCHEMA`), and its output is checked again locally: 1–6 events, contract types only, no extra keys, an alpha-3 country code, lat/lon/severity/time/magnitude/depth in range, magnitude and depth for quakes, causes that point backwards in time, and short non-empty text. Nothing is repaired except ordering. The scenario is capped at 2000 characters and passed to the model as delimited data.

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
