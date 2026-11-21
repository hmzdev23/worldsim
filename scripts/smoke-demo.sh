#!/usr/bin/env bash
# Offline smoke check for the earthquake demo (INT-001).
# Usage: ./scripts/smoke-demo.sh [--open]
#   --open  also writes the WORLD//WIRE preview page and opens it.
set -euo pipefail
cd "$(dirname "$0")/.."

PY=python3
[ -x .venv/bin/python ] && PY=.venv/bin/python
"$PY" -c "import jsonschema" 2>/dev/null || echo "note: jsonschema not installed; contract checks will be skipped (python3 -m venv .venv && .venv/bin/pip install jsonschema)" >&2

for suite in contracts newsroom integration; do
  echo "== $suite"
  "$PY" -m unittest discover -s "tests/$suite" -t "tests/$suite"
done

if [ "${1:-}" = "--open" ]; then
  out="$(mktemp -d)/worldwire.html"
  (cd services/newsroom && "$PY" -m worldwire ../../contracts/fixtures/japan-earthquake.json --html "$out")
  command -v open >/dev/null && open "$out" || echo "Preview: $out"
fi
