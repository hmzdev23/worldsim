# Run recap film

This film is a recap of any single simulation run, followed through one invented local. It reads the run's canonical result (`GET /scenarios/{id}/result`).

## How it follows the run

- **Shots:** each shot is one of the run's events, kept in the run's order. Each shot shows that event's place and simulated time, and the scene is chosen by its event type.
- **Selection:** the film keeps the first event, the last event, and the most severe events in between. It drops events until the film fits in 50 seconds.
- **Narration:** the film names the country first and repeats it when the story crosses into a different country. The local place and time appear on screen. It uses the run’s event description when it fits, with a short event summary as a fallback.
- **The local:** the person's name and look come from the first place's region, and they always wear yellow.
- **Map:** events without a matching 3D scene use the web app’s country outlines and a marker at the exact event location.
- **Humor:** a film can include one aside about what is on screen, when it fits the timing budget.

## Build

```sh
python3 make-script.py --run RUN_ID [--server http://127.0.0.1:8765]   # or --result file.json, or --fixture NAME --seed N
python3 make-audio.py              # ElevenLabs voice XA3P1cj7XJexe6Zq0ATX, cached; refuses films over 50 s
python3 make-audio.py --estimate   # no API call: estimated timing for previews
node ../../render-local.mjs . --three "$THREE_ROOT" --out output/picture.mp4
python3 assemble.py                # output/run-<seed>.mp4 + .srt
```

`scripts/recap-film.sh` runs all of these. The files these steps generate (`script.json`, `timing.json`, `audio/voice-*` and `output/`) are git-ignored. The sound effects in `audio/sfx-*` come from the team's other films.
