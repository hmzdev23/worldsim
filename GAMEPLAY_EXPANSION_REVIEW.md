# WORLD//SIM gameplay expansion review

## Before and repository state
Player Mode and Alternate Timeline were already implemented in PR #80, still open
at the audit. They were not assumed to be merged into main. The clean development
worktree was on codex/player-mode at 958f911; origin/main was 95db799 with unrelated
recap additions. A new local branch, codex/gameplay-expansion, extends that feature.
This report first recorded local development. Publication was subsequently
authorized on codex/gameplay-expansion; the original checkout and its existing
uncommitted files remain preserved. No merge is authorized.

The prior system had three playable fixtures, two or three roles each, HTTP-polled
decisions, branch isolation, deterministic 60/20/20 scoring, no-action baselines,
news templates and the comparison UI. The existing map, newsroom, Director and
engine are reused rather than replaced.

## Implemented
- Exactly ten offline playable scenarios and five roles per scenario (50 total).
  The original earthquake, Iceland volcano and pandemic fixtures are reused.
- Seven new thirteen-event causal chains, each with an introduction, grounded
  report locations, three service-pressure decisions, consequences and conclusion.
- Role mandates, responsibilities, metric emphasis and exclusive role policies.
  Added policies use the existing deterministic severity/shift/consequence system.
  Original role IDs and all original action objects are preserved verbatim.
- Scenario cards, role cards, accessible selects and mission briefing. The library
  collapses during gameplay and reopens for a different role or scenario. Custom
  model-prompt generation and passive playback remain available.
- Presentation controls: Cinematic, Normal, Fast, Hold to read and Advance story.
  News is queued in canonical order with complete released history, no lost reports,
  decision priority and end-summary gating until presentation drains.
- Current crisis phase, progress, simulated time and a description drawn from an
  actually released event. No future phase descriptions are displayed.
- Selected news and map markers are synchronized. Auto-follow groups repeated
  locations, suspends for 20 seconds after manual input, and can be toggled or
  immediately resumed. Fast mode skips flights; Advance stops a flight. Reduced
  motion uses instant movement. Explicit history clicks retain worldsim:focus.
- Decision-required announcement, contextual role responsibility, strategy-card
  controls, keyboard focus, indefinite reading and existing bounded deferrals.
- Score explanations, chronological decisions with role labels, baseline tables,
  Alternate Timeline, same-role retry, different-role and scenario-selection routes.
- Tablet layouts stack the inspector below the map to keep score explanations
  readable. Mobile decisions expand with content; news history has a scroll area.

## Scenario and role validation
Every listed role was launched through the real HTTP API and completed through
the real PlayerSession/Simulation with a score and comparison. For each role the
suite completes one no-action run and two identical intervention runs (150 complete
runs), checks three options and at least three decisions, and compares deterministic
results. It also tries each role's first-card options individually (150 forks).
These are not claims based solely on fixture presence. Browser coverage is stated
separately below. Japan intentionally retains its five baseline decisions.

| Scenario | Playable roles | Baseline decisions | Roles validated through launch + end summary | Browser validation |
| --- | --- | --- | --- | --- |
| Tsunami | National crisis coordinator; City mayor; Hospital director; Humanitarian aid director; Infrastructure minister | 3-3 | 5/5 | 390px (mayor) |
| Volcanic Eruption | National crisis coordinator; Aid agency director; Volcanologist; Transport minister; Hospital director | 3-3 | 5/5 | Engine + HTTP; no dedicated visual playthrough |
| Earthquake | National crisis coordinator; Aid agency director; City mayor; Hospital director; Infrastructure minister | 5-5 | 5/5 | Engine + HTTP; no dedicated visual playthrough |
| Nuclear War | National crisis coordinator; International diplomat; Emergency shelter coordinator; Hospital director; Humanitarian aid director | 3-3 | 5/5 | Engine + HTTP; no dedicated visual playthrough |
| Global Pandemic | Regional health minister; National crisis coordinator; Aid agency director; Hospital director; Economic policy minister | 3-3 | 5/5 | 1440px (hospital) + legacy desktop/mobile health-minister flow |
| Zombie Outbreak | City mayor; National crisis coordinator; Hospital director; Emergency shelter coordinator; Humanitarian aid director | 3-3 | 5/5 | Engine + HTTP; no dedicated visual playthrough |
| Alien Invasion | International diplomat; Scientific research director; National crisis coordinator; Humanitarian aid director; Emergency communications director | 3-3 | 5/5 | 768px (diplomat) |
| Sun Disappearing | National crisis coordinator; Energy minister; Scientific research director; Food security director; Emergency shelter coordinator | 3-3 | 5/5 | Engine + HTTP; no dedicated visual playthrough |
| Giant Insect Mutation | Scientific research director; City mayor; National crisis coordinator; Environmental minister; Humanitarian aid director | 3-3 | 5/5 | Engine + HTTP; no dedicated visual playthrough |
| AI Takeover | National digital policy minister; Infrastructure minister; AI safety research director; International diplomat; Emergency communications director | 3-3 | 5/5 | Engine + HTTP; no dedicated visual playthrough |

The sample round-robin action sequence is a coverage policy, not a recommended
strategy or a proof of optimal balance. Each scenario's immediate no-action run
scores exactly 70 (30 outcome + 20 timeliness + 20 balance).

## Architecture and API additions
No shared contract file changed. No new HTTP route or stream message type was
needed. GET /player/scenarios adds display_title, category, icon, briefing, outcome
labels and role responsibility/perspective/emphasis metadata. Existing keys remain.
GET /scenarios/{id}/player adds phase and richer role metadata. Summary/comparison
and v0.1 stream envelopes remain compatible.

Player runs use 60 simulation clock beats per original scenario span; watch mode
retains its existing clock pace. Original event timestamps are unchanged. Normal
presentation holds roughly four seconds between beats, with 3.5-second minor and
5.5-second major news cards; Cinematic uses six-second beats and longer cards.
Fast removes beat holds and reduces card dwell. Simulation 1x/2x/4x remains a
separate control. The frontend uses pause/play to hold progression between beats;
presentation waits do not add simulated minutes or alter timeliness scores.
At 1x, 60 beats plus reading aim for roughly 5–10 minutes; this is an estimated
design target, not a measured duration guarantee for every branch or reading speed.

Mitigating a formerly severe event no longer silently removes its decision: the
same existing event opens a response review labelled pressure reduced. Its actual
severity is shown. This preserves at least three normal decision opportunities
without inventing filler events, moving event timestamps or changing action effects.
Dropped events remain absent. This semantic change needs the owner's review.

The presentation scheduler cancels cosmetic timers at snapshot boundaries, keeps
released backlog across branch forks, enqueues the new decision story, and clears
backlog on seeks/reconnects. HTTP refresh serials discard stale responses. A
finish-state race was fixed so draining the news cannot restart an ended clock.
Decision cards suppress headline overlays and camera changes caused by history
selection. No focus is stolen by cosmetic news updates.

New UI files: scenario-library.tsx, presentation-controls.tsx and lib/presentation.ts.
No separate backend engine or dependency was introduced. Existing catalogue,
runner, session and registry modules gained metadata and presentation configuration.

## Actual validation
- Git Bash: ./scripts/smoke-demo.sh: contracts 12, Director 101, simulation 102,
  newsroom 88, integration 10; **313 passed**, including final geography checks.
- apps/web: npm run typecheck (tsc --noEmit): **passed**.
- apps/web, E2E_PORT=3000: npm run test:e2e: **26 passed, 16 intentionally skipped,
  42 total (2.5m)** after the final responsive and geography corrections.
  Desktop 21/21; mobile 5 passed and 16 skipped. Five expansion cases run in the
  desktop project with explicit 1440/768/390 widths and skip duplicate mobile
  executions; eleven existing desktop-only cases also retain their mobile skips.
- The five backend expansion methods cover 50 HTTP role launches, 150 complete
  baseline/repeated-policy runs, 150 first-card forks, exact catalogue size,
  original-parent/baseline isolation and new-city reporting coordinates.
- Complete browser runs: pandemic/hospital director at 1440; alien invasion/diplomat
  at 768; tsunami/mayor at 390. Legacy health-minister flows run on desktop/mobile,
  including summary filtering, confirmed rewind and fresh retry.
- Presentation assertions compare every presented report with the real news
  endpoint, enforce timestamp order, decision precedence, focus and complete
  history. Normal-speed timing verifies clock holds, hold-to-read, continue,
  skip and pause. Auto-follow toggling/manual suspension, history clicks,
  missing geography and reduced motion are exercised. Passive simulation and
  custom-generation regressions pass.
- Visually inspected library, decisions and results at 1440/768/390. Tablet score
  clipping was corrected by stacking the inspector; the final 768 capture was
  rechecked. Mobile cards expand and full news remains in a scrollable history.
- After replacing internal new-policy codes with human-readable labels, the full
  313-test backend suite passed again and the complete Alien Invasion browser
  playthrough passed again. No effects or scoring changed for that display fix.
- Original action objects and dependent-variable definitions were compared against
  the base commit and remain unchanged. Scoring.py, contracts, dependencies and
  recap/video paths are unchanged. git diff --check passed.
- The original checkout's status and hashes of all 29 uncommitted files match the
  pre-expansion snapshot. At the end of local validation, HEAD was 958f911 and the expansion was uncommitted.

## Known limits and items for team approval
- Scoring balance remains a real concern. In sampled round-robin policies many
  intervention runs score below no-action's 70. Side-effect severity and balance
  costs both affect the result; some late actions mainly add consequences because
  their target events have already occurred. No formula or original effect was
  tuned to hide this. Proposed follow-up: approve a separate policy matrix and
  examine metric semantics, late-action applicability and cost calibration before
  changing existing weights, definitions or effects. Role emphasis is explanatory,
  not a separate role-weighted score.
- New scenario outcomes and policies are authored fictional game rules, never
  validated forecasts. Mathys should review all seven chains, new role policies
  and fantastical wording. Nuclear exchange locations are unspecified: the map
  marker is explicitly a humanitarian reporting hub, not an invented strike site.
  High-risk role choices are civilian, governance and humanitarian policies.
- Free text remains recorded but not simulated offline; live model continuation
  remains stub-tested. No real model/API was used for this expansion.
- One shared player/run and in-memory 16-run limit remain. Multiple viewers
  issuing controls are not a supported multiplayer experience. A normal-speed
  tab participates in pacing through the existing pause/play API.
- Reading durations and the 5–10-minute target require human playtesting; automated
  full playthroughs use Fast. The Normal timing test checks actual holds and pause.
- Satellite imagery uses the existing external tiles. Offline fixtures, decisions,
  news and scoring need no model or paid API; imagery availability still depends
  on tile access. Missing geographic data is ignored by the map, not invented.
- Seven scenarios have HTTP + engine coverage across all roles but no dedicated
  complete browser recording. There was no production build or real-model test.
- Hamza should review presentation scheduling, map gestures, selection/results
  layouts and the overlap with open PR #79. Anthony should review the response-
  review trigger rule and 60-beat configuration; Amir should review new event copy
  as rendered by existing newsroom templates. No recap/video files changed.

## Run and demo
From Git Bash in this development worktree:

```sh
./scripts/run-demo.sh
```

The existing development servers may already occupy 8765 and 3000. Use
http://127.0.0.1:3000. Expand Play a role, choose Alien Invasion and International
diplomat, read the mission, then Play this role and Play. Normal is the default;
choose Fast for a short walkthrough. Show the headline moving from Nairobi to
Cairo to Rome, hold to read, demonstrate manual map suspension and re-enable
Auto-follow. Answer three cards, open the comparison, select/filter a decision,
then try a different role. Repeat as Scientific research director for other policies.

On Windows, the Playwright config's automatic startup uses POSIX syntax. Start
./scripts/run-simulation-server.sh in Git Bash, start the web server in PowerShell
with NEXT_PUBLIC_SIMULATION_MINUTES_PER_SECOND=60, and run in apps/web:

```powershell
$env:E2E_PORT='3000'
npm run typecheck
npm run test:e2e
```

## Exact files modified by this expansion

47 files: 26 modified tracked files; remaining files are new and untracked. This inventory was captured before the authorized publication commit.

- `GAMEPLAY_EXPANSION_REVIEW.md`
- `README.md`
- `apps/web/PLAYER_MODE_HANDOFF.md`
- `apps/web/app/styles.css`
- `apps/web/components/decision-card.tsx`
- `apps/web/components/headline-alert.tsx`
- `apps/web/components/player-summary.tsx`
- `apps/web/components/presentation-controls.tsx`
- `apps/web/components/run-console.tsx`
- `apps/web/components/scenario-library.tsx`
- `apps/web/components/simulation.tsx`
- `apps/web/components/world-map.tsx`
- `apps/web/components/world-wire.tsx`
- `apps/web/e2e/earthquake-demo.spec.ts`
- `apps/web/e2e/gameplay-expansion.spec.ts`
- `apps/web/e2e/player-mode.spec.ts`
- `apps/web/lib/player-api.ts`
- `apps/web/lib/presentation.ts`
- `apps/web/lib/scenario.ts`
- `docs/plans/gameplay-expansion.md`
- `services/director/PLAYER_MODE_HANDOFF.md`
- `services/director/fixtures/ai-takeover.json`
- `services/director/fixtures/alien-invasion.json`
- `services/director/fixtures/giant-insect-mutation.json`
- `services/director/fixtures/nuclear-war.json`
- `services/director/fixtures/player/ai-takeover.json`
- `services/director/fixtures/player/alien-invasion.json`
- `services/director/fixtures/player/giant-insect-mutation.json`
- `services/director/fixtures/player/global-pandemic.json`
- `services/director/fixtures/player/iceland-eruption.json`
- `services/director/fixtures/player/japan-earthquake.json`
- `services/director/fixtures/player/nuclear-war.json`
- `services/director/fixtures/player/sun-disappearing.json`
- `services/director/fixtures/player/tsunami.json`
- `services/director/fixtures/player/zombie-outbreak.json`
- `services/director/fixtures/sun-disappearing.json`
- `services/director/fixtures/tsunami.json`
- `services/director/fixtures/zombie-outbreak.json`
- `services/director/worlddirector/player.py`
- `services/director/worlddirector/runner.py`
- `services/newsroom/PLAYER_MODE_HANDOFF.md`
- `services/simulation/PLAYER_MODE_HANDOFF.md`
- `services/simulation/worldsim_sim/player.py`
- `services/simulation/worldsim_sim/scenarios.py`
- `tests/director/test_player_catalogue.py`
- `tests/simulation/test_gameplay_expansion.py`
- `tests/simulation/test_player.py`


## Publication and dependency review
Publication checks confirmed origin is https://github.com/hmzdev23/worldsim.git.
PR #80 remains open and unmerged at 958f911, the exact parent of this expansion.
The requested PR targets main and therefore includes the base Player Mode work.
Merge #80 first. To isolate the expansion diff during review, temporarily target
codex/player-mode; after #80 lands, restore main as the target. This publication
does not merge, force-push or modify #80.

The latest team note says PR #79 now incorporates #80 and adds a combined chooser
plus tsunami/Vesuvius player specs. It is a parallel integration consideration:
reconcile chooser/playback behavior, fixture registration and overlapping scenario
specs before combining #79 with this expansion. No changes from #79 or unrelated
recap/video branches are included here. Main at 95db799 has only unrelated recap
additions since the original base; integration against main is checked separately.

All 47 expansion files were reviewed and scanned for credential patterns; no
matches were found. Original action objects and dependent variables, scoring.py,
shared contracts, dependencies and the original checkout were verified preserved.

Publication rerun: smoke-demo.sh passed contracts 12, Director 101, simulation 102, newsroom 88 and integration 10 (313 total). TypeScript passed; browser results are recorded in the PR description.
