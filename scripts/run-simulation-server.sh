#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PY=python3
[ -x "$ROOT/.venv/bin/python" ] && PY="$ROOT/.venv/bin/python"

if ! "$PY" -c "import fastapi, jsonschema, uvicorn" >/dev/null 2>&1; then
  echo "Simulation dependencies are missing. From the repo root, run:" >&2
  echo "  python3 -m venv .venv && .venv/bin/pip install -r services/simulation/requirements.txt" >&2
  exit 1
fi

cd "$ROOT"
export PYTHONPATH="$ROOT/services/simulation${PYTHONPATH:+:$PYTHONPATH}"
exec "$PY" -m worldsim_sim \
  --host 127.0.0.1 \
  --port 8765 \
  --start-minutes 401 \
  --speed 1 \
  --paused \
  --minutes-per-second 60 \
  --tick-seconds 1
