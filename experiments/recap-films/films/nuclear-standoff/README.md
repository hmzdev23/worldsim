# Tom's three days (local experiment)

A satirical, clearly fictional UK–France nuclear standoff, followed through one invented person: Tom, a London clerk who writes reassuring pamphlets for the government. The countries are real, but every event is invented. No such war has happened or is predicted, and the end card says so.

**Why the UK and France:** both are real nuclear powers, but a war between them is far-fetched enough to play as comedy. A pair with live tensions would read as commentary on a real conflict.

## Rules

- **No real people or organizations:** no real leader, agency, broadcaster or company appears. Every statement comes from `worldwire.satire`'s invented organizations (Ministry of Reassurance, Committee for Global Stability, ThriftJet Air, and so on).
- **The facts:** events come from `services/director/fixtures/nuclear-standoff.json` through the real Director validator, and are narrated plainly.
- **The detonation:** a single French warning detonation over open water at the southern edge of the Celtic Sea, away from every coastline. It's shown once from high above with real Natural Earth coastlines, and it carries no joke.
- **Jokes:** they're aimed at institutions and arrive on Tom's phone or in the shelter. Casualty estimates are never shown or joked about.
- **Labels:** "SATIRE · FICTIONAL" is on screen throughout.
- **Format:** at most 50 seconds (this cut is about 43), with the voice `XA3P1cj7XJexe6Zq0ATX`. Everything that moves faces its direction of travel, and the sets reach the horizon.

| # | Event | Tom | His phone |
| --- | --- | --- | --- |
| 1 | cyberattack, London | at home, the laptop says NO CONNECTION; pamphlet "DON'T PANIC, draft 3" | Synergexa: "our servers are fine… our servers are down" |
| 2 | France mobilises | walks the street as the siren sounds and jets pass overhead | anchor: "either an escalation or a de-escalation" |
| 3 | London shelters open | queues into Public Shelter 12 | ThriftJet Air: Evacuation Class |
| 4 | warning detonation, Celtic Sea | map of the UK and France; a distant flash and cloud over open sea | none |
| 5 | fallout zone, Isles of Scilly | in the shelter, under "EMERGENCY MEETING (TO SCHEDULE EMERGENCY MEETING)" | Committee: "whether this is on the agenda" |
| 6 | ceasefire, Geneva | everyone stands and claps at the TV | Committee congratulates itself |
| 7 | recovery, London | walks home to the finished pamphlets | Brandwell: apology plus discount code |

## Build

```sh
python3 make-script.py [--tone satirical|unhinged] [--name Tom]
python3 make-audio.py
node ../../render-local.mjs . --three /path/to/folder-with-node_modules/three --out output/picture.mp4
python3 assemble.py              # output/nuclear-standoff.mp4 + .srt
```

`map-europe.json` holds Natural Earth 1:50m coastlines (public domain) for the map shot.
