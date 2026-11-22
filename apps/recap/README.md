# Recap video (RECAP-001 to RECAP-004)

After a run finishes, WORLD//SIM can turn it into a short 9:16 recap video with a flat cartoon look. Every number in it is a fictional estimate copied from the run.

| Step | Owner | Command / location |
| --- | --- | --- |
| Storyboard | Amir · #67 | `cd services/newsroom && python3 -m worldwire.storyboard RUN > storyboard.json` |
| Narration (optional) | Mathys · #68 | `services/narration/`, ElevenLabs. The key stays local. |
| Three.js scenes | Hamza · #69 | `apps/recap/src/` (`window.recap.load` / `renderFrame`) |
| MP4 export | Anthony · #70 | `scripts/render-recap.sh RUN` |

`RUN` is a contract event batch, such as `contracts/fixtures/japan-earthquake.json`, or a raw Director fixture, such as `services/director/fixtures/iceland-eruption.json`. A raw fixture is built into a batch first.

- [`storyboard.schema.json`](storyboard.schema.json) is the interface all four parts build against.
- [`samples/`](samples/) holds generated storyboards for the Japan and Iceland trials. A newsroom test fails if they're out of date. To regenerate them:

```bash
cd services/newsroom
python3 -m worldwire.storyboard ../../contracts/fixtures/japan-earthquake.json > ../../apps/recap/samples/japan-earthquake.storyboard.json
python3 -m worldwire.storyboard ../director/fixtures/iceland-eruption.json > ../../apps/recap/samples/iceland-eruption.storyboard.json
```

## Beats
The sample script is a rough skeleton, not a script to follow word for word.

1. **hook**: the initiating event, e.g. `M7.8 EARTHQUAKE HITS JAPAN`.
2. **first_hours**: up to 4 vignettes for different consequences in the first 24 hours.
3. **domino**: up to 3 vignettes after that, with overlays prefixed `DAY n:`.
4. **explainer**: how the hazard works, labelled "Illustration".
5. **response**: aid arrivals by sender and recovery on a map of every reported place.
6. **final**: every statistic from the last impact snapshot.

Scenes are chosen by event type, so nothing is tied to one scenario, and a beat with nothing to show is skipped. Captions reuse WORLD//WIRE headlines. Figures are the event's own snapshot and are never added together. The video makes no real-world claims and gives no survival advice.
