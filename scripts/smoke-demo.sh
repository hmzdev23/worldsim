#!/usr/bin/env bash
# Offline smoke check for the earthquake demo (INT-001), including the Director (DIR-001).
# Usage: ./scripts/smoke-demo.sh [--web] [--open]
#   --web   also runs the browser end-to-end check in apps/web (needs npm ci and
#           npx playwright install chromium once).
#   --open  also writes the WORLD//WIRE preview page and opens it.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
. "$ROOT/scripts/find-python.sh"

"${PY[@]}" -c "import jsonschema" 2>/dev/null || echo "note: jsonschema not installed; contract checks will be skipped (${PY[*]} -m venv .venv && $VENV_PIP install jsonschema)" >&2

for suite in contracts director simulation newsroom integration; do
  echo "== $suite"
  "${PY[@]}" -m unittest discover -s "tests/$suite" -t "tests/$suite"
done

case " $* " in *" --web "*)
  echo "== web e2e"
  (cd apps/web && npm run --silent test:e2e)
esac

case " $* " in *" --open "*)
  out="$(mktemp -d)/worldwire.html"
  (cd services/newsroom && "${PY[@]}" -m worldwire ../../contracts/fixtures/japan-earthquake.json --html "$out")
  command -v open >/dev/null && open "$out" || echo "Preview: $out"
esac
