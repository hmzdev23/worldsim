# Sigrún's three days (local experiment)

The Iceland eruption fixture, seen through one invented resident of Grindavík. It replaces the earlier news-broadcast cut (`../iceland-satire/`), so every film now has the same humor:

- **One ordinary person:** in a yellow shirt, in every shot. The facts (times, places, aid origin) come from `services/director/fixtures/iceland-eruption.json` and are narrated plainly.
- **The jokes** are built into the airport boards, evacuation signs and public response; there are no phone notification overlays.
- **A running gag** pays off at the end: her flight. It's on the table, cancelled on the departures board, and still delayed on day three.
- **A closing stats card:** the absurdity index and flights taken (0).
- **Look and format:** characters look like plausible locals (fair skin, blond, light brown and red hair). At most 50 seconds (this cut is about 38), with the voice `XA3P1cj7XJexe6Zq0ATX`. Everything that moves faces its direction of travel, and the sets reach the horizon.

| # | Event | Sigrún | In-scene gag |
| --- | --- | --- | --- |
| 1 | just before the eruption | packing, with the suitcase and boarding pass on the table | — |
| 2 | eruption | steps into the street; the fissure glows at its end | airport board starts cancelling flights |
| 3 | evacuation | rolls her suitcase beside the queue of cars | a sign reports the queue is moving at 3 km/hour |
| 4 | power failure | in the shelter as the lights go out | the exit sign becomes the room's main light |
| 5 | flights grounded | sits under "FI 204 LONDON CANCELLED" | the board still asks everyone to keep checking |
| 6 | aid from Norway | help arrives | officials pose beside unopened supplies |
| 7 | recovery | walks home; the board still says DELAYED | her flight remains the running gag |

## Build

```sh
python3 make-script.py && python3 make-audio.py
node ../../render-local.mjs . --three /path/to/folder-with-node_modules/three --out output/picture.mp4
python3 assemble.py              # output/iceland-resident.mp4 + .srt
```

The committed voice clips still contain the previous lines. The local review MP4 is intentionally silent. `make-audio.py` regenerates the changed lines with ElevenLabs and uses the account quota.
