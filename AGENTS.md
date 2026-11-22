# WORLD//SIM contributor instructions

Read the [README](README.md) for current project direction and the [master brief](WORLDSIM_MASTER_BRIEF.md) for background and proposed architecture.

- Ask which team member you are working with if they have not identified themselves. Use the README ownership table and verify their next task against the live GitHub issues.
- Read [TEAM-SYNC.md](TEAM-SYNC.md) and the latest comments in [issue #13](https://github.com/hmzdev23/worldsim/issues/13). Share branch starts, blockers, and handoffs in that thread.
- Read the repository instructions and any applicable contracts before editing. Check the current branch, working tree, open PRs, and issue dependencies.
- Work on a dedicated `codex/<area>-<task>` or `feat/<area>-<task>` branch. Keep changes within the issue scope and open a PR. Discuss changes to shared contracts with the affected owners.
- **Keep issue and PR status in sync.** Before coding, check the live issue state with `gh issue view <number> --repo hmzdev23/worldsim`. Do not start a closed issue; find its merged PR or ask the owner for the next open task. If the issue is open but its work is already merged, update/close it before starting something new.
- In PR descriptions, use `Closes #<issue>` only when the PR completes the issue's acceptance criteria. For partial work, use `Refs #<issue>` and list exactly what is finished and what remains in the issue or PR handoff. After merge, verify that GitHub closed completed issues; close them manually with a short explanation if it did not. Keep dependent issues open and name their remaining work and dependency.
- Treat README/TEAM-SYNC status tables as a quick snapshot, not the source of truth. Update them when ownership or dependencies change, and check the live issue/PR state before telling teammates a task is open or done.
- Start with the deterministic earthquake demo. The simulation engine validates and applies events, and WORLD//WIRE derives clearly fictional news from applied events.
- For the current demo, use the checked-in Japan earthquake fixtures for deterministic development and testing. Teammates do not need Codex or model credentials. Real prompted runs use the Director's default engine, Claude Code (`claude -p`, Haiku, low effort), so anyone signed in to Claude Code can run them; `WORLDSIM_DIRECTOR_ENGINE=codex` switches back to Codex.
- In the PR, link your issue and record the checks you ran, contract changes, and any handoff or blockers. Keep credentials local.
