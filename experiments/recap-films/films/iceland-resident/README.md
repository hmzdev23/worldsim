# Sigrún's three days (local experiment)

The Iceland eruption fixture, seen through one invented resident of Grindavík. It replaces the earlier news-broadcast cut (`../iceland-satire/`), so every film now has the same humor:

- **One ordinary person:** in a yellow shirt, in every shot. The facts (times, places, aid origin) come from `services/director/fixtures/iceland-eruption.json` and are narrated plainly.
- **The jokes** arrive on her phone as fictional notifications from `worldwire.satire`, and they're aimed at institutions, never at her or the disaster.
- **A running gag** pays off at the end: her flight. It's on the table, cancelled on the departures board, and still delayed on day three.
- **A closing stats card:** notifications, the absurdity index, and flights taken (0).
- **Look and format:** characters look like plausible locals (fair skin, blond, light brown and red hair). At most 50 seconds (this cut is about 38), with the voice `XA3P1cj7XJexe6Zq0ATX`. Everything that moves faces its direction of travel, and the sets reach the horizon.

| # | Event | Sigrún | Her phone |
| --- | --- | --- | --- |
| 1 | just before the eruption | packing, with the suitcase and boarding pass on the table | — |
| 2 | eruption | steps into the street; the fissure glows at its end | ThriftJet Air: VolcanoFlex™ fare |
| 3 | evacuation | rolls her suitcase along the pavement beside the queue of cars | ThriftJet Air: Evacuation Class |
| 4 | power failure | in the shelter as the lights go out | Synergexa: CandleBox™ Premium |
| 5 | flights grounded | sits on her suitcase under "FI 204 LONDON CANCELLED" | Synergexa: shares up 4% |
| 6 | aid from Norway | a 600-page customs form | Committee: a working group for the aid |
| 7 | recovery | walks home; the boarding pass now says DELAYED | Brandwell: apology plus discount code |

## Build

```sh
python3 make-script.py && python3 make-audio.py
node ../../render-local.mjs . --three /path/to/folder-with-node_modules/three --out output/picture.mp4
python3 assemble.py              # output/iceland-resident.mp4 + .srt
```
