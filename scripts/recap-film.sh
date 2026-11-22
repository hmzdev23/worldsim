#!/usr/bin/env bash
# Film one simulation run as a recap (experiments/recap-films/films/run).
#
#   scripts/recap-film.sh RUN_ID      # a run on the local simulation server
#   scripts/recap-film.sh --fixture tsunami [--seed 1234]          # offline, like a starter run
#
# Needs: Python 3, Node 20+, ffmpeg, Playwright's Chromium (apps/web), and THREE_ROOT pointing
# at a folder whose node_modules contains three@0.170.0. Narration needs ELEVENLABS_API_KEY
# (environment or the untracked .env.local); set RECAP_ESTIMATE=1 to render a silent preview.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FILM="$ROOT/experiments/recap-films/films/run"
SERVER="${SIMULATION_HTTP_URL:-http://127.0.0.1:8765}"
: "${THREE_ROOT:?set THREE_ROOT to a folder with node_modules/three (npm install three@0.170.0)}"

if [[ $# -gt 0 && "$1" != --* ]]; then
  run="$1"; shift
  python3 "$FILM/make-script.py" --run "$run" --server "$SERVER" "$@"
else
  python3 "$FILM/make-script.py" "$@"
fi
if [[ "${RECAP_ESTIMATE:-}" == 1 ]]; then
  python3 "$FILM/make-audio.py" --estimate
  node "$ROOT/experiments/recap-films/render-local.mjs" "$FILM" --three "$THREE_ROOT" --out "$FILM/output/preview.mp4"
  echo "Silent preview: $FILM/output/preview.mp4"
else
  python3 "$FILM/make-audio.py"
  node "$ROOT/experiments/recap-films/render-local.mjs" "$FILM" --three "$THREE_ROOT" --out "$FILM/output/picture.mp4"
  python3 "$FILM/assemble.py"
fi
