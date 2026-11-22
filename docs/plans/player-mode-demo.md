# Player Mode demo (fictional / SIMULATED)

From Git Bash in the Player Mode development worktree:

```sh
./scripts/run-demo.sh
```

Open http://127.0.0.1:3000. Choose Play a role, Novel virus outbreak,
Regional health minister, then Play this role. Set 4x and Play. The first card
arrives around day 6: this is simulated time, with a seven-day minimum gap.
Choose Do nothing, then Open surge hospital capacity, then Give a public briefing.
These are fictional policy options; this game does not provide operational advice.

At completion, inspect all three score components and the no-action table.
Click See what your decisions changed. Compare A and B, select the hospital
capacity decision, and enable Show only what this decision changed. Show the
branch button and then Back to the map. Reset playback asks before voiding
three decisions; Try again creates a fresh run with the same scenario and role.

For fast browser verification on Windows, start the frontend in PowerShell:

```powershell
$env:NEXT_PUBLIC_SIMULATION_MINUTES_PER_SECOND='60'
npm run dev -- --port 3000
```

Start the simulation with `./scripts/run-simulation-server.sh` in Git Bash.
Then from apps/web in PowerShell:

```powershell
$env:E2E_PORT='3000'
npm run typecheck
npm run test:e2e
```

Both servers must be current and running: Playwright's automatic server commands
use POSIX environment syntax and do not start correctly under Windows cmd.exe.
No new dependencies or model credentials are needed. For screenshots, the Player
Mode test writes decision.png, summary.png and comparison.png in test-results.
