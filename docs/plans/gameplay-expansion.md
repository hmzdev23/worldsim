# Gameplay expansion implementation notes

Base: Player Mode PR #80 (not merged during audit). Local branch:
codex/gameplay-expansion. Contracts, dependencies, scoring formulas and existing
action effects are preserved. Recap work is outside scope.

1. Extend the catalogue with seven connected offline event fixtures, role mandates,
   distinct policies, mission metadata and event-derived phases.
2. Validate every scenario/role through the session and HTTP launch pathway.
3. Separate presentation from simulated minutes. Player runs use 60 beats per
   original span; web holds between beats and queues reports. Decisions win.
4. Synchronize news with map focus; suspend auto-follow on manual map input,
   respect reduced motion and clear cosmetic state on seek/branch/reconnect.
5. Upgrade launch/role briefing, decisions, current phase and replay links.
6. Run backend, TypeScript, regression E2E and full playthroughs across three widths.

Role emphasis is presentation-only: dependent variables and scoring remain
scenario-wide. New roles add policies; existing action definitions are retained.


## Extending a scenario
The raw event chain lives in services/director/fixtures/<slug>.json and goes
through the existing Director validator/normalizer. Its player spec lives in
fixtures/player/<slug>.json. Register new offline slugs in runner.RUN_FIXTURES.
Keep the catalogue at ten entries for this release. Each role needs a mandate,
three relevant options at every normal trigger, permitted independent values,
and existing v0.1 event/visual types. Do not put presentation-only events in the
simulation. Phase summaries are drawn from released events at read time.

Run tests/simulation/test_gameplay_expansion.py to exercise the real catalogue,
50 HTTP launches, baseline and intervention completions, replay determinism,
immutable parent/baseline, and geography. Extend the explicit viewport scenarios
in apps/web/e2e/gameplay-expansion.spec.ts for future presentation changes.

Normal pacing uses 60 original-span clock beats with frontend reading holds;
watch mode is unchanged. Cinematic/Normal/Fast changes cosmetic waits, not event
minutes, action effects or score weights. Decisions always preempt presentation.
A reduced-severity critical event still opens a response-review decision using
its baseline identity, with a pressure-reduced label and actual current context.
See GAMEPLAY_EXPANSION_REVIEW.md for the validated matrix, limits and test results.
