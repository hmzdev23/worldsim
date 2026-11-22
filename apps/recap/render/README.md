# Recap export (RECAP-004, #70)

This turns a finished run into a 9:16 recap video: an H.264 MP4 at 1080×1920 and 30 fps, plus an `.srt` of captions.

```
finished run → storyboard.json (#67) → narration.json (#68, optional) → renderer page (#69) → MP4 (this)
```

## Use

```bash
(cd apps/recap/render && npm ci && npx playwright install chromium)   # once
scripts/render-recap.sh contracts/fixtures/japan-earthquake.json          # needs #67 and #69
scripts/render-recap.sh path/to/storyboard.json --stub                    # works today
```

Options:
- `--out FILE.mp4` sets the output file. The default is `build/recap/<simulation_id>/recap.mp4`, with `recap.srt` and `frames.sha256` next to it.
- `--stub` renders with the stub page in `stub/` instead of `apps/recap/dist`. Use it until RECAP-003 lands.
- `--voice` fails if narration can't be produced. `--no-voice` skips narration.

The script does three steps:
1. **Storyboard.** It runs `python -m worldwire.storyboard FIXTURE`, or skips this step when you pass a storyboard.
2. **Narration.** It runs `python -m narration storyboard.json --out audio/` when that package exists. Narration needs `ELEVENLABS_API_KEY`; without a key, no `narration.json` is written and the video has captions only, with no audio track.
3. **Render.** It runs `node render.mjs`, which:
   - serves the renderer page and opens it in headless Chromium, using software WebGL so every machine renders the same way;
   - calls `window.recap.load(storyboard, narration)` once;
   - for each frame, awaits `window.recap.renderFrame(n)` and captures `<canvas id="recap">` as a PNG;
   - pipes the PNGs to `ffmpeg-static`;
   - places each narration clip at its scene's `start_frame / fps`.

Each missing piece stops the run with a message that names the missing step and how to fix it: no storyboard module, a renderer that isn't built, missing npm dependencies, Chromium not installed, a missing narration clip, or a canvas of the wrong size.

## Contract with the renderer page

These come from the shared interface in PR #73.

- `window.recap.load(storyboard, narration?)` resolves to `{fps, total_frames, scenes: [{id, start_frame, end_frame}]}`. The export treats `end_frame` as exclusive: scene frames run from `start_frame` to `end_frame - 1`.
- `window.recap.renderFrame(n)` resolves once frame `n` is drawn. Time must come only from `n`.
- `fps` must match `storyboard.format.fps`, and the canvas must be exactly `format.width × format.height`.

## Determinism

`frames.sha256` lists the SHA-256 of every captured PNG. Two renders of the same input on the same machine produce identical lists, and the tests check this. The MP4 bytes themselves can differ between encoder builds, so compare frame hashes rather than the video file.

## Tests

```bash
cd apps/recap/render && npm test
```

The tests use the stub page and a three-scene storyboard. They need no key and no network once Chromium is installed. They cover:
- the MP4's format, checked by reading ffmpeg's report of the file
- the SRT cues
- identical frame hashes across two renders
- narration placement, using generated test tones
- the failure messages

**Speed:** about 0.1 s per frame on a laptop, so a 60-second recap takes around 3 minutes.
