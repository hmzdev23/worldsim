# Recap narration (RECAP-002, #68)

Speaks each scene of a recap `storyboard.json` (#67) with the ElevenLabs text-to-speech API. It writes one MP3 per scene and a `narration.json` that the Three.js renderer (#69) and the MP4 export (#70) read. Narration is optional: without a key the recap renders captions only. Standard library only, Python 3.9+.

```bash
cd services/narration
python3 -m narration ../../apps/recap/samples/japan-earthquake.storyboard.json --out /tmp/recap-japan
python3 -m unittest discover -s ../../tests/narration   # offline, fake HTTP client, no credits
```

## Output

`OUT/<scene_id>.mp3` for every scene, plus `OUT/narration.json`:

```json
{ "voice_id": "JBFqnCBsd6RMkjVDRZzb", "model_id": "eleven_multilingual_v2",
  "scenes": { "s01-hook-earthquake": { "file": "s01-hook-earthquake.mp3", "duration_s": 9.456 } } }
```

- `file` is relative to `narration.json`.
- `duration_s` is read from the MP3 frames themselves (no ffprobe needed). It matches macOS `afinfo` to within about 0.03 s.
- A scene lasts `max(min_duration_s, duration_s)`.

## Key and settings

| Setting | Source | Default |
| --- | --- | --- |
| `ELEVENLABS_API_KEY` | environment, else `.env.local` in the current directory or the repo root | none: prints `narration skipped: ELEVENLABS_API_KEY not set` and exits 0 without writing `narration.json` |
| voice | `--voice`, else `ELEVENLABS_VOICE_ID` | `JBFqnCBsd6RMkjVDRZzb` (premade "George") |
| model | `--model`, else `ELEVENLABS_MODEL_ID` | `eleven_multilingual_v2` |

`.env.local` is git-ignored. The key is only sent in the `xi-api-key` header to `api.elevenlabs.io`. It is never printed or written to output, and it's redacted from error messages.

## Credits and caching

- **Cost:** each scene is one `POST /v1/text-to-speech/{voice_id}?output_format=mp3_44100_128`. A sample storyboard is about 1,000–1,300 characters.
- **Cache:** audio is stored in `OUT/.cache/` (or `--cache-dir`), keyed by a SHA-256 of the text, voice, model and format. Re-running costs nothing, and changing any of them makes new audio. Bad responses are never cached.
- **Errors:** HTTP or network failures exit 1 with a short message such as `narration failed: ElevenLabs returned HTTP 401: …`, and write no `narration.json`.
