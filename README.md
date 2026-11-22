# WORLD//SIM

Describe a hypothetical crisis, watch it unfold on an animated world map, and follow the response through the fictional **WORLD//WIRE** news feed.

## Try it

Type a situation, or pick one of ten starter scenarios, and watch it unfold on the map.
Every run rolls a new random seed, so the same prompt never plays out the same way twice.
Run `./scripts/run-demo.sh` and open http://127.0.0.1:3000. Starters run offline, with no
model or paid API. To film a run as a satirical recap, see
[open-ended simulation](docs/open-ended-simulation.md).

## Start here

Already working? Open [TEAM-SYNC.md](TEAM-SYNC.md) and the
[live team thread](https://github.com/hmzdev23/worldsim/issues/13) before continuing.

### 1. Accept your GitHub invitation

Open the [WORLD//SIM invitation](https://github.com/hmzdev23/worldsim/invitations) while signed in to the GitHub account Hamza invited. Once you accept, confirm you can open the [private repository](https://github.com/hmzdev23/worldsim).

### 2. Open your coding agent

Hamza uses Codex. Mathys, Anthony, and Amir can use Claude Code or their own coding agents.

**Anyone can be the Director.** Prompted scenarios run through Claude Code
(`claude -p` on Haiku at low effort) on the computer running the simulation
server, using that person's signed-in Claude account. Each run gets a new
random seed, so the same prompt gives a different story every time. Set
`WORLDSIM_DIRECTOR_ENGINE=codex` to use Codex instead.
Running the Japan earthquake demo does not require Codex or a model login.

- **Already have WORLD//SIM open locally?** Use that folder in your coding AI and go straight to step 3.
- **Only have GitHub open in a browser?** Open your coding AI in the folder where you keep your projects. The prompt below tells it to clone the repo for you.

### 3. Pick your task by name

The original Japan demo tasks are complete. Follow-up work is tracked in the
live issues; check the linked issue and #13 before coding.

| Team member | Active task | Owned files |
| --- | --- | --- |
| Hamza | Done: [#40 — Prominent event headline alerts](https://github.com/hmzdev23/worldsim/issues/40) (PR #48) | Web alert component, simulation/map integration, styles, desktop E2E |
| Amir | Done: [#41 — Alert-ready news copy](https://github.com/hmzdev23/worldsim/issues/41) (PR #47) | `services/newsroom/` and newsroom tests |
| Anthony | Done: [#42 — Stop clock at scenario end](https://github.com/hmzdev23/worldsim/issues/42) (PR #45). Next task TBD | `services/simulation/` and simulation tests |
| Mathys | Done: [#43 — Non-Japan pipeline proof](https://github.com/hmzdev23/worldsim/issues/43) (PR #46) | New test-only fixtures and tests under `tests/director/` |

These original assignments owned separate paths. Do not edit another owner's
files or shared contracts without coordinating in issue #13.

Use this prompt for your assigned issue:

```text
I'm [NAME], working on WORLD//SIM issue #[NUMBER].
Repo: https://github.com/hmzdev23/worldsim
Check that my issue is OPEN. Read README.md, AGENTS.md, TEAM-SYNC.md, the
whole issue, and recent comments in issue #13. Work only in my issue's owned
files. If another issue is closed, do not repeat it. Branch from latest main,
preserve local changes, and use deterministic offline fixtures. No Codex
install, model, API credits, or credentials. Run the checks in my issue, open
a PR linked to it, and post the PR in #13. Do not change shared contracts or
another owner's files without coordinating first.
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
