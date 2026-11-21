# WORLD//SIM

Describe a hypothetical crisis, watch it unfold on an animated world map, and follow the response through the fictional **WORLD//WIRE** news feed.

The first deliverable is a deterministic Japan earthquake demo. A fixture event enters the simulation stream, triggers an animation on the map, and produces a news card that flies the camera to the event when clicked. The simulator will run this demo without model access.

The [master brief](WORLDSIM_MASTER_BRIEF.md) records the original design and discussion. This README and the GitHub issues describe the current setup.

## Team onboarding

Accept the [GitHub invitation](https://github.com/hmzdev23/worldsim/invitations), then clone the repo.

```bash
git clone https://github.com/hmzdev23/worldsim.git
cd worldsim
```

Open the clone in Codex or Claude Code and tell it:

> I'm [your name]. Read AGENTS.md and the README, check my linked GitHub issue and current repo state, and start the highest-priority unblocked task in my area on a feature branch. Use mocks for unfinished dependencies and open a PR for review when it's ready.

| Team member | Area | First issue |
| --- | --- | --- |
| Hamza | Frontend and map | [WEB-001](https://github.com/hmzdev23/worldsim/issues/2) |
| Mathys | World Director (proposed) | [DIR-001](https://github.com/hmzdev23/worldsim/issues/3) |
| Anthony | Simulation backend (proposed) | [SIM-001](https://github.com/hmzdev23/worldsim/issues/4) |
| Amir | Newsroom and integration (proposed) | [NEWS-001](https://github.com/hmzdev23/worldsim/issues/5) |

Review the [event contract](https://github.com/hmzdev23/worldsim/issues/1) together. Coordinate the full [earthquake demo](https://github.com/hmzdev23/worldsim/issues/6) through issues and PRs. Use feature branches and ask for peer review before merging to `main`.

## Try the World Director

Install Codex CLI and run `codex login` with ChatGPT. Check your sign-in with `codex login status`.

```bash
./scripts/try-director.sh "A major earthquake disrupts public transit in Tokyo"
```

The script calls `codex exec` with GPT-6 Luna at high effort and sends a JSON event batch to stdout. It uses the local ChatGPT login and counts toward that account’s Codex limits. The schema in `scripts/` is for this standalone demo. The simulation and frontend integration are tracked in the issues above.
