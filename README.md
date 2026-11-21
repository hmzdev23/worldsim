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

Use the active issue beside your name. The old starter issues #2–#6 are
finished; do not start those again. Open the issue link for the exact
scope and acceptance checklist. Each issue is assigned to its owner.

| Team member | Task | Issue |
| --- | --- | --- |
| Hamza | Live impact dashboard and crisis map | [#29](https://github.com/hmzdev23/worldsim/issues/29) |
| Mathys | Deterministic Japan event and impact fixture | [#26](https://github.com/hmzdev23/worldsim/issues/26) |
| Anthony | Full simulation timeline and replay | [#27](https://github.com/hmzdev23/worldsim/issues/27) |
| Amir | Event-by-event WORLD//WIRE | [#28](https://github.com/hmzdev23/worldsim/issues/28) |

**Copy this prompt into your coding AI. Replace the bracketed name and
issue number with your row above.** Teammates may use their existing
coding AI; nobody needs to install Codex or provide an API key.

```text
I'm [NAME], working on WORLD//SIM issue #[NUMBER].

Repository: https://github.com/hmzdev23/worldsim
My task: https://github.com/hmzdev23/worldsim/issues/[NUMBER]

Read README.md, AGENTS.md, and TEAM-SYNC.md. Read my whole GitHub issue
and the latest comments in team handoff issue #13. Check the repo state
before editing and preserve existing work. Work only on my assigned
issue; coordinate shared event and impact fields in #13.

Use the current repository copy if it is already open. Otherwise clone
the repository and work inside the worldsim folder. Fetch origin and
start a dedicated branch from the latest main. Keep the Japan scenario
deterministic and offline. Do not require Codex, an LLM, API credits,
or credentials. Run the checks listed in my issue, commit the work,
and open a PR that links my issue. Post the branch/PR and any handoff
in issue #13.

If another task is not merged yet, build against the documented
interface and use temporary fixture-shaped data only where needed.
Do not duplicate another owner's fixture, newsroom, or backend work.
```

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
