# Iceland satire recap (local experiment)

A 57-second, 1080×1920 satirical recap of the Iceland eruption fixture, styled as an alternate-reality news broadcast. It has a WORLD//WIRE SATIRE chyron, fictional social posts, an absurdity index and a ticker. Every headline, post and number comes from `worldwire.satire` run over `services/director/fixtures/iceland-eruption.json`, so the film says exactly what the live app's Satirical tone says. Impact estimates (deaths, injuries and so on) are never used for jokes and don't appear.

## Shots

1. **Map:** Iceland, with the eruption pin and the ash cloud drifting toward the UK. Satirical headline for evt-0001.
2. **Eruption:** a fissure with lava fountains, next to a "PERMIT REQUIRED FOR ALL LAVA" sign.
3. **Evacuation:** an orderly queue of cars under the official brochure billboard.
4. **Power plant:** the lights go out and "IT'S A FEATURE, NOT A BUG" lights up.
5. **Airport:** grounded jets in the ash haze, with ThriftJet Air's VolcanoFlex™ post.
6. **Press conference:** "THE SITUATION REMAINS FLUID" banner, empty podium and camera flashes.
7. **Aid:** a 600-page customs form grows next to the relief crates, with the committee's post.
8. **Summary:** pull out over the North Atlantic, with the absurdity index counting up.

## Build

```sh
python3 make-script.py [--tone satirical|unhinged]   # script.json from the satire layer
python3 make-audio.py                               # ElevenLabs voice (cached), timing.json
node ../../render-local.mjs . --three /path/to/folder-with-node_modules/three --out output/picture.mp4
python3 assemble.py                                 # output/iceland-satire.mp4 + .srt
```

- **Rendering:** `render-local.mjs` drives `window.render(t)` in headless Chromium (Playwright from `apps/web`) and pipes the frames to ffmpeg. It replaces the external Lemo-Opuscar checkout for this film. Use `--still SECONDS --out frame.png` for a single frame.
- **Three.js:** comes from `npm install three@0.170.0` in any folder outside the repo.
- **Voice:** the narration uses the premade ElevenLabs voice "George". The key comes from `ELEVENLABS_API_KEY` or the repo's untracked `.env.local`.
- **Sound:** effects and music are reused from the Japan and Montreal films, so there are no sound-generation calls.
- **Timing:** shot lengths are fitted to the narration (`timing.json`).
