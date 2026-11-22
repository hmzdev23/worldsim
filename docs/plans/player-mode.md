# Player mode: design note (prototype, uncommitted)

**Status:** a working prototype in the local working tree, for review. Nothing is committed, and nothing here is approved yet. Contracts are unchanged (v0.1).

## What it is
The player picks a fictional role, such as regional health minister, national crisis coordinator or aid agency director, and plays an offline scenario.

1. Events arrive on the simulation clock.
2. When an event matches a trigger rule, the clock stops on that event's minute and a decision card opens.
3. Choosing an action forks a new branch of the run at that minute. The decision becomes an event, and the future is rewritten by that action's canned effects.
4. At the end the player gets a deterministic score and a plain-language summary.

Everything is labelled simulated. Roles and actions are fictional, high-level policy choices.

## Scenario variables (the optional spec)
The spec lives in `services/director/fixtures/player/<fixture>.json`. A scenario without one is unchanged, which covers every existing fixture and the Japan demo. `generic.json` covers model runs.

| Kind | What it holds | Example (pandemic) |
| --- | --- | --- |
| Fixed | Premises that never change | place, hazard, start, baseline population |
| Independent | What the player controls: name, `options` or `range`, `default`. Actions set them with `sets`. | `border_policy` (`open`/`screening`/`closed`), `relief_budget_musd` (0–500) |
| Dependent | Outcomes the score reads: `measure`, `better` (lower or higher), `scale` (the relative change that earns full credit), `weight` | countries affected, places with outbreaks, overall severity, time to first aid |

**Measures:**
- `affected_countries`
- `peak_severity`
- `severity_load` (the sum of hazard severities)
- `outbreak_places`
- `time_to_first_aid`
- `impact` (a `payload.impacts` key from the last estimate)

**Triggers:**
- Rule kinds: `severity` (≥ `at_least`), `new_region` (first event in a new country), `new_outbreak_place`, and `event_type`.
- `min_gap_minutes` (or `min_gap_fraction` of the run's span) sets the minimum time between cards.
- `defer_minutes` (or `defer_fraction`) sets how long "Decide later" waits. `max_deferrals` is 2.

**Actions:**
- Each action lists the roles that may choose it, the trigger types it answers (`*` for any), a one-line trade-off, a `cost` (used for balance), the intervention event type, and `effects`.
- Effects are the canned branch fixtures:
  - `severity_scale` and `impacts_scale`
  - `drop` the next N events of a type (their children inherit the dropped event's parents)
  - `shift` a type earlier or later (never before a parent or before the decision)
  - `consequences`: new events at decision + `after_minutes`, marked `benefit` or `side_effect`

## Decision flow
1. **Trigger.** The engine has a one-shot `stop_minute` breakpoint, so the clock stops exactly on the trigger event's minute, at least the minimum gap after the previous card.
2. **Card.** It shows:
   - the triggering event (its WORLD//WIRE headline);
   - a situation summary built only from released events;
   - three catalogue options (specific matches first) plus "Do nothing";
   - "Decide later";
   - a free-text box.
3. **The player's answer** goes to `POST /scenarios/{id}/decisions` as `{decision_id, option_id | free_text, at_minutes}`:
   - **An action** forks branch `b1`, `b2`, … The past is copied, the decision is an applied event (`evt-dN`, `provenance.source: "user"`, `payload.decision`), and the future is rewritten. Consequences are `evt-dN-cK` events with `source: "numeric"` and the decision as their parent. The parent branch is never changed.
   - **Do nothing**, which is also the "skip", is logged with no fork.
   - **Free text** goes through the Director's prompt checks, plus a refusal of operational instructions. Offline it's logged as "not simulated offline" and scored as do nothing. On a model run, the Director continues from the run's history and the branch is built from that continuation.
   - **Decide later** resumes playback for `defer_minutes` of simulated time, at most twice. When the second deferral runs out, the point resolves to do nothing.
   - **Refusals:** a second decision at the same minute, or one not at the current minute, gets a 409.
4. **Seeking back** past a decision needs `void_decisions: true` (the web asks first). It voids that decision and every later one, and returns to the branch that was active then. "Branch from a decision" re-opens a decision the same way.

## Scoring (server, deterministic, no model)
- **Outcome, up to 60.** The dependent variables at the end of the player's branch against the cached no-action baseline. Doing nothing scores 30.
- **Timeliness, up to 20.** Simulated minutes from each trigger to the response, where deferrals count. Full credit for an immediate answer, none after two deferrals. A point that runs out of time scores 0.
- **Balance, up to 20.** Minus each chosen action's cost. Repeating the same action costs 1.5×.
- The UI always shows the components, each with a text explanation. The same fixture and decision log always give the same score.

## API (simulation service)
| Route | Purpose |
| --- | --- |
| `GET /player/scenarios` | playable fixtures and their roles |
| `POST /scenarios` | adds `"mode": "player", "role"` (422 without a spec or with an unknown role) |
| `GET /scenarios/{id}/player` | the pending card, decision log, variables and active branch |
| `POST /scenarios/{id}/decisions` | answer a card |
| `POST /scenarios/{id}/decisions/{d}/branch` | re-open decision `d` |
| `GET /scenarios/{id}/summary` | score, components, decision timeline, templated paragraph, baseline table and `comparison` |
| `POST /scenarios/{id}/control` | seek and replay honour `void_decisions`, and `play` is refused while a card waits |

## Contracts
**No v0.1 changes.** A decision is an existing event type with `provenance.source: "user"` and `payload.decision` (payload is open). The pending state is polled over HTTP.

**Proposed v0.2 additions, for the team to approve later:**
1. An `intervention` event type and a `player_decision` visual, so decisions don't borrow `government_response` and `evacuation`.
2. A `decision` stream message kind (`{kind: "decision", pending}`), to replace polling.
3. Optionally, `branch_parent` and `forked_at` on the batch header, so a branch's lineage travels with it.

## Files (all uncommitted)
| Owner | Files |
| --- | --- |
| Simulation (Anthony) | `worldsim_sim/player.py` and `worldsim_sim/scoring.py` (new); `engine.py` (`stop_minute`); `scenarios.py` (player runs, catalogue adapter); `server.py` (routes); `tests/simulation/test_player.py` |
| Director (Mathys) | `worlddirector/player.py` (new); `fixtures/player/{global-pandemic,iceland-eruption,japan-earthquake,generic}.json` (new); `tests/director/test_player_catalogue.py` |
| Newsroom (Amir) | `worldwire/wire.py` (decision story, "Follows the decision to …"); `tests/newsroom/test_player_decisions.py` |
| Web (Hamza) | `components/decision-card.tsx` and `components/player-summary.tsx` (new); `lib/player-api.ts` (new); `components/run-console.tsx`; `components/simulation.tsx`; `lib/scenario.ts`; `lib/scenario-api.ts`; `app/styles.css`; `next.config.ts` (proxy `/api/simulation/player/*`); `e2e/player-mode.spec.ts` |

Each folder has a `PLAYER_MODE_HANDOFF.md` for its owner.

## Known limits
- **Effects are a fictional model, not predictions.** They're canned per action and tuned so trade-offs show up. For example, closing borders prevents an outbreak but adds an economic shock and unrest.
- **The pandemic fixture has no impact figures**, so its outcomes come from the events themselves: countries, outbreak places, overall severity and aid timing.
- **Free text is not simulated offline.** The model path is tested with a stub continuation only.
- **Playback is single-player.** Every viewer of a run sees the same branch.
- **Run limits:** runs are in memory, and the 16-run limit applies.


## Alternate Timeline
The completed run exposes an additive `comparison` object on `GET /scenarios/{id}/summary`.
Timeline A reads the unchanged main segment (no intervention); B reads the active branch.
The response includes initial conditions and a shared-history check, outcome metrics with
formatted differences, policy settings, decisions and event rows. Rows distinguish same,
changed, prevented, benefit, side_effect, added and decision. Attribution compares each
recorded branch with its parent within this fictional model. It does not imply real-world causality.

The web completion banner opens the comparison. Select a decision to highlight its rows,
optionally filter to those rows, or branch from that decision. Mobile stacks A and B with
explicit labels. Tables provide the numeric text alternative. Back to the map closes the
panel; Try again starts a fresh run with the same scenario and role.

Development note: restart the simulation server after changing the summary response.
An older running backend lacks `comparison` and is incompatible with this prototype UI.
