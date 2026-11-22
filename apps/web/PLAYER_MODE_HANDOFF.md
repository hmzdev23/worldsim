# Player mode handoff: web console (Hamza)

This is a prototype for team review, written by Anthony's agent in your folder. Design: [docs/plans/player-mode.md](../../docs/plans/player-mode.md).

## What changed
- **New `lib/player-api.ts`:** the typed client for `/player/scenarios`, `/scenarios/{id}/player`, `/decisions`, `/decisions/{d}/branch`, `/summary` and HTTP `/control`.
- **New `components/decision-card.tsx`:**
  - Shows the trigger headline, the rule, a situation summary from past events only, three options plus "Do nothing", "Decide later (N left)" and a free-text box with its offline note.
  - Focus moves to the card's heading when it opens.
  - A deferred card collapses to a "Decide now" bar.
- **New `components/player-summary.tsx`:**
  - The score, with a components table that is the chart's text alternative.
  - The templated paragraph.
  - A decision timeline, with "Branch from this decision" on each entry.
  - A table comparing the run with doing nothing, and "Try again".
- **`components/run-console.tsx`:**
  - Polls the player state every 500 ms (no stream contract change).
  - Accepts branch switches for the same run (`sameRunOrBranch`).
  - Seeks over HTTP and asks with `window.confirm` before voiding decisions.
  - Pauses before deciding on a deferred card.
  - Disables Play while a card waits, and holds headline alerts back until the card is answered.
- **`components/simulation.tsx`:** a "Play a role" picker (scenario, role, "Play this role") and a `Try again` restart.
- **`lib/scenario.ts` and `lib/scenario-api.ts`:**
  - `ScenarioRun.player` and `sameRunOrBranch`.
  - `prepareScenario(..., player)` sends `mode`/`role`/`fixture`.
  - News matches any branch of a player run.
- **`app/styles.css`:** player styles, appended in their own section using your tokens.
- **`next.config.ts`:** proxies `/api/simulation/player/*`.

## Accessibility
- Every control is a real button, select or textarea.
- The card is a labelled, non-modal dialog.
- The summary's chart has a table alternative.
- Motion follows reduced motion through the existing `MotionConfig`.

## Tests
- `e2e/player-mode.spec.ts` runs against the real offline server:
  - pandemic as health minister: one skip, two decisions;
  - the WORLD//WIRE decision story;
  - the summary (components, timeline, baseline, buttons);
  - a confirmed seek back that voids the decisions.
- The whole desktop suite passes (16/16).

## Please review
- Where the card sits over the map; it currently hides the headline alert while it waits.
- Whether to replace polling with a `decision` stream message (a proposed v0.2 contract change).
