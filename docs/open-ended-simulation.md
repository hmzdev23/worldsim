# Open-ended simulation

Branch: `feat/open-ended-sim`. WORLD//SIM is no longer a game. There are no roles, no decision points, no score, and nothing to win or lose. Each run follows four steps:

1. **Start:** type a situation, or pick one of ten starter scenarios.
2. **Simulate:** the Director predicts the chain of events, and every run gets a new random seed.
3. **Watch:** the run plays out by itself on the animated map, with WORLD//WIRE (and, if chosen, the satire layer).
4. **Film:** the same run can be turned into a satirical recap film.

Running the same prompt again gives a different, plausible future. Each run still stays causally coherent: every event happens after the events that caused it.

The branch builds on Hamza's #84 stack, which includes the ten starters, the map effects, the variation inputs and the cinematic playback, and merges in `feat/satire-recap-films`.

## One run, one result

Everything reads the run's canonical result:

```
GET /scenarios/{id}/result
{ simulation_id, branch_id, seed, prompt, title, fixture, tone, start_minutes, end_minutes,
  events: [...every applied event, in (sim_time_minutes, sequence) order...] }
```

- **The map** plays these events on the clock.
- **The recap film** reads these same events (`scripts/recap-film.sh RUN_ID`):
  - Every shot is one of them, in the same order, at the same place and simulated time.
  - Nothing is added to the chain. A test checks this for every starter and many seeds.
- **The seed** lives on the run (`GET /scenarios/{id}`, `/result`), not in the event contract, so contract v0.1 is unchanged.

## Randomness

`services/director/worlddirector/variation.py` holds the variation logic.

**Seeds:**
- The server picks a fresh seed for every run (`new_seed()`).
- Clients can't choose or repeat a seed, so no run is repeated.

**Prompted runs (model):**
- The seed picks four directions that are added to the Director prompt: pace, emphasis, how the response goes, and one surprise.
- The model then explores a different future each time.

**Starters (offline fixture):** the seed varies the checked-in chain before validation:
- Times stretch or compress through a strictly increasing map, so cause always comes before effect.
- Severities shift slightly.
- All impact estimates scale by one run-wide factor, so running totals still never fall.
- Sometimes one or two dead-end events (nothing depends on them) don't happen.

**Validation and determinism:**
- The result still goes through the normal validator.
- Tests check all 10 starters across many seeds: all valid, all different, all causal.
- `ScenarioRegistry(seeds=lambda: None)` replays fixtures exactly. It exists for deterministic tests only.

## Map animations

`apps/web/components/map-motion.ts` decides what animates (pure and tested), and `map-motion-layer.ts` draws it on the map. Every animation comes from the run's own events and is labelled an illustration, not a forecast.

**What animates:**

| Trigger | Animation |
| --- | --- |
| A cause link (`parent_ids`) over 280 km | A vehicle flies the great circle and leaves a trail, pointing the way it flies. |
| Volcanic eruption | A giant grey ash cloud billows downwind, sized by VEI. The camera pulls back to show it. |
| Nuclear detonation | A screen flash and a fireball, then a fallout plume. |
| Meteor | A streak in, a flash, and a crater ring. |
| Tsunami warning | Waves roll out across the ocean. |
| Power or cyber failure | The area flickers, then goes dark. |
| Evacuation | People stream outward. |
| Extreme weather | A spinning cyclone. |
| Earthquake or aftershock | The map shakes. |
| Alien contact | A saucer arrives and hovers with a light beam. |
| Ceasefire or recovery | A ring expands once. |

The vehicle depends on the event at the end of the link:

| Event at the end of the link | Vehicle |
| --- | --- |
| Outbreak | Infected traveller's plane |
| Contamination | Cargo plane |
| Evacuation | Evacuation flight |
| Military strike or nuclear detonation | Missile |
| Alien contact | UFO |
| Market, failure, unrest or response | A glowing pulse |

**When animations play:**
- New events animate in real time, so they keep moving while the story holds a headline.
- A seek, a replay or a new run draws everything in its final state, so old events never replay their animation.
- Reduced motion keeps everything static.
- In story mode with auto-follow, the camera rides along with each flight and lands on the destination. Any manual pan stops it.

## What was removed (player mode)

These came from #80, #82 and the onboarding work and are now deleted:

- Decision cards and roles.
- Branching on decisions, scoring and the alternate-timeline comparison.
- The `/player/*`, `/decisions` and `/summary` routes.
- `fixtures/player/*`.
- The role and briefing setup steps.
- Their tests and plan docs.

**Kept:**
- The ten scenario fixtures, now offered as starters (`GET /starters`, `fixtures/starters.json`).
- The nuclear country picker and "change the starting conditions", now optional exploration.
- The cinematic presentation: beat pauses, camera that follows events, headline dwell. Every run started from the home screen now plays as a story, and nothing waits for input.
- Hamza's map effects.

#79 and #81 also add player mode. They are superseded by this branch.

## Recap film for any run

Code: `experiments/recap-films/films/run`, the same format as the satire 3D films.

**Format:**
- One invented local follows the run. Locals and names match the first place.
- The protagonist always wears yellow.
- The facts are narrated plainly.
- The jokes arrive as phone notifications from `worldwire.satire` for that exact event. Each joke is used once per film.
- Strikes and detonations are shown plainly, with no joke.
- A running gag is picked by the seed and pays off at the end, followed by a stats card.

**Rules:**
- "SATIRE · FICTIONAL" stays on screen.
- No casualty figures.
- 50 seconds at most, with the voice `XA3P1cj7XJexe6Zq0ATX`.
- Everything that moves faces its direction of travel.
- Sets reach the horizon.

**Scenes and map:**
- Scenes are chosen by event type: quake, warning, eruption, sky, flood, storm, outbreak, outage, committee, TV, aid, evacuation, market, street, map, home.
- The map shot draws the country shapes from the web app's own `countries.geojson`.

**Build a film:**

```sh
export THREE_ROOT=/path/to/folder-with-node_modules/three   # npm install three@0.170.0
scripts/recap-film.sh RUN_ID                                  # a run on the local server
scripts/recap-film.sh --fixture tsunami --seed 1234           # offline
RECAP_ESTIMATE=1 scripts/recap-film.sh RUN_ID                 # silent preview, no ElevenLabs call
```

Narration needs `ELEVENLABS_API_KEY` in the environment or in the untracked `.env.local`. Generated scripts, voice clips and MP4s are git-ignored.

## Tests

| Suite | Count | New tests |
| --- | --- | --- |
| Director | 119 | `test_variation.py` |
| Simulation | 85 | `test_open_ended_runs.py` |
| Newsroom | 99 | none |
| Integration | 17 | `test_run_film.py` |
| Contracts | 12 | none |
| Playwright (desktop and mobile) | 40 | `starters.spec.ts`, `map-motion.spec.ts` |

Run them with:

```sh
./scripts/smoke-demo.sh
cd apps/web && npx playwright test --project=desktop
```

## Known limits

- **Not run with the real model yet:** the seeded prompt directions haven't been tried with the real Director (Hamza's Codex setup). Starters work offline.
- **Films aren't made from the web page:** the recap film is a local command. Rendering takes a few minutes in headless Chromium, so the web app doesn't start it yet.
- **Starter variation is shallow:** offline starters vary timing, severity, scale and which side branches happen. A different chain of events needs a model run, which happens whenever the prompt or starting conditions are edited.
