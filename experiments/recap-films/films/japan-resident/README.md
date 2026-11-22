# Mika's four days (local experiment)

The Japan earthquake fixture, seen through one invented resident. Mika wears a yellow shirt and is in every shot. Facts (times, places, the magnitude, where aid came from) come straight from the fixture and are narrated plainly. Satire appears in physical set details: contradictory evacuation arrows, a queue for charging, and a ribbon-cutting for aid boxes. It targets institutions, never Mika or the disaster. Impact estimates aren't used.

| # | Event | What Mika does | In-scene gag |
| --- | --- | --- | --- |
| 1 | one minute before evt-0001 | makes toast at home in Ishinomaki | — |
| 2 | evt-0001, M7.8 quake | the room shakes; she runs and takes cover by the table | the evacuation sign stays perfectly level |
| 3 | evt-0002, tsunami warning | heads out as the siren sounds | the loudspeaker asks the harbor to remain calm |
| 4 | evt-0003, evacuation | walks uphill past contradictory direction arrows | the map points in every direction |
| 5 | evt-0004, power failure | the shelter lights go out | the emergency lights reveal a queue for charging |
| 6 | evt-0010, US aid | rescue teams arrive | officials hold a ribbon-cutting for the supply boxes |
| 7 | evt-0014, aftershock | the gym shakes | the shelter sign updates to "STILL OPEN" |
| 8 | evt-0020, recovery | the train returns, she walks home, and the toast pops | the toast gag pays off |

The film ends on a "Mika's four days" card with the absurdity index and pieces of toast finished (0). There are no phone notification overlays.

## Rules the film follows

- **Length:** 50 seconds at most (`make-audio.py` enforces it). The current cut is 48.5 seconds, including the 3.5-second stats card.
- **Voice:** narration uses the ElevenLabs voice `XA3P1cj7XJexe6Zq0ATX`.
- **Look:** characters look like plausible locals for Ishinomaki (East Asian skin tones, dark hair, natural variety), and Mika has a fixed look.
- **Motion:** every model (people, Kenney cars, train cabs) faces local +Z, and anything that moves is placed with `go()`, which turns it to face its direction of travel. Walking and running speeds match the animation clips, so feet don't slide.
- **Sets:** outdoor sets sit on a ground plane that reaches the horizon, with fog, and the streets run 120 units deep. Interiors are closed rooms with a ceiling.

## Build

```sh
python3 make-script.py [--tone satirical|unhinged] [--name Mika]
python3 make-audio.py            # ElevenLabs narration, cached; writes timing.json
node ../../render-local.mjs . --three /path/to/folder-with-node_modules/three --out output/picture.mp4
python3 assemble.py              # output/japan-resident.mp4 + .srt
```

The characters are the CC0 Quaternius models already in `assets/`. The sound effects are reused from the Japan film.

The narration text and caption timing in this branch are updated, but the committed voice clips still contain the previous lines. The local review MP4 is intentionally silent. Run `make-audio.py` to regenerate the changed lines with ElevenLabs; that uses the account quota.

`make-script.py` picks the beats by event type (earthquake, tsunami_warning, evacuation, infrastructure_failure, international_aid, aftershock, recovery). The structure would carry over to other scenarios, but the sets in `storyboard.js` are still built for this story.
