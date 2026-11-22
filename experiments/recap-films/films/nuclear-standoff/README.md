# Tomas's three days (local experiment)

A fictional nuclear standoff between two invented countries, the Grand Duchy of Borovia and the Republic of Kestria. They sit on invented islands in the South Pacific, under ISO's user-assigned codes `XBO` and `XKE`, so the film is about no real conflict, government or leader. We follow one invented person, Tomas, a clerk who writes reassuring pamphlets for the Kestrian government.

- **Facts:** the events come from `services/director/fixtures/nuclear-standoff.json`, through the real Director validator, and are narrated plainly.
- **The detonation:** shown once, from far above, as a small cartoon cloud on the map, with no joke attached.
- **Jokes:** they come from `worldwire.satire` on Tomas's phone and in the shelter (the emergency meeting to schedule the emergency meeting), and they're always aimed at institutions.
- **Not shown:** casualty estimates are in the fixture for the live app's impact panel, but they're never used in the film.

| # | Event | Tomas | His phone |
| --- | --- | --- | --- |
| 1 | cyber_attack | at home, the laptop says NO CONNECTION; pamphlet "DON'T PANIC, draft 3" | Synergexa: "our servers are fine… our servers are down" |
| 2 | conflict_escalation | walks the street as the siren sounds and jets pass overhead | anchor: "either an escalation or a de-escalation" |
| 3 | evacuation | queues into Public Shelter 12 | ThriftJet Air: Evacuation Class |
| 4 | nuclear_detonation | map of the islands, a distant flash and cloud over the Kestrel Point naval base | none |
| 5 | contamination | in the shelter, under the "EMERGENCY MEETING (TO SCHEDULE EMERGENCY MEETING)" banner | Committee: "whether this is on the agenda" |
| 6 | ceasefire | everyone stands and claps at the TV | Committee congratulates itself |
| 7 | recovery | walks home to the finished pamphlets | Brandwell: apology plus discount code |

The film ends on "Tomas's three days", which counts notifications, the absurdity index, and reassuring pamphlets read (0). It runs about 42 seconds (50 seconds at most), with the voice `XA3P1cj7XJexe6Zq0ATX`.

## Build

```sh
python3 make-script.py [--tone satirical|unhinged] [--name Tomas]
python3 make-audio.py
node ../../render-local.mjs . --three /path/to/folder-with-node_modules/three --out output/picture.mp4
python3 assemble.py              # output/nuclear-standoff.mp4 + .srt
```
