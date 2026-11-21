# WORLD//SIM contributor instructions

Read the [README](README.md) for current project direction and the [master brief](WORLDSIM_MASTER_BRIEF.md) for background and proposed architecture.

- Ask which team member you are working with if they have not identified themselves. Use the README ownership table and verify their next task against the live GitHub issues.
- Read [TEAM-SYNC.md](TEAM-SYNC.md) and the latest comments in [issue #13](https://github.com/hmzdev23/worldsim/issues/13). Share branch starts, blockers, and handoffs in that thread.
- Read the repository instructions and any applicable contracts before editing. Check the current branch, working tree, open PRs, and issue dependencies.
- Work on a dedicated `codex/<area>-<task>` or `feat/<area>-<task>` branch. Keep changes within the issue scope and open a PR. Discuss changes to shared contracts with the affected owners.
- Start with the deterministic earthquake demo. The simulation engine validates and applies events, and WORLD//WIRE derives clearly fictional news from applied events.
- For the current demo, use the checked-in Japan earthquake fixtures for deterministic development and testing. Teammates do not need Codex or model credentials. Any actual AI prompting tests run on Hamza's computer through his signed-in Codex CLI.
- In the PR, link your issue and record the checks you ran, contract changes, and any handoff or blockers. Keep credentials local.
