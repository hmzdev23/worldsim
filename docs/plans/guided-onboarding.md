# Guided demo onboarding

The landing page now asks for one action: Start playing. It shows no prompt form,
scenario wall or running console. The guided route is:

1. Choose a crisis from ten compact cards. Only the selected premise is expanded.
2. Choose a role from five mandate cards. No role is silently selected when changing crises.
3. Review the mission, a three-part how-to and presentation length preference.
4. Begin simulation starts the run automatically when its stream is ready.

Back preserves selections; changing a scenario clears incompatible role choices.
Heading focus follows setup steps for keyboard/screen-reader users. Preparation
errors retain the briefing for retry. The quick-demo link opens Alien Invasion /
International diplomat at the briefing, with all selections visible before launch.

Quick presentation uses existing Normal news dwell with 4x simulation progression;
Take your time uses 1x. Presentation pace remains separately adjustable under Pace
settings. The opening report is allowed to finish before the clock progresses.
During play the library and prompt disappear. A compact mission strip, dismissible
one-line coach and New game control replace them. Different-role replay opens the
role step; scenario selection opens the scenario step. Leaving a mounted console
pauses its stream before closing the connection, preserving the existing run.

Watch a simulation and Create your own scenario remain explicit secondary entries
on the welcome page. The custom generation form and passive Japan demo retain
existing controls. The development badge is hidden using Next's documented
`devIndicators: false`; compile/runtime errors still surface normally.

No backend, fixture, effect, scoring, contract or dependency changes are involved.
Development is local on codex/guided-onboarding, based on gameplay PR #82.

## Presenter walkthrough
Open the home page fresh. Say: "You step into a role inside a fictional crisis."
Click Start playing, select Alien Invasion, choose International diplomat, and
review the briefing. Click Begin simulation once. The map/news begin; at each
critical moment, the clock pauses and the player makes a call. Finish with the
score and Alternate Timeline. Use Quick demo: first contact if presentation time
is tight. Use Pace settings / Fast only when you deliberately want to rush news.

## Verification
Browser coverage includes welcome isolation, selection gating, retained Back
choices, role reset after scenario changes, keyboard-only setup, single-click
start, preparation failure/retry, the quick demo and existing complete playthroughs.
Passive/custom regressions now enter through the actual Watch a simulation button.
Final verification: npm run typecheck passed; E2E_PORT=3000 npm run test:e2e
completed with 32 passed and 16 intentional skips (48 total, 2.5 minutes).
Desktop: 24 passed; mobile: 8 passed. Full playthroughs retain comparison, news
order/history, confirmed rewind and retry coverage. Visually checked welcome,
scenario, role and briefing screens at desktop/mobile, with the 768px flow
covered by the Alien Invasion playthrough. git diff --check passed. No backend
tests were rerun for this UI-only change; backend/contracts have no diff.
