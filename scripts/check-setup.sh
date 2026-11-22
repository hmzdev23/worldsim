#!/usr/bin/env bash
# Check every dependency WORLD//SIM uses and say how to install anything missing.
#   ./scripts/check-setup.sh
# Exit code 0 when the core app (map + starter scenarios) can run.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

core_ok=1
ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
miss() { printf '  \033[31m✗\033[0m %s\n      fix: %s\n' "$1" "$2"; }
warn() { printf '  \033[33m!\033[0m %s\n      fix: %s\n' "$1" "$2"; }

case "$(uname -s)" in
  Darwin) PKG="brew install"; FFMPEG_FIX="brew install ffmpeg" ;;
  Linux) PKG="sudo apt install"; FFMPEG_FIX="sudo apt install ffmpeg" ;;
  *) PKG="winget install"; FFMPEG_FIX="winget install ffmpeg   (then reopen Git Bash)" ;;
esac

echo "Core: the map and the ten starter scenarios"
PY=""
for candidate in "$ROOT/.venv/bin/python" "$ROOT/.venv/Scripts/python.exe"; do
  [ -x "$candidate" ] && PY="$candidate" && break
done
if command -v python3 >/dev/null && python3 -c 'import sys; sys.exit(sys.version_info < (3, 10))' 2>/dev/null; then
  ok "Python $(python3 -c 'import platform; print(platform.python_version())')"
else
  miss "Python 3.10 or newer" "install from https://www.python.org/downloads/ (or: $PKG python3)"; core_ok=0
fi
if [ -n "$PY" ] && "$PY" -c 'import fastapi, uvicorn, jsonschema' 2>/dev/null; then
  ok "Python packages (.venv: fastapi, uvicorn, jsonschema)"
else
  miss "Python packages in .venv" "python3 -m venv .venv && .venv/bin/pip install -r services/simulation/requirements.txt"; core_ok=0
fi
if command -v node >/dev/null && node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>20||(a===20&&b>=9)?0:1)'; then
  ok "Node.js $(node --version)"
else
  miss "Node.js 20.9 or newer" "install the LTS from https://nodejs.org/ (or: $PKG node)"; core_ok=0
fi
if [ -x apps/web/node_modules/.bin/next ]; then
  ok "Web app packages (apps/web)"
else
  miss "Web app packages" "(cd apps/web && npm ci)"; core_ok=0
fi

echo
echo "Typed prompts: the Director (Claude Code on Haiku)"
if command -v claude >/dev/null; then
  ok "Claude Code $(claude --version 2>/dev/null | head -1)"
  echo "      sign in once by running: claude   (any Claude plan; the Director uses your login)"
else
  miss "Claude Code" "curl -fsSL https://claude.ai/install.sh | bash   (or: npm install -g @anthropic-ai/claude-code), then run: claude"
fi
if [ "${WORLDSIM_DIRECTOR_ENGINE:-claude}" = "codex" ]; then
  command -v codex >/dev/null && ok "Codex CLI (WORLDSIM_DIRECTOR_ENGINE=codex)" \
    || miss "Codex CLI (WORLDSIM_DIRECTOR_ENGINE=codex is set)" "npm install -g @openai/codex && codex login"
fi

echo
echo "Recap films (optional): video, narration and 3D rendering"
command -v ffmpeg >/dev/null && ok "ffmpeg" || miss "ffmpeg (encodes the film)" "$FFMPEG_FIX"
command -v ffprobe >/dev/null && ok "ffprobe" || miss "ffprobe (times the narration; installed with ffmpeg)" "$FFMPEG_FIX"
THREE="${THREE_ROOT:-$ROOT/.cache/three}"
if [ -f "$THREE/node_modules/three/package.json" ]; then
  ok "three.js $(node -e "console.log(require('$THREE/node_modules/three/package.json').version)" 2>/dev/null) in ${THREE#$ROOT/}"
else
  miss "three.js 0.170.0 for the film renderer" "npm install --prefix .cache/three --no-save three@0.170.0"
fi
if (cd apps/web && node -e "const fs=require('fs'); const p=require('playwright').chromium.executablePath(); process.exit(fs.existsSync(p)?0:1)") 2>/dev/null; then
  ok "Playwright Chromium (renders film frames; also runs the browser tests)"
else
  miss "Playwright Chromium" "(cd apps/web && npx playwright install chromium)"
fi
if [ -n "${ELEVENLABS_API_KEY:-}" ] || grep -q '^ELEVENLABS_API_KEY=.' .env.local 2>/dev/null; then
  ok "ElevenLabs key (narration)"
else
  warn "ElevenLabs key: films render without narration" "add a line ELEVENLABS_API_KEY=... to .env.local in the repo root (never commit it)"
fi

echo
if [ "$core_ok" = 1 ]; then
  echo "Ready: ./scripts/run-demo.sh, then open http://127.0.0.1:3000"
else
  echo "Fix the ✗ items under Core first, then run this check again."
fi
[ "$core_ok" = 1 ]
