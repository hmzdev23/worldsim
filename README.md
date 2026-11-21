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

### 3. Expand your name and paste the whole prompt into your coding AI

| Team member | Area | First issue |
| --- | --- | --- |
| Hamza | Frontend and map | [#2](https://github.com/hmzdev23/worldsim/issues/2) |
| Mathys | World Director (proposed) | [#3](https://github.com/hmzdev23/worldsim/issues/3) |
| Anthony | Simulation backend (proposed) | [#4](https://github.com/hmzdev23/worldsim/issues/4) |
| Amir | Newsroom and integration (proposed) | [#5](https://github.com/hmzdev23/worldsim/issues/5) |

<details>
<summary><strong>Hamza</strong> — Frontend and map</summary>

```text
I'm Hamza, working on issue #2 for WORLD//SIM.

Repo: https://github.com/hmzdev23/worldsim
My issue: https://github.com/hmzdev23/worldsim/issues/2

Check whether this repo is already cloned. If it is, use that copy and
fetch the latest changes from origin. If it isn't, clone it and work
inside the worldsim folder. If GitHub denies access, tell me which
account or permission I need to fix.

Read README.md, AGENTS.md, TEAM-SYNC.md, and my GitHub issue. Read the
latest comments in issue #13 and share what I’m starting there.
Preserve any local work.
If I already have a branch for this issue, continue on it. Otherwise,
start from the latest origin/main on a new feature branch.

Start the highest-priority unblocked work in my issue. Use mock data
if a teammate's dependency is still in progress. Tell me what you
started, which branch you're using, and any blockers. When the work
is ready, open a PR linked to my issue.
```

</details>

<details>
<summary><strong>Mathys</strong> — World Director</summary>

```text
I'm Mathys, working on issue #3 for WORLD//SIM.

Repo: https://github.com/hmzdev23/worldsim
My issue: https://github.com/hmzdev23/worldsim/issues/3

Check whether this repo is already cloned. If it is, use that copy and
fetch the latest changes from origin. If it isn't, clone it and work
inside the worldsim folder. If GitHub denies access, tell me which
account or permission I need to fix.

Read README.md, AGENTS.md, TEAM-SYNC.md, and my GitHub issue. Read the
latest comments in issue #13 and share what I’m starting there.
Preserve any local work.
If I already have a branch for this issue, continue on it. Otherwise,
start from the latest origin/main on a new feature branch.

Start the highest-priority unblocked work in my issue. Use mock data
if a teammate's dependency is still in progress. Tell me what you
started, which branch you're using, and any blockers. When the work
is ready, open a PR linked to my issue.
```

</details>

<details>
<summary><strong>Anthony</strong> — Simulation backend</summary>

```text
I'm Anthony, working on issue #4 for WORLD//SIM.

Repo: https://github.com/hmzdev23/worldsim
My issue: https://github.com/hmzdev23/worldsim/issues/4

Check whether this repo is already cloned. If it is, use that copy and
fetch the latest changes from origin. If it isn't, clone it and work
inside the worldsim folder. If GitHub denies access, tell me which
account or permission I need to fix.

Read README.md, AGENTS.md, TEAM-SYNC.md, and my GitHub issue. Read the
latest comments in issue #13 and share what I’m starting there.
Preserve any local work.
If I already have a branch for this issue, continue on it. Otherwise,
start from the latest origin/main on a new feature branch.

Start the highest-priority unblocked work in my issue. Use mock data
if a teammate's dependency is still in progress. Tell me what you
started, which branch you're using, and any blockers. When the work
is ready, open a PR linked to my issue.
```

</details>

<details>
<summary><strong>Amir</strong> — Newsroom and integration</summary>

```text
I'm Amir, working on issue #5 for WORLD//SIM.

Repo: https://github.com/hmzdev23/worldsim
My issue: https://github.com/hmzdev23/worldsim/issues/5

Check whether this repo is already cloned. If it is, use that copy and
fetch the latest changes from origin. If it isn't, clone it and work
inside the worldsim folder. If GitHub denies access, tell me which
account or permission I need to fix.

Read README.md, AGENTS.md, TEAM-SYNC.md, and my GitHub issue. Read the
latest comments in issue #13 and share what I’m starting there.
Preserve any local work.
If I already have a branch for this issue, continue on it. Otherwise,
start from the latest origin/main on a new feature branch.

Start the highest-priority unblocked work in my issue. Use mock data
if a teammate's dependency is still in progress. Tell me what you
started, which branch you're using, and any blockers. When the work
is ready, open a PR linked to my issue.
```

</details>

Review the [shared event contract](https://github.com/hmzdev23/worldsim/issues/1) together and track the [earthquake demo](https://github.com/hmzdev23/worldsim/issues/6) in GitHub. Use feature branches and merge through GitHub PRs.

## First demo

The first deliverable is a deterministic Japan earthquake demo. A fixture event enters the simulation stream, triggers an animation on the map, and produces a news card that flies the camera to the event when clicked. The simulator will run this demo without model access.

The [master brief](WORLDSIM_MASTER_BRIEF.md) records the original design and discussion. This README and the GitHub issues describe the current setup.

## Run the earthquake demo check

The offline demo check runs the shared fixture through a mock simulation stream into WORLD//WIRE and confirms that each news card focuses the map on its event. It needs no model login.

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
