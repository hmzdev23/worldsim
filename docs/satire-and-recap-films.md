# Satire mode and recap films

Owner: Mathys. Branch: `feat/satire-recap-films`. This adds a satirical presentation layer to WORLD//SIM and three short recap films built on it. The simulation itself is untouched: facts, impact estimates and validation work exactly as before, and satire sits on top as an optional layer.

## 1. Satire mode in the app

**Tone selector:** a new control next to the prompt bar offers three tones.

| Tone | What you see |
| --- | --- |
| **Straight-faced** (default) | The original experience, unchanged. |
| **Satirical** | Deadpan WORLD//WIRE headlines, a fictional social feed and an absurdity index. |
| **Unhinged** | The same, but it escalates as the run goes on (committees for committees, and so on). |

**What changes on screen:**
- **Satirical WORLD//WIRE:** each card shows the joke headline with the real headline underneath ("Original report: …"). The map's headline alert uses the satirical copy.
- **Reactions feed:** fictional posts from invented organizations: ThriftJet Air, the Ministry of Reassurance, the Committee for Global Stability (Interim), Brandwell Inc., Synergexa, Shrug Mutual and others. Every post is labelled FICTIONAL.
- **Absurdity index:** press conferences held, committees established, corporate apologies, "the situation remains fluid", and companies cashing in. It's counted from the posts and kept separate from the impact estimates, which it never touches.
- **Follows the clock:** everything is derived from released events only, so pause, seek, replay and reset always show the satire for the current moment.

**Safety rules (enforced by tests):**
- Jokes target institutions, never victims, and never quote casualty figures.
- Authors are invented; no real people, brands, agencies or officials.
- Satire never modifies events, descriptions or `payload.impacts`.

### How it fits the architecture

| Layer | Change |
| --- | --- |
| Contract | Optional `payload.satire` (`headline`, `dek`, up to 4 `posts`). It's additive, and existing batches stay valid. |
| Director | Takes a `tone`. In Satirical or Unhinged, the **same model call** also writes `payload.satire`; there is no extra AI call. Satire is validated like everything else (lengths, `@handle` format, post kinds), and a bad satire block rejects the whole batch. The CLI gets `--tone`. |
| Newsroom | `worldwire/satire.py`: Director satire when present, otherwise deterministic templates keyed by event type, so sample fixtures get satire with no model. `satire_response(snapshot, tone)` mirrors `news_response`. |
| Simulation | `POST /scenarios` accepts `tone` and stores it on the run. New `GET /scenarios/{id}/satire?tone=` and `GET /satire?tone=` (demo) endpoints serve released events only. |
| Web | `ToneSelector`, `SocialFeed` and `AbsurdityIndex` components; `useSatire` in the run console; a `/api/simulation/satire` rewrite. |

### Try it

```sh
./scripts/run-demo.sh          # then pick Satirical or Unhinged and press Play on the Japan demo
```

## 2. Recap films (experiments/recap-films/films)

The format can follow either one resident or the world as a crowd. Fixed scenario fixtures make both approaches repeatable: each film selects the same event beats in the same order, then stages its own scenes around those beats.

- The facts (times, places, magnitude, aid origins) come from a Director fixture and are narrated plainly.
- Jokes appear in the environment and the reactions people can see: signs, departure boards, public displays, queues and official ceremonies. Films do not use phone notifications.
- A running gag pays off at the end.
- The recap follows the event timeline. A brief end card can pay off the running gag and show the absurdity index.
- The protagonist can be a single person for a local event or a crowd/world montage for a global, deliberately absurd scenario.

| Film | Scenario | Point of view | Running gag | Length |
| --- | --- | --- | --- | --- |
| `japan-resident` | Japan earthquake fixture | Mika, Ishinomaki | the toast | 48.5 s |
| `iceland-resident` | Iceland eruption fixture | Sigrún, Grindavík | her delayed flight | 38.3 s |
| `nuclear-standoff` | UK–France standoff (new fixture `nuclear-standoff`) | Tom and the shelter committee | a meeting table that never settles | 42.7 s |

**Rules all three follow:**
- **Length and voice:** 50 seconds at most (`make-audio.py` refuses longer), with the ElevenLabs voice `XA3P1cj7XJexe6Zq0ATX`.
- **Motion:** everything that moves faces its direction of travel. All models face local +Z, and `go()` handles placement. Walk and run speeds match the animations.
- **Sets and look:** outdoor ground reaches the horizon, with fog, and interiors are closed rooms. Characters look like plausible locals for each setting, and the protagonist always wears yellow.
- **Presentation:** satire is clear from the tone and scenes; no phone banner or persistent fiction label is burned into the picture. The nuclear film uses real countries but invented events, has no real leaders or organizations, and shows a single warning shot over open sea plainly and without a joke.
- `iceland-satire` is the earlier news-broadcast cut, kept for reference and superseded by `iceland-resident`.


### Build a film

```sh
cd experiments/recap-films/films/<film>
python3 make-script.py           # script.json from the fixture + satire layer
python3 make-audio.py            # narration (cached by text/voice); needs ELEVENLABS_API_KEY in env or .env.local
node ../../render-local.mjs . --three /path/to/folder-with-node_modules/three --out output/picture.mp4
python3 assemble.py              # output/<film>.mp4 + .srt
```

- **Renderer:** `render-local.mjs` renders with the Playwright Chromium already used by `apps/web` and pipes frames to ffmpeg. Get Three.js with `npm install three@0.170.0` in any folder outside the repo.
- **Single frames:** `--still SECONDS --out frame.png` renders one frame.
- **Audio:** the narration clips are committed, so a render needs no API key. Sound effects are reused from the team's Japan and Montreal prototypes. MP4 exports aren't committed.

## 3. Tests

New tests:
- `tests/newsroom/test_satire.py`: tones, labels, clock and seek consistency, impacts never touched, no casualty figures in jokes, and the metrics derived from the posts.
- `tests/director/test_satire_tone.py`: the prompt per tone, a still-strict output schema, satire validation and whole-batch rejection.
- `tests/simulation/test_satire_routes.py`: tone stored per run, satire endpoints following seek and replay.
- `apps/web/e2e/satire.spec.ts`: the tone selector, labelled satire, reset, and Straight-faced unchanged.

```sh
./scripts/smoke-demo.sh                                  # all Python suites
cd apps/web && npx playwright test --project=desktop     # browser checks
```

Last run, all passing: contracts 12, director 106, simulation 71, newsroom 99, integration 10, desktop Playwright 17.

## 4. Known limits

- **Untested with the real model:** Director-written satire hasn't been run through the real model yet (Hamza's Codex setup); sample fixtures use the template satire.
- **Tone switching:** switching a prompted run's tone after generation keeps the Director's satire in the tone it was written in.
- **Film sets:** each film's sets are hand-built for its story. The scripts pick beats by event type, so adding a new scenario mostly means new scenes.
- **Look:** the characters are simple low-poly models (Quaternius, CC0), and seated people sit on cardboard boxes.
