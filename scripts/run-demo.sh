#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [ ! -x "$ROOT/apps/web/node_modules/.bin/next" ]; then
  echo "Web dependencies are missing. From the repo root, run: (cd apps/web && npm ci)" >&2
  exit 1
fi

./scripts/run-simulation-server.sh &
SIM_PID=$!
cleanup() {
  kill "$SIM_PID" 2>/dev/null || true
  wait "$SIM_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

ready=0
for _ in {1..60}; do
  if curl --silent --fail http://127.0.0.1:8765/health >/dev/null; then
    ready=1
    break
  fi
  if ! kill -0 "$SIM_PID" 2>/dev/null; then
    echo "Simulation server exited before becoming ready." >&2
    exit 1
  fi
  sleep 0.25
done

if [ "$ready" -ne 1 ]; then
  echo "Simulation server did not become ready at http://127.0.0.1:8765." >&2
  exit 1
fi

echo "WORLD//SIM is running at http://127.0.0.1:3000"
echo "Click Play. The fixture earthquake is applied through the local simulation stream."
cd "$ROOT/apps/web"
NEXT_PUBLIC_SIMULATION_MINUTES_PER_SECOND=60 npm run dev -- --hostname 127.0.0.1 --port 3000
