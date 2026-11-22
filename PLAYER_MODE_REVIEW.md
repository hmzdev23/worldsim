# Player Mode review

All outputs are fictional / SIMULATED. This records the pre-publication review on
player-mode-development. Publication was subsequently authorized on a dedicated
codex/player-mode branch. No dependencies, shared contracts, scoring formula or
scenario effects were changed during review or publication.

## What worked
The offline Player Mode engine, deterministic branching and comparison tests pass.
The pandemic health-minister playthrough reaches three cards, releases decision
stories, completes with a score and comparison, filters changes by a selected
decision, and supports confirmed rewind (desktop) and fresh retry (mobile).
Keyboard heading focus and disabled playback while a card waits are asserted.

## Findings and changes in this continuation
- The existing simulation process returned the old summary without comparison.
  The frontend crashed at completion reading comparison.headline. Restarting both
  handoff-identified demo processes loaded the current backend and resolved this.
  This prototype requires matching backend/frontend versions.
- Windows Playwright automatic startup failed on POSIX environment assignment.
  Used existing/restarted servers with E2E_PORT=3000; documented the commands.
- Visually checked 1440px and 390px captures of the card and completed summary /
  comparison. The mobile card was constrained to a small internal scroll area.
  Added a mobile-only CSS rule allowing the map/card to grow with the content.
- Extended apps/web/e2e/player-mode.spec.ts to run on both viewport projects,
  capture card/summary/comparison, assert metrics and timeline rows, select/filter
  a decision, check no page overflow or page errors, close the panel, confirm
  desktop rewind, and exercise mobile Try again.
- Updated docs/plans/player-mode.md with Alternate Timeline and summary API.
- Added docs/plans/player-mode-demo.md with the strongest verified demo flow.
- Added this review. These five files are the only source/doc files edited by
  this continuation; all other listed changes were inherited and preserved.

## Actual validation
- scripts/smoke-demo.sh through Git Bash: contracts 12, Director 101,
  simulation 97, newsroom 88, integration 10; all passed (308 total).
- npm run typecheck (tsc --noEmit): passed, including after E2E changes.
- npm run test:e2e against restarted servers: 21 passed, 11 skipped, 32 total.
  Desktop 16/16; mobile 5 passed, 11 existing desktop-only skips.
- The extended Player Mode test passes at both widths; after the mobile CSS fix: 2/2 passed (22.9s).
- git diff --check passed before the final CSS addition; final check also passed.
- Fresh browser runs reported no uncaught page errors. No hydration/caret-color
  warning appeared in the restarted dev log. The earlier extension-specific
  warning is not proven fixed or definitively attributed.
- No real model run or production build was performed.

## Scoring and approval items
The handoff reports immediate do-nothing play at 70/100 and a close-borders /
expand-testing / request-aid strategy at 63.7. Those exact strategies were not
rerun here. The verified skip / surge-capacity / public-briefing flow scores 60.2:
outcome 25.2, timeliness 20, balance 15. The table shows unchanged countries,
outbreak places and aid timing, but severity rises from 3.00 to 3.25 due to a
side effect. This makes the scoring limitation visible in the demo.

Proposal for Anthony and Mathys: approve a separate balancing exercise using a
matrix of all-do-nothing and representative action sequences. Inspect whether
positive response events and economic side effects are counted as harmful in
severity_load, and whether intended benefits occur after each trigger. Agree on
metric meaning, action timing and weights/costs before any implementation change.
Keep the current 60/20/20 formula until approval; no tuning was done here.

Mathys should review fictional effects and trade-offs. Hamza should review all web
changes, especially next.config.ts proxying, run-console alert suppression,
completion/replay behavior and the mobile card rule. Amir should review decision
and consequence copy. Anthony should review branching, comparison attribution,
score explanations and HTTP API. Contract v0.2 changes remain proposals only.

## Limits
Free text on a live model remains tested only with a stub. One player controls a
shared run; runs remain in memory with a 16-run cap. Pandemic first card is around
day 6 with seven-day gaps. Japan's five decision points remain unchanged. Browser
coverage here exercises pandemic; it does not visually certify Iceland/Japan.
The comparison is below the long news feed on mobile, reachable directly through
the completion button. Desktop summary is intentionally scrollable in the sidebar.

## Demo and launch
See docs/plans/player-mode-demo.md. Demo servers are left running on 8765 and 3000.
Use ./scripts/run-demo.sh from Git Bash when starting them afresh. For E2E, use
NEXT_PUBLIC_SIMULATION_MINUTES_PER_SECOND=60 for the frontend and E2E_PORT=3000.
Show pandemic / Regional health minister: Do nothing, Open surge hospital capacity,
Give a public briefing, then comparison metrics, decision filter and confirmed rewind.
Present the score as a game-model result and explain the balancing limitation.

## Entire inherited and final local change inventory
The status below includes the original prototype, the previous Alternate Timeline
work, and this continuation. Untracked directories contain the scenario specs.

```text
## player-mode-development
?? PLAYER_MODE_REVIEW.md
 M apps/web/app/styles.css
 M apps/web/components/run-console.tsx
 M apps/web/components/simulation.tsx
 M apps/web/lib/scenario-api.ts
 M apps/web/lib/scenario.ts
 M apps/web/next.config.ts
 M services/newsroom/worldwire/wire.py
 M services/simulation/worldsim_sim/engine.py
 M services/simulation/worldsim_sim/scenarios.py
 M services/simulation/worldsim_sim/server.py
?? apps/web/PLAYER_MODE_HANDOFF.md
?? apps/web/components/alternate-timeline.tsx
?? apps/web/components/decision-card.tsx
?? apps/web/components/player-summary.tsx
?? apps/web/e2e/player-mode.spec.ts
?? apps/web/lib/player-api.ts
?? docs/plans/player-mode-demo.md
?? docs/plans/player-mode.md
?? services/director/PLAYER_MODE_HANDOFF.md
?? services/director/fixtures/player/
?? services/director/worlddirector/player.py
?? services/newsroom/PLAYER_MODE_HANDOFF.md
?? services/simulation/PLAYER_MODE_HANDOFF.md
?? services/simulation/worldsim_sim/compare.py
?? services/simulation/worldsim_sim/player.py
?? services/simulation/worldsim_sim/scoring.py
?? tests/director/test_player_catalogue.py
?? tests/newsroom/test_player_decisions.py
?? tests/simulation/test_player.py
?? tests/simulation/test_player_compare.py
```


## Publication verification
The publication run repeated smoke-demo.sh (308 passed), TypeScript (passed),
and the full browser suite (21 passed, 11 existing skips, 54.3s).
Fetched main advanced from eca577c to 95db799 by five commits adding only recap
and video-prototype files. There is no overlap with this feature's paths; those
unrelated changes are excluded from this commit. PR #79 is still open and changes
map/playback UI; coordinate run-console/simulation/styles integration when it lands.
All 34 Player Mode files were reviewed and checked for credential patterns;
local environments, caches, screenshots and scratch scripts are excluded.
The original checkout's uncommitted file contents are preserved.
