# DIR-005 · Prompt runner for new scenarios

Issue #50. Hand the callable, fixture-backed test path, and error mapping to Anthony in #49.

Owner Mathys. Work in `services/director/` and `tests/director/`.

The existing CLI and Python `generate` function already validate prompted events. The CLI's `--sim` posts into the current process and uses its current snapshot as history. A new run needs its own ID and an empty history.

## Implement

- Give Anthony a stable Python entry point for prompt text, caller-assigned `simulation_id` and `branch_id`, and a bounded timeout. Reuse `generate` directly if it meets the service needs. Return the existing proposed event batch and typed `DirectorError` failures.
- Use the existing validation for ordering, coordinates, times, causes, required payload fields, and fictional estimates. Reserve `other_hazard` with a descriptive label for an unfamiliar scenario. Keep model selection and credentials on the local server.
- Provide a fixture-backed or stubbed version of the same callable for automated tests. Build on the Iceland proof in #46 and cover a second distinct scenario or repeated launch with separate IDs. The service decides when an explicit fixture is requested.
- Map invalid prompts, invalid output, and timeout to concise, retryable UI states with Anthony. Keep raw model errors and logs on the server. Existing CLI behavior still needs its smoke coverage.

## Done when

The same prompt-facing interface produces a valid, ordered non-Japan batch through deterministic tests, with the requested run ID, valid causal links, and all statuses proposed. A timeout or malformed response produces a typed error that cannot start a partial run. Document the call and hand it to Anthony. Hamza can then try a real prompt locally through his signed-in Director setup.

Follow-up generation from a branch or time checkpoint can reuse this boundary after the first prompt-to-play flow is working.

## Status

Implemented: `services/director/worlddirector/runner.py` (`prepare_scenario`, `public_error`, `RUN_FIXTURES`), the `iceland-eruption` run fixture, and `tests/director/test_runner.py`. The call, the fixture-backed path, and the error table are in the [Director README](../../services/director/README.md#prompt-to-play-prepare_scenario-dir-005). Remaining: Hamza tries a real prompt locally through his signed-in Codex.
