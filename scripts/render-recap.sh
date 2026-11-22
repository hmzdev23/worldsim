#!/usr/bin/env bash
# RECAP-004 (#70): render a finished run's recap video.
#
#   scripts/render-recap.sh FIXTURE [--out recap.mp4] [--stub] [--voice | --no-voice]
#
# FIXTURE is anything `python -m worldwire.storyboard` accepts (e.g. a run's
# event batch such as contracts/fixtures/japan-earthquake.json), or a ready
# storyboard.json (a JSON object with "scenes"), which skips step 1.
#
# 1. storyboard  python -m worldwire.storyboard FIXTURE       (RECAP-001, #67)
# 2. narration   python -m narration storyboard --out audio/  (RECAP-002, #68; optional)
#                It needs ELEVENLABS_API_KEY; without one it writes nothing and
#                the video has captions only. --voice makes a missing step fatal.
# 3. render      node apps/recap/render/render.mjs            (this issue)
#                Drives apps/recap/dist (RECAP-003, #69) or, with --stub, the
#                stub page, and writes an H.264 1080x1920 MP4 plus an .srt.
#
# Output goes to build/recap/<simulation_id>/ unless --out is given.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/find-python.sh"
cd "$ROOT"

die() { echo "render-recap: $*" >&2; exit 1; }
note() { echo "render-recap: $*" >&2; }

input="" out="" stub=() voice="auto"
while [ $# -gt 0 ]; do
  case "$1" in
    --out) [ $# -ge 2 ] || die "--out needs a file name"; out="$2"; shift 2 ;;
    --stub) stub=(--stub); shift ;;
    --voice) voice="required"; shift ;;
    --no-voice) voice="off"; shift ;;
    -h|--help) sed -n '2,19p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) die "unknown option $1 (see --help)" ;;
    *) [ -z "$input" ] || die "give one FIXTURE"; input="$1"; shift ;;
  esac
done
[ -n "$input" ] || die "usage: scripts/render-recap.sh FIXTURE [--out recap.mp4] [--stub] [--voice|--no-voice]"
[ -f "$input" ] || [ "${input%.json}" = "$input" ] || die "file not found: $input"
command -v node >/dev/null 2>&1 || die "Node.js 20+ is required for the render step (node not found)."
[ -d apps/recap/render/node_modules ] || die "render dependencies are missing. Run: (cd apps/recap/render && npm ci)"

has_module() {  # has_module SERVICE_DIR MODULE
  PYTHONPATH="$ROOT/$1${PYTHONPATH:+:$PYTHONPATH}" "${PY[@]}" -c \
    "import importlib.util, sys; sys.exit(importlib.util.find_spec('$2') is None)" >/dev/null 2>&1
}
json_field() {  # json_field FILE KEY
  "${PY[@]}" -c "import json, sys; print(json.load(open(sys.argv[1], encoding='utf-8')).get(sys.argv[2], ''))" "$1" "$2"
}

# 1. Storyboard.
work_tmp="$(mktemp -d)"
trap 'rm -rf "$work_tmp"' EXIT
if [ -f "$input" ] && "${PY[@]}" -c "import json, sys; d = json.load(open(sys.argv[1], encoding='utf-8')); sys.exit(not (isinstance(d, dict) and 'scenes' in d))" "$input" 2>/dev/null; then
  note "using storyboard $input"
  cp "$input" "$work_tmp/storyboard.json"
else
  has_module services/newsroom worldwire.storyboard \
    || die "storyboard step is missing: worldwire.storyboard (RECAP-001, #67) isn't on this branch yet. Pass a storyboard.json instead."
  note "1/3 building the storyboard from $input"
  PYTHONPATH="$ROOT/services/newsroom${PYTHONPATH:+:$PYTHONPATH}" "${PY[@]}" -m worldwire.storyboard "$input" > "$work_tmp/storyboard.json" \
    || die "worldwire.storyboard failed for $input"
fi
sim="$(json_field "$work_tmp/storyboard.json" simulation_id)"
[ -n "$sim" ] || die "the storyboard has no simulation_id"
case "$sim" in *[!a-z0-9-]*) die "unexpected simulation_id: $sim" ;; esac
work="build/recap/$sim"
mkdir -p "$work"
[ -f build/.gitignore ] || printf '*\n' > build/.gitignore  # render output never gets committed
cp "$work_tmp/storyboard.json" "$work/storyboard.json"

# 2. Narration (optional).
narration=()
if [ "$voice" = "off" ]; then
  note "2/3 narration off (--no-voice): captions only"
elif has_module services/narration narration; then
  note "2/3 narration"
  rm -f "$work/audio/narration.json"
  PYTHONPATH="$ROOT/services/narration${PYTHONPATH:+:$PYTHONPATH}" "${PY[@]}" -m narration "$work/storyboard.json" --out "$work/audio" \
    || die "narration failed (see the message above)"
  if [ -f "$work/audio/narration.json" ]; then
    narration=(--narration "$work/audio/narration.json")
  elif [ "$voice" = "required" ]; then
    die "--voice was given but narration wrote no narration.json (is ELEVENLABS_API_KEY set?)"
  else
    note "no narration written (no ELEVENLABS_API_KEY): captions only"
  fi
elif [ "$voice" = "required" ]; then
  die "narration step is missing: the narration package (RECAP-002, #68) isn't on this branch yet."
else
  note "2/3 narration step not available yet (RECAP-002, #68): captions only"
fi

# 3. Render.
out="${out:-$work/recap.mp4}"
note "3/3 rendering $out"
node apps/recap/render/render.mjs --storyboard "$work/storyboard.json" --out "$out" "${narration[@]}" "${stub[@]}" \
  --hashes "$work/frames.sha256"
