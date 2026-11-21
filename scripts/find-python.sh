# Sourced by the other scripts: sets PY to a working Python interpreter.
# Prefers the repo .venv (bin/ on macOS/Linux, Scripts/ on Windows), then
# python3, python, and the Windows `py -3` launcher. Each candidate must run,
# which skips the Windows Store "python3" stub that only prints an install hint.
# Usage: . "$ROOT/scripts/find-python.sh"   (ROOT must be the repo root)

find_python() {
  local candidate
  for candidate in "$ROOT/.venv/bin/python" "$ROOT/.venv/Scripts/python.exe"; do
    if [ -x "$candidate" ] && "$candidate" -c "import sys" >/dev/null 2>&1; then
      PY=("$candidate")
      return 0
    fi
  done
  for candidate in python3 python; do
    if command -v "$candidate" >/dev/null 2>&1 && "$candidate" -c "import sys" >/dev/null 2>&1; then
      PY=("$candidate")
      return 0
    fi
  done
  if command -v py >/dev/null 2>&1 && py -3 -c "import sys" >/dev/null 2>&1; then
    PY=(py -3)
    return 0
  fi
  echo "No working Python 3 found. Install Python 3.10+ and create the venv:" >&2
  echo "  python3 -m venv .venv   (Windows: py -3 -m venv .venv)" >&2
  return 1
}

# The pip inside the venv, for install hints.
VENV_PIP=".venv/bin/pip"
case "$(uname -s 2>/dev/null)" in MINGW* | MSYS* | CYGWIN*) VENV_PIP=".venv/Scripts/pip" ;; esac

find_python
