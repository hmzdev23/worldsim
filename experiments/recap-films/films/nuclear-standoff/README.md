# Tom's three days (local experiment)

A satirical UK–France nuclear standoff, followed through Tom and the public shelter committee. The countries are real; the scenario events are invented. Tom maintains a public emergency status board, while the committee cannot settle where to put its meeting table.

**Why the UK and France:** both are real nuclear powers, but a war between them is far-fetched enough to play as comedy. A pair with live tensions would read as commentary on a real conflict.

## Rules

- **No real people or organizations:** no real leader, agency, broadcaster or company appears. Every statement comes from `worldwire.satire`'s invented organizations (Ministry of Reassurance, Committee for Global Stability, ThriftJet Air, and so on).
- **The facts:** events come from `services/director/fixtures/nuclear-standoff.json` through the real Director validator, and are narrated plainly.
- **The detonation:** a single French warning detonation over open water at the southern edge of the Celtic Sea, away from every coastline. It's shown once from high above with real Natural Earth coastlines, and it carries no joke.
- **Jokes:** they target institutional process and live in the scene: draft status boards, queue signage and a committee table that keeps shifting. There are no phone notification overlays. Casualty estimates are never shown or joked about.
- **Look:** characters look like plausible Londoners, a real-world mix weighted toward lighter tones with varied hair, and Tom has a fixed look.
- **Presentation:** the tone and scene context carry the satire; there is no persistent disclaimer overlay.
- **Format:** at most 50 seconds (this cut is about 43), with the voice `XA3P1cj7XJexe6Zq0ATX`. Everything that moves faces its direction of travel, and the sets reach the horizon.

| # | Event | Tom / the crowd | In-scene gag |
| --- | --- | --- | --- |
| 1 | cyberattack, London | at home, the laptop says NO CONNECTION | public status board reads UPDATE PENDING |
| 2 | France mobilises | walks the street as the siren sounds and jets pass overhead | status board says ALL CLEAR: DRAFT |
| 3 | London shelters open | queues into Public Shelter 12 | entrance asks everyone to queue calmly |
| 4 | warning detonation, Celtic Sea | map of the UK and France; a distant flash and cloud over open sea | none |
| 5 | fallout zone, Isles of Scilly | in the shelter, under "EMERGENCY MEETING (TO SCHEDULE EMERGENCY MEETING)" | table label says LOCATION UNDER REVIEW |
| 6 | ceasefire, Geneva | everyone stands and claps at the TV | the meeting table shifts again |
| 7 | recovery, London | walks home to an updated board | NORMAL OPERATIONS: DEFINITION PENDING |

## Build

```sh
python3 make-script.py [--tone satirical|unhinged] [--name Tom]
python3 make-audio.py
node ../../render-local.mjs . --three /path/to/folder-with-node_modules/three --out output/picture.mp4
python3 assemble.py              # output/nuclear-standoff.mp4 + .srt
```

The committed voice clips still contain the previous lines. The local review MP4 is intentionally silent. `make-audio.py` regenerates the changed lines with ElevenLabs and uses the account quota.

`map-europe.json` holds Natural Earth 1:50m coastlines (public domain) for the map shot.
