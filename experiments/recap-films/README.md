# Experimental 3D recap films

This is the actual scene, narration, sound and FFmpeg assembly code used for the standalone Japan and Montreal review videos. It is a handoff for Mathys and the team, **not** the integrated `apps/recap` renderer or a general prompt-to-video pipeline. The shots are manually authored and the inputs are fixed. The shared storyboard, narration and export contracts are unchanged. PR #76 remains a separate earlier renderer experiment; this folder is not a replacement for its merge decision.

## What's here

- `films/japan`: the latest Japan film with sky, earthquake effects and no visible people, with its narration and sound effects.
- `films/japan-people-legacy`: an editable reconstruction of the earlier people-enabled Japan iteration. This is retained for reference, not the requested final direction; it is not a byte-exact archive of the first render.
- `films/montreal-v1`: the initial Montreal pandemic timeline, with its Director event batch and audio.
- `films/montreal-v2`: the liked revision, with a lab, Toronto and New York scenes, a response room, map, train and moving traffic. This is the current Montreal review version.
- `films/montreal-wip-v3`: **unfinished** follow-up attempting to correct backwards cars and add train carriages, with the newly requested voice ID `XA3P1cj7XJexe6Zq0ATX`. A preview showed the train partly hidden by a building, and the new voice clips can overrun shots; camera, timing, export and full-video QA remain. Do not present it as fixed.
- `assets`: only the GLB models and map data used by the scenes. `CREDITS.md` describes their sources and terms. Existing generated sample audio is included in each film folder so a teammate can render offline without an ElevenLabs key. No MP4 exports, API keys, or local browser installations are included.

The simulation descriptions and figures in these sample films are generated scenario content, not observed outcomes or predictions. The personal-story, branching-choice, real-world-data grounding and live prompt-to-video ideas are future work.

## Set up the renderer

Needs Python 3, Node.js 20+, FFmpeg/ffprobe, and the pinned Lemo-Opuscar checkout. Lemo's renderer launches a local headless Chromium browser and drives the deterministic Three.js `window.render(time)` page. It supplies the `three` package and Playwright browser integration; it is not bundled here.

```sh
git clone https://github.com/lemomo-ai/lemo-opuscar.git /path/to/lemo-opuscar
git -C /path/to/lemo-opuscar checkout f9e204293930952b61ba921cd8944d05f121beee
npm ci --prefix /path/to/lemo-opuscar
node /path/to/lemo-opuscar/node_modules/playwright-core/cli.js install chromium-headless-shell
export LEMO_ROOT=/path/to/lemo-opuscar
```

Review [Lemo's licensing](https://github.com/lemomo-ai/lemo-opuscar/blob/f9e204293930952b61ba921cd8944d05f121beee/LICENSE) and the third-party terms in `CREDITS.md`. If Chromium is already installed in a custom Playwright directory, set `PLAYWRIGHT_BROWSERS_PATH`; `PLAYWRIGHT_CHROME` can select a compatible headless executable.

## Render

From this directory:

```sh
# Render all eight shots, concatenate them, mix the included audio and create SRT.
python3 render.py montreal-v2
python3 render.py japan

# Render one zero-based shot at a smaller preview resolution; no assembly.
python3 render.py montreal-v2 --shot 2 --width 540 --height 960 --fps 12

# See the staged files, or assemble previously rendered shots.
python3 render.py montreal-v2 --prepare-only
python3 render.py montreal-v2 --assemble-only
```

The wrapper stages copies in the ignored `build/<variant>/` folder. Outputs are under `build/<variant>/output/`; shot MP4s are under `build/<variant>/shots/`. Full render defaults to 1080 × 1920, 30 fps and three workers. `--lemo PATH` may be used instead of `LEMO_ROOT`; `--workers`, `--fps`, `--width`, and `--height` are configurable. A rerun can overwrite its own staged renders and exports, so save any generated files you want to keep elsewhere.

The included voice and effects avoid external calls during a normal render. Each original `make-audio.py` can regenerate missing clips with `ELEVENLABS_API_KEY` set in the shell and optional `ELEVENLABS_VOICE_ID`; those calls use the account's quota. Work on staged copies if replacing audio so the checked-in review samples remain intact. Never commit an API key. The v2 music-generation prompt is retained in `generate-music.py` and runs from the staged film directory with the key in the environment.

## Boundaries and handoff

Each scene file defines its eight cuts, scene construction, cameras and deterministic per-time animation. The assembly script defines the voice/effects offsets, levels and captions. Audio regeneration prompts live in `make-audio.py`. For the production pipeline, these need to be generalized around a scenario and its event/storyboard data, integrated with #71/#73, and tested with multiple inputs. None of those integration or branch-choice features is claimed as complete here.
