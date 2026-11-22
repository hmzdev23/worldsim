# Mika's four days (local experiment)

The Japan earthquake fixture, seen through one invented resident. Mika wears a yellow shirt and is in every shot. Facts (times, places, the magnitude, where aid came from) come straight from the Japan earthquake fixture and are narrated plainly. The humor arrives on Mika's phone as fictional notifications from `worldwire.satire`: ministries, committees, an insurer, an airline, brands. It always lands on institutions, never on Mika or on the disaster. Impact estimates aren't used.

| # | Event | What Mika does | Her phone |
| --- | --- | --- | --- |
| 1 | one minute before evt-0001 | makes toast at home in Ishinomaki | — |
| 2 | evt-0001, M7.8 quake | the room shakes, she runs and takes cover by the table | Ministry of Reassurance: "the ground has been asked to remain still" |
| 3 | evt-0002, tsunami warning | heads out as the siren sounds | Shrug Mutual: water-damage small print |
| 4 | evt-0003, evacuation | walks uphill in the orderly queue under the brochure billboard | ThriftJet Air: "Evacuation Class" |
| 5 | evt-0004, power failure | the shelter lights go out and her phone is the only light | Synergexa: CandleBox™ Premium |
| 6 | evt-0010, US aid | rescue teams arrive with a 600-page form; she starts page 1 | Committee: a working group for the aid |
| 7 | evt-0014, aftershock | the gym shakes; she is on page 200 | Committee: a subcommittee on precedent |
| 8 | evt-0020, recovery | the train returns, she walks home, and the toast pops | Brandwell: apology plus discount code |

The film ends on a "Mika's four days" card: notifications received, the absurdity index, and pieces of toast finished (0).

## Build

```sh
python3 make-script.py [--tone satirical|unhinged] [--name Mika]
python3 make-audio.py            # ElevenLabs narration, cached; writes timing.json
node ../../render-local.mjs . --three /path/to/folder-with-node_modules/three --out output/picture.mp4
python3 assemble.py              # output/japan-resident.mp4 + .srt
```

The characters are the CC0 Quaternius models already in `assets/`. The sound effects are reused from the Japan film.

`make-script.py` picks the beats by event type (earthquake, tsunami_warning, evacuation, infrastructure_failure, international_aid, aftershock, recovery). The structure would carry over to other scenarios, but the sets in `storyboard.js` are still built for this story.
