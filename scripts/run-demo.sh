#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [ ! -x "$ROOT/apps/web/node_modules/.bin/next" ]; then
  echo "Web dependencies are missing. From the repo root, run: (cd apps/web && npm ci)" >&2
  exit 1
fi

# Recap films render with three.js; use the copy from check-setup's install unless THREE_ROOT is set.
if [ -z "${THREE_ROOT:-}" ] && [ -f "$ROOT/.cache/three/node_modules/three/package.json" ]; then
  export THREE_ROOT="$ROOT/.cache/three"
fi

set -m  # background jobs get their own process group (see cleanup)
./scripts/run-simulation-server.sh &
SIM_PID=$!
WEB_PID=""
# Each server runs in its own process group (set -m), so stopping the group
# also stops what it started (npm -> next and its workers, script -> python).
stop_group() {
  kill -TERM -- "-$1" 2>/dev/null || kill -TERM "$1" 2>/dev/null || true
}
cleanup() {
  trap - EXIT INT TERM
  [ -n "$WEB_PID" ] && stop_group "$WEB_PID"
  stop_group "$SIM_PID"
  wait 2>/dev/null || true
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

URL="http://127.0.0.1:3000"
(cd "$ROOT/apps/web" && NEXT_PUBLIC_SIMULATION_MINUTES_PER_SECOND=60 npm run dev -- --hostname 127.0.0.1 --port 3000) &
WEB_PID=$!

# Only announce (and open) the site once the first page has actually compiled.
# Opening it earlier shows an error page, which Chrome only reloads when you
# switch away from the tab and back.
echo "Starting the web app..."
ready=0
for _ in {1..240}; do
  if curl --silent --fail --output /dev/null --max-time 30 "$URL"; then
    ready=1
    break
  fi
  if ! kill -0 "$WEB_PID" 2>/dev/null; then
    echo "The web app exited before becoming ready." >&2
    exit 1
  fi
  sleep 0.5
done
if [ "$ready" -ne 1 ]; then
  echo "The web app did not become ready at $URL." >&2
  exit 1
fi

echo
echo "WORLD//SIM is ready at $URL"
echo "Press Ctrl+C to stop both servers."
if [ -z "${WORLDSIM_NO_OPEN:-}" ] && [ -z "${CI:-}" ]; then
  case "$(uname -s)" in
    Darwin) open "$URL" ;;
    Linux) command -v xdg-open >/dev/null && xdg-open "$URL" >/dev/null 2>&1 || true ;;
    MINGW*|MSYS*|CYGWIN*) start "" "$URL" 2>/dev/null || true ;;
  esac
fi
wait "$WEB_PID"
