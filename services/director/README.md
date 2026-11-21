# World Director

Turns a hypothetical scenario into a validated batch of **proposed** WORLD//SIM events (DIR-001, #3). Python 3.9+ standard library only. Install `jsonschema` (see the root README) to also check output against the contract.

```bash
cd services/director
python3 -m worlddirector --fixture japan-earthquake        # deterministic, offline, no model
python3 -m worlddirector --fixture global-pandemic         # 10 events over 3 months, 7 countries
python3 -m worlddirector "A M7.5 earthquake hits Lima"     # real prediction through the model
python3 -m unittest discover -s ../../tests/director       # tests (the model is faked)
../../scripts/smoke-demo.sh                                # everyone's checks, Director included
```

## Predicting, then continuing

The Director predicts how a scenario unfolds: the triggering hazard, direct damage, failing services, responses, spread to other places, second-order effects, and eventually recovery. It returns up to 12 events per call over as long as the scenario needs (up to one simulated year).

To keep going, pass what has already happened as `history`. The Director then continues the same simulation: new events start at or after the latest past event, IDs continue (`evt-0007`, ...), `sequence` continues at shared minutes, and `parent_ids` can point back to past events. Only `applied` history events count, so rejected proposals are ignored.

```bash
python3 -m worlddirector --fixture japan-earthquake --applied > day1.json   # as if the simulation applied them
python3 -m worlddirector --fixture japan-earthquake-continued --history day1.json
python3 -m worlddirector "Continue the scenario" --history snapshot.json
```

```python
batch = generate("A M7.5 earthquake hits Lima")
# ...the simulation applies some events...
more = generate("A M7.5 earthquake hits Lima", history=snapshot)   # a batch, a snapshot, or a list of events
```

With the simulation service running (`services/simulation`, SIM-001), `--sim` does both steps: it reads the current `GET /snapshot` as history, predicts what comes next, sends the batch to `POST /events`, and prints the simulation's answer (each event `applied` or `rejected`, with reasons).

```bash
python3 -m worlddirector "A M7.5 earthquake hits Lima" --sim                         # default http://127.0.0.1:8765
python3 -m worlddirector --fixture japan-earthquake-continued --sim http://127.0.0.1:8765  # offline continuation
```

The snapshot only lists events the clock has already reached, so run `--sim` once playback reaches the last applied event. Otherwise new IDs can collide with events that are scheduled but not yet played.

Fixtures:
- `japan-earthquake`: the 72-hour, 20-event team demo with `impacts` on every event. `contracts/fixtures/japan-earthquake.json` is generated from it with `--applied`, and a test keeps them identical.
- `japan-earthquake-continued`: days 5 to 8, which needs the Japan chain as history.
- `global-pandemic`: 10 events, 7 countries, 3 months.
- `iceland-eruption`: 8 events over about 2.5 days in Iceland and the UK, aid from Norway and Denmark, with `impacts`. The deterministic non-Japan scenario for prompt-to-play tests.

Fixtures can be longer than one model batch (12 events). Only model output is capped.

The team uses the Japan fixture for development and testing. Actual AI prompting tests will run later on Hamza's computer using his signed-in Codex CLI. Codex mode uses an ephemeral, read-only sandbox and strips API-key environment variables so the signed-in ChatGPT account is used.

## Prompt-to-play: `prepare_scenario` (DIR-005)

The call the scenario service (SIM-004, #49) makes when the browser submits a prompt. It returns a complete batch for a **new, independent run**: the caller's `simulation_id`/`branch_id`, an empty history, IDs from `evt-0001`, every event `proposed`, parents valid, canonical order. Any failure raises `DirectorError`; it never returns a partial batch.

```python
from worlddirector import DirectorError, prepare_scenario, public_error

try:
    batch = prepare_scenario(prompt, simulation_id=run_id, branch_id="main", timeout_s=240)
    # tests / demo without a model: add fixture="iceland-eruption"
except DirectorError as err:
    log.warning("director %s: %s %s", err.code, err.message, err.detail)  # raw output stays on the server
    body = public_error(err)   # safe to send to the browser
```

- **Blocking:** a model run can take minutes. Call it off the request and clock loop (thread or executor).
- **`timeout_s`** is clamped to 5–600 s. Model and credentials stay with the local Codex login.
- **`fixture=`:** one of `RUN_FIXTURES` (`iceland-eruption`, `global-pandemic`, `japan-earthquake`). The service decides when to use one. The prompt is still validated, and no model is called.
- **Errors:** `public_error(err)` returns `{error, state, retryable, status, message}`. It never contains `err.detail`.

| `error` | `state` | retryable | HTTP | When |
| --- | --- | --- | --- | --- |
| `invalid_scenario` | `invalid_prompt` | no (edit the prompt) | 422 | empty or longer than 2000 characters |
| `invalid_request` | `invalid_request` | no | 400 | bad `simulation_id`/`branch_id` or `timeout_s` (caller bug) |
| `codex_timeout` | `timeout` | yes | 504 | model exceeded `timeout_s` |
| `invalid_json` | `invalid_output` | yes | 502 | model reply was not JSON |
| `invalid_events` | `invalid_output` | yes | 502 | reply failed validation (order, coordinates, causes, payload, impacts) |
| `codex_failed` | `unavailable` | yes | 503 | Codex exited non-zero or could not start |
| `codex_missing` | `unavailable` | no | 503 | Codex CLI not installed on this server |
| `fixture_missing` | `unavailable` | no | 500 | unknown sample fixture |
| anything else | `unavailable` | yes | 500 | unexpected |

A retry is a new `prepare_scenario` call, ideally with a new run ID.

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
- Events are sorted by `(sim_time_minutes, sequence)`. IDs start after the history, or at `--first-id` if you set it.
- `parent_ids` comes from the model's `caused_by` (earlier events in this batch) and `caused_by_events` (past events from the history). A cause can't be later than the event it caused.
- `visual` is derived from `type` (see `VISUALS` in `worlddirector/contract.py`, which fails on import if any contract type is missing).
- `payload` always has `description`, plus whichever details the model filled for that event: `magnitude` and `depth_km` (required for quakes), `label` (required for `other_hazard`), `vei`, `diameter_m`, `yield_kt`, `radius_km`, `origin`, `target`, and `pathogen`. The meanings are listed in [contracts/README.md](../../contracts/README.md#event-types).
- `payload.impacts` is the model's fictional estimate of scenario-wide totals as of that event, using the shape in [contracts/README.md](../../contracts/README.md#impact-estimates-payloadimpacts). The Director adds `"basis": "fictional_estimate"`, drops unknown values, and rejects batches where a running total (deaths, losses, aid, and so on) goes down, including against the history.

## Validation and failures

The model must follow a strict JSON schema (`OUTPUT_SCHEMA`), and its output is checked again locally: 1–12 events, no earlier than the history, contract types only, no extra keys, an alpha-3 country code, lat/lon/severity/time and payload details in range, magnitude and depth for quakes, a label for `other_hazard`, causes that point backwards in time, and short non-empty text. Nothing is repaired except ordering. The scenario is capped at 2000 characters and passed to the model as delimited data.

| `error` | Meaning |
| --- | --- |
| `invalid_scenario` | Empty or over 2000 characters, or a bad `simulation_id`/`branch_id`/`first_id` |
| `codex_missing` | `codex` is not on PATH |
| `codex_timeout` | No answer within `--timeout` (default 240 s) |
| `codex_failed` | Codex exited non-zero (for example, not logged in). `detail` holds stderr |
| `invalid_json` | Empty response or not JSON |
| `invalid_events` | JSON failed validation. `detail` lists every problem |
| `invalid_history` | The history isn't a batch or list of events, or its file can't be read |
| `fixture_missing` | Unknown fixture name |
| `sim_unreachable` | `--sim` couldn't connect to the simulation |
| `sim_error` | The simulation answered with an error (for example, a `simulation_id` mismatch). `detail` holds its response |

The CLI prints the batch on stdout and exits 0. On failure it prints the error JSON on stderr and exits 1 (2 for usage errors).
