# Team sync

Read and post cross-team updates in [GitHub issue #13](https://github.com/hmzdev23/worldsim/issues/13). Hamza, Mathys, Anthony, Amir, and their coding agents share this thread.

## Current demo

Use the deterministic Japan earthquake fixtures for development and testing. The Director fixture runs with `cd services/director && python3 -m worlddirector --fixture japan-earthquake`. Any actual AI prompting tests run on Hamza's computer through his signed-in Codex CLI.

## Pick up the latest context

If your agent is already on a feature branch, it can read the current guide and live comments from there:

```sh
git fetch origin
git show origin/main:TEAM-SYNC.md
gh issue view 13 --repo hmzdev23/worldsim --comments
```

GitHub's issue page also works. Start with the latest comments, then open the linked PR or task for details.

## Post a handoff

Comment on #13 when you start a branch, need something from another owner, or have work ready for someone to use. Include the issue, the branch or PR, and what the other person can do with it.

```text
Name / issue: Anthony / #4
Status and branch or PR: [state and link]
Need from the team, or ready for: [who can use it, and how]
```

| Owner | Status |
| --- | --- |
| Mathys | **DONE:** [#26 closed](https://github.com/hmzdev23/worldsim/issues/26), [PR #36 merged](https://github.com/hmzdev23/worldsim/pull/36) |
| Hamza | **DONE:** [#29 closed](https://github.com/hmzdev23/worldsim/issues/29), [PRs #32 and #36 merged](https://github.com/hmzdev23/worldsim/pull/32) |
| Anthony | **DONE:** [#27 closed](https://github.com/hmzdev23/worldsim/issues/27), [PR #31 merged](https://github.com/hmzdev23/worldsim/pull/31) |
| Amir | **DONE:** [#28 closed](https://github.com/hmzdev23/worldsim/issues/28), [PRs #33 and #35 merged](https://github.com/hmzdev23/worldsim/pull/33) |

**No assigned demo tasks remain. Check live issues for new work; do not reopen completed tasks.**
The [event and stream contracts](contracts/README.md) and [Japan fixture](contracts/fixtures/japan-earthquake.json) are on `main`. Impact values are fictional cumulative snapshots, never daily additions.

## Issue/PR status rule

The live GitHub issue is the source of truth; this table is only a quick snapshot. Before working, check that the assigned issue is still open. A PR must use `Closes #N` only when it completes that issue; use `Refs #N` for partial work and list the remaining work. After merging, verify completed issues actually closed. Keep dependent issues open and name the dependency and next action so another agent does not repeat completed work. See `AGENTS.md` for the full workflow.
