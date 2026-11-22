# Player mode handoff: Director (Mathys)

This is a prototype for team review, written by Anthony's agent in your folder. Design: [docs/plans/player-mode.md](../../docs/plans/player-mode.md).

## What changed
- **`worlddirector/player.py`** (new) is the player catalogue:
  - `load_player_spec(fixture)` returns `generic` for model runs.
  - `list_player_specs()` feeds the role picker.
  - `validate_spec()` raises `DirectorError("invalid_spec")` for unknown measures, bad defaults, unknown roles or effects, reserved action IDs, or unknown variables.
  - `options_for(spec, role, event_type)` returns three actions, specific matches first, in catalogue order.
  - `check_free_text()` reuses `_clean_scenario` with a 280-character limit and refuses operational instructions.
  - `continue_with_decision()` is the model path. It calls `generate(history=…)` with the player's decision in the scenario text.
- **`fixtures/player/*.json`** (new) holds the specs for `global-pandemic`, `iceland-eruption` and `japan-earthquake`, plus `generic` for model runs. Each one has:
  - fixed, independent and dependent variables;
  - trigger rules;
  - roles;
  - actions with canned effects, which serve as the branch fixtures.

No existing Director file was edited. Model selection, credentials and the `gpt-6-luna` high-effort setting are untouched.

## Why this way
- **The catalogue is data, so it works offline and stays deterministic.** The simulation applies the effects; the Director only describes them.
- **Free text uses the same input checks as scenario prompts.**

## Please review
- **Wording and balance of the actions and trade-offs.** They're fictional, high-level policy choices, and every consequence description starts with "Simulated".
- **Whether `generic.json` is a sensible default for model runs.**
- **The operational-instruction filter** (`_OPERATIONAL`). It's a small regex and may need your judgement.

## Tests
`tests/director/test_player_catalogue.py` (7 tests):
- specs load
- every role has exactly three options for every trigger type in the three fixtures
- options are deterministic
- bad specs are rejected
- free-text checks
- the model-path prompt
