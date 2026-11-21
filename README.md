# WORLD//SIM

Describe a hypothetical crisis, watch it unfold on an animated world map, and follow the response through the fictional **WORLD//WIRE** news feed.

## Start here

Already working? Open [TEAM-SYNC.md](TEAM-SYNC.md) and the
[live team thread](https://github.com/hmzdev23/worldsim/issues/13) before continuing.

### 1. Accept your GitHub invitation

Open the [WORLD//SIM invitation](https://github.com/hmzdev23/worldsim/invitations) while signed in to the GitHub account Hamza invited. Once you accept, confirm you can open the [private repository](https://github.com/hmzdev23/worldsim).

### 2. Open your coding agent

Hamza uses Codex. Mathys, Anthony, and Amir can use Claude Code or their own coding agents.
Running the Japan earthquake demo does not require Codex or a model login.

- **Already have WORLD//SIM open locally?** Use that folder in your coding AI and go straight to step 3.
- **Only have GitHub open in a browser?** Open your coding AI in the folder where you keep your projects. The prompt below tells it to clone the repo for you.

### 3. Pick your task by name

All four assigned demo tasks are complete and their issues are closed.
Do not restart them. Check the [open GitHub issues](https://github.com/hmzdev23/worldsim/issues)
for the next task before coding.

| Team member | Status | Completed work |
| --- | --- | --- |
| Mathys | **DONE** | [#26](https://github.com/hmzdev23/worldsim/issues/26) · [PR #36](https://github.com/hmzdev23/worldsim/pull/36) |
| Hamza | **DONE** | [#29](https://github.com/hmzdev23/worldsim/issues/29) · [PRs #32 and #36](https://github.com/hmzdev23/worldsim/pull/32) |
| Anthony | **DONE** | [#27](https://github.com/hmzdev23/worldsim/issues/27) · [PR #31](https://github.com/hmzdev23/worldsim/pull/31) |
| Amir | **DONE** | [#28](https://github.com/hmzdev23/worldsim/issues/28) · [PRs #33 and #35](https://github.com/hmzdev23/worldsim/pull/33) |

**Before starting any task**, check the live GitHub issue state. If closed, do
not repeat the work; find an open issue or ask Hamza to assign the next task.
Nobody needs to install Codex or provide an API key for the deterministic demo.

For a newly assigned issue, tell your coding agent:

```text
I'm [NAME], working on WORLD//SIM issue #[NUMBER].
Repo: https://github.com/hmzdev23/worldsim
Check that my issue is OPEN before editing. Read README.md, AGENTS.md,
TEAM-SYNC.md, the full issue, and recent comments in issue #13. If closed,
stop and report its merged PR instead of repeating the work. Otherwise, work
only on that issue, branch from latest main, and preserve local changes.
Keep shared code reusable for arbitrary scenarios; use local fixtures for
offline checks. No Codex install, model, API credits, or credentials. Open a
PR linked to the issue, using `Closes #N` only if all acceptance criteria are
complete; for partial work use `Refs #N` and document what remains. After
merge, verify GitHub closed the issue if the work is complete.
```

## First demo

Japan is the deterministic proof-of-concept, not the product boundary. The
finished product must support arbitrary user-prompted scenarios through shared
event types and generic consumers. Impact values in the Japan fixture are
fictional cumulative estimates, not real forecasts or historical counts.

The [master brief](WORLDSIM_MASTER_BRIEF.md) records the original design.
This README and the GitHub issues define current ownership and status.

## First demo

Japan is the first deterministic proof-of-concept scenario, not the
product boundary. Use it to validate a reusable event pipeline: hazards
produce consequences, the simulation applies events over time, and the
map, impact dashboard, timeline, and WORLD//WIRE update from that same
state. The finished product must support arbitrary user-prompted
scenarios through shared event types and generic consumers, not
Japan-specific logic. Japan fixture impact values are fictional
scenario estimates, not real forecasts or historical counts.

The [master brief](WORLDSIM_MASTER_BRIEF.md) records the original design
and discussion. This README and the GitHub issues describe the current
setup.

## Run the full Japan demo

Set up the local dependencies once:

```bash
python3 -m venv .venv
.venv/bin/pip install -r services/simulation/requirements.txt
cd apps/web && npm ci && cd ../..
```

Then start the simulation stream and web demo together:

```bash
./scripts/run-demo.sh
```

Open [localhost:3000](http://localhost:3000), choose **Play**, and the applied
Japan earthquake arrives through the local simulation stream. Its map animation
and WORLD//WIRE card appear together; click the card to focus the epicenter.
Pause, change speed, seek, and reset to replay the deterministic fixture.
Countries have hover outlines on top of the real satellite imagery. Press
Ctrl+C in the terminal to stop both servers.

This demo uses no model login, API key, or Codex installation. Its imagery
tiles require an internet connection; the event data remain local and fixed.

## Run the earthquake demo check

The offline demo check replays the shared fixture through the simulation engine into WORLD//WIRE and confirms that each news card focuses the map on its event. It needs no model login.

```bash
python3 -m venv .venv && .venv/bin/pip install jsonschema   # optional, enables contract checks
./scripts/smoke-demo.sh          # contracts, newsroom, and end-to-end checks
./scripts/smoke-demo.sh --open   # also opens the WORLD//WIRE preview page
./scripts/smoke-demo.sh --web    # also runs the browser check (once: cd apps/web && npm ci && npx playwright install chromium)
```

Shared event and stream shapes are in [contracts/](contracts/README.md).

## Run the Director fixture

The Director can generate the set Japan scenario without model access:

```bash
cd services/director
python3 -m worlddirector --fixture japan-earthquake
```

The output is a deterministic batch of proposed events. The simulation applies
the events and streams them to the map and newsroom. The shared single-event
fixture in `contracts/fixtures/japan-earthquake.json` is used by the current
offline smoke check.

Future AI prompting tests run on Hamza's computer through his signed-in Codex
CLI. The team can develop and test the demo with the fixtures on their own
machines.
