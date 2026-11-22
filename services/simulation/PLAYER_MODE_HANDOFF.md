# Player mode handoff: simulation (Anthony)

This is a prototype for team review. Design: [docs/plans/player-mode.md](../../docs/plans/player-mode.md).

## What changed
- **`engine.py`:**
  - New `stop_minute` (a one-shot breakpoint) and `halted`.
  - When playing, the clock stops on `stop_minute` exactly like the end clamp, pauses, and sets `halted`.
  - Everything else is unchanged. The existing 66 tests still pass, and the engine is still pure.
- **`player.py`** (new): `PlayerSession`.
  - Trigger rules and the minimum gap.
  - `arm()` before each tick sets the breakpoint; `after_advance()` after it opens a card, re-shows a deferred one, or auto-resolves.
  - Decisions: an action, do nothing, free text, or decide later. An action forks branch `bN` using `apply_effects`, which is pure.
  - Seek and replay voiding, `branch_from`, and the state view.
- **`scoring.py`** (new): outcome / timeliness / balance, the decision timeline (helped or hurt, measured against the parent branch), the templated paragraph and the baseline table.
- **`scenarios.py`:**
  - `Run.mode` and `Run.role`.
  - `Channel.controller` (the session).
  - `Catalogue` adapter over `worlddirector.player`.
  - Player runs are checked at creation, and the session is built once the run is ready.
  - Run status reports the active `branch_id` and `mode`.
- **`server.py`:**
  - The ticker calls `arm()` / `after_advance()` for player runs.
  - Controls go through `PlayerSession.control` (a 409 with `voids` unless `void_decisions: true`, and play is refused while a card waits).
  - New routes: `/player/scenarios`, `/scenarios/{id}/player`, `/decisions`, `/decisions/{d}/branch`, `/summary`.

## Why this way
- **The parent run is never changed.** Each decision builds a fresh `Simulation` from the parent's past, the decision event and the rewritten future, and keeps every segment.
- **Determinism.** Triggers, effects and scores depend only on the fixture and the decision log, in simulated minutes.
- **No contract change.** Decisions are events with `provenance.source: "user"`, and pending state is polled over HTTP.

## Tests
`tests/simulation/test_player.py` (19 tests):
- cards and the minimum gap; options for every trigger type
- forking without touching the parent; refusing two decisions at the same minute
- bounded deferral and auto do-nothing
- free text offline and on the model path (stub)
- seek voiding with confirmation; branch from a decision
- the same log giving the same score, with component values
- the HTTP flow

## To decide
- Whether to keep voided segments in memory (they are now, for review).
- Whether free text on model runs should run in the background, with a stage, instead of inside the request.


## Local gameplay expansion
PlayerSession now exposes released-event phases and role responsibilities. Mitigated critical events remain response-review decisions. Player runs use 60 beats; watch pacing and scoring.py are unchanged. All 50 roles have engine and HTTP coverage. See ../../GAMEPLAY_EXPANSION_REVIEW.md. This expansion is uncommitted on codex/gameplay-expansion.
