# World Director

Turns a hypothetical scenario into a validated batch of **proposed** WORLD//SIM events (DIR-001, #3). Python 3.9+ standard library only.

```bash
cd services/director
python3 -m worlddirector --fixture japan-earthquake        # deterministic, offline, no Codex
python3 -m worlddirector "A M7.5 earthquake hits Lima"     # GPT-6 Luna (high) via Codex CLI
python3 -m unittest discover -s ../../tests/director       # tests (Codex is faked)
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

Same envelope as the newsroom fixture (provisional until #1 lands):

```json
{
  "schema_version": "0.1-provisional",
  "simulation_id": "demo-japan-earthquake",
  "branch_id": "main",
  "events": [
    {
      "id": "evt-0001",
      "type": "earthquake",
      "status": "proposed",
      "sim_time_minutes": 402,
      "location": { "name": "off the coast of Miyagi", "country": "Japan", "lat": 38.3, "lon": 142.4 },
      "severity": 0.9,
      "payload": { "description": "A powerful offshore earthquake ...", "magnitude": 7.8, "depth_km": 24 },
      "visual": "earthquake_shockwave",
      "provenance": "fixture"
    }
  ]
}
```

- `status` is always `"proposed"`. The simulation decides what becomes `"applied"`, and only applied events reach WORLD//WIRE.
- `provenance` is `"model"` or `"fixture"`.
- Events are sorted by `sim_time_minutes`. IDs start at `--first-id` (default 1), so later batches can continue the sequence.
- `visual` is derived from `type` (see `VISUALS` in `worlddirector/contract.py`), so the model can't invent animation keys.
- Allowed types: `earthquake`, `aftershock`, `tsunami`, `infrastructure_failure`, `evacuation`, `government_response`, `international_aid`, `public_health`, `economic_impact`, `recovery`.

## Validation and failures

The model must follow a strict JSON schema (`OUTPUT_SCHEMA`), and its output is checked again locally: 1–6 events, known types only, no extra keys, lat/lon/severity/time/magnitude in range, and short non-empty text. Nothing is repaired except ordering. The scenario is capped at 2000 characters and passed to the model as delimited data.

| `error` | Meaning |
| --- | --- |
| `invalid_scenario` | Empty or over 2000 characters |
| `codex_missing` | `codex` is not on PATH |
| `codex_timeout` | No answer within `--timeout` (default 240 s) |
| `codex_failed` | Codex exited non-zero (for example, not logged in). `detail` holds stderr |
| `invalid_json` | Empty response or not JSON |
| `invalid_events` | JSON failed validation. `detail` lists every problem |
| `fixture_missing` | Unknown fixture name |

The CLI prints the batch on stdout and exits 0. On failure it prints the error JSON on stderr and exits 1 (2 for usage errors).
