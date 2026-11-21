# Team sync

Read and post cross-team updates in [GitHub issue #13](https://github.com/hmzdev23/worldsim/issues/13). Hamza, Mathys, Anthony, Amir, and their coding agents share this thread.

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

| Area | Task |
| --- | --- |
| Hamza · World map | [#2](https://github.com/hmzdev23/worldsim/issues/2) |
| Mathys · Director | [#3](https://github.com/hmzdev23/worldsim/issues/3) |
| Anthony · Simulation | [#4](https://github.com/hmzdev23/worldsim/issues/4) |
| Amir · Newsroom and integration | [#5](https://github.com/hmzdev23/worldsim/issues/5) and [#6](https://github.com/hmzdev23/worldsim/issues/6) |

The [event and stream contracts](contracts/README.md) and [Japan fixture](contracts/fixtures/japan-earthquake.json) are on `main`.
