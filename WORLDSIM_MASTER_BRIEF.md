# WORLD//SIM — Master Project Brief, Conversation Record & Multi-Agent Operating Protocol

> **Current setup:** See the [README](README.md) for the GitHub task queue and the Codex CLI Director prototype. The Claude API plan below records the original discussion. Mathys is the current spelling; historical quotations are preserved.

**Status:** Hackathon concept / pre-implementation

**Last updated:** 2026-11-21

**Audience:** Hamza (Codex), Mathys (Claude Code), Anthony (Claude Code), Amir (Claude Code), and any future coding agents

**Purpose:** A self-contained source of context, architecture, product intent, coordination rules, initial work allocation, and conversation history. Read this before making changes.

> **Important:** This file distinguishes agreed product direction from implementation proposals. It is not evidence that code, a GitHub repository, integrations, or API credentials already exist. The chronological record below includes the user's original requests and detailed summaries of assistant responses; it is **not** a byte-for-byte export of every assistant message.

---

## 0. Read this first — agent boot protocol

If the human operator says **“I'm Hamza”**, **“I'm Mathys”**, **“I'm Anthony”**, or **“I'm Amir”**, follow this procedure:

1. Read this entire brief, then `AGENTS.md`, `CLAUDE.md` (if present), `docs/ARCHITECTURE.md`, `docs/PRODUCT.md`, and applicable files in `contracts/`.
2. Identify the operator's role in **Section 9**. Do not take work assigned to another person without an explicit handoff.
3. Inspect the current repository state: `git status`, current branch, recent commits, open GitHub Issues/PRs if GitHub access is available, and project tests. Never assume the plan in this file is more current than merged code or approved issues.
4. Summarize to the operator: your assigned domain, what is implemented, your highest-priority ready task, blockers, and the next concrete action.
5. If GitHub is available, claim the relevant issue and use a dedicated branch. If no issue exists, propose/create one within the assigned scope; do not silently implement an unapproved architectural change.
6. Implement incrementally, run tests, and report changed files, test results, decisions, and blockers. Open a PR for review. Do not claim tests passed if not run.
7. Keep the human operator updated at meaningful milestones, especially when blocked or when a cross-team contract must change. **Do not promise background updates or autonomous work when no running agent/session/automation supports them.**

**Suggested first prompt to any coding agent:**

> I'm [Hamza/Mathys/Anthony/Amir]. Read `WORLDSIM_MASTER_BRIEF.md` and the repository agent instructions. Identify my ownership area, check current GitHub issues and repository status, tell me what you will do next, and start the highest-priority unblocked task on a feature branch. Keep me updated at meaningful milestones, and do not change shared contracts without review.

**Precedence for conflicts:** explicit current human instructions > merged contracts and code > accepted GitHub issues/architecture decisions > this historical briefing > speculative suggestions. Escalate unresolved contradictions.

---

## 1. Product in one paragraph

**WORLD//SIM** is an entertaining, stylized, animated, interactive global sandbox: users see a pannable/zoomable world map, type a hypothetical large-scale event (pandemic, earthquake, war, infrastructure failure, economic shock, etc.), and watch an AI-directed timeline unfold. Countries, institutions, and synthetic populations react; events appear on the map as visual effects, movements, heatmaps, and alerts; a fictional AI newsroom reports developments. Users can pause, speed up (e.g., 1×/2×/4×/16×), rewind, branch the timeline, intervene, and compare counterfactual outcomes. It should feel like a blend of **Plague Inc.**, **Hearts of Iron IV**, and a modern AI-agent world simulator—not a static analytics dashboard.

### Pitch

> We built an AI-powered digital twin-inspired sandbox of humanity. Give it a hypothetical global crisis, watch autonomous governments and populations respond, then rewind time and explore how different decisions might change the outcome.

**Scientific caveat:** It is an exploratory, fictional counterfactual simulator, **not** a validated forecast or a literal digital twin of every real person. Label simulated news and outcomes clearly.

---

## 2. Product vision and UX

### Core experience

1. Open WORLD//SIM to a living world view: stylized political/physical geography, country boundaries, cities, routes, ambient animations.
2. Type a natural-language scenario, such as “A magnitude 9.1 earthquake strikes Japan” or “A novel virus emerges in Singapore.”
3. Claude, acting as **World Director**, interprets the prompt into structured initial conditions and plausible event proposals.
4. A simulation/event engine advances a deterministic or seeded timeline in simulated time and maintains authoritative world state.
5. The UI plays animated events in the correct places: earthquake shockwaves, disease spread, aid shipments, travel restrictions, power outages, trade movements, changing country conditions.
6. A **WORLD//WIRE** fictional news panel displays headlines generated from events already recorded by the simulation. Clicking a story flies the camera to its location and highlights the associated event.
7. The user pauses, scrubs, adjusts speed, inspects a country, and eventually rewinds to branch history with a different intervention.
8. A comparison view contrasts branches and explains causal mechanisms and uncertainty.

### Essential visual feel

- **Stylized grand-strategy geography + sleek futuristic command-center overlays**.
- Panning, zooming, animated routes, country highlighting, smooth camera fly-to, readable labels.
- Live ticker/news cards, alerts, simulation day/time, event log, playback toolbar, scenario prompt.
- Visual polish is important: it should be fun to *watch*, not only intellectually interesting.
- Generative images can support artwork, icons, textures, backgrounds, or concept exploration, but **must not substitute for a geographically correct interactive map**.
- Candidate map stack: **MapLibre GL JS + deck.gl**; alternatives require a documented decision.
- Optional future polish: fictional AI news anchor and text-to-speech; person-level inspector with on-demand persona generation; dramatic map effects; cinematic event-following camera.

### Possible event visual types

`earthquake_shockwave`, `pandemic_heatmap`, `power_grid_failure`, `emergency_mobilization`, `animated_transport_route`, `migration_flow`, `trade_disruption`, `country_status_change`, `breaking_news`, `camera_focus`, `weather_disaster`.

### Example timeline (illustrative, not a prediction)

- Day 1: New infections emerge in Tokyo.
- Day 7: International travel spreads infections.
- Day 21: Some governments impose restrictions.
- Day 60: Economic and supply-chain consequences emerge.
- Day 180: Compare the outcome with alternative interventions.

The original user examples also included natural disasters, pandemics, and wars. War-related functionality, if implemented, should remain at high-level societal and geopolitical consequences rather than operational military targeting.

---

## 3. The four conceptual simulation layers

1. **Physical world:** geography, borders, cities, infrastructure, transportation, resources, climate.
2. **Population:** synthetic demographic cohorts with location, age, occupation, income, household and health state, mobility, and behavioral variation.
3. **Institutional agents:** governments, public-health authorities, corporations, central banks, international organizations; initially a small set of country agents.
4. **Simulation intelligence:** Claude scenario interpretation and event planning, numerical models, state engine, orchestration, explanatory news.

### Eight billion agents: important interpretation

The user envisions **8+ billion tiny AI agents**, representing the world's human population with demographic realism. **Do not** instantiate 8 billion Claude/LLM sessions. Represent billions of people through **weighted synthetic cohorts or regional aggregates**; run inexpensive numerical transitions; generate individual personas only on demand for inspection. An example cohort could represent 50,000 people in Mumbai, with demographic/occupation/health/mobility attributes. A cohort's attributes should be probabilistic and evidence-based, **not a claim that nationality or gender fixes personality**. Preserve diversity within each group and avoid stereotypes.

### Modeling integrity

- **LLMs propose actions and explain events; simulation code owns state and computes outcomes.**
- Never let Claude freely invent authoritative infection counts, GDP, casualties, or other measured outputs when a numerical model should calculate them.
- Distinguish data-backed initialization from speculative dynamics and generated narrative.
- Where feasible use random seeds, uncertainty ranges, multiple runs, provenance, and model limitations.
- A high-quality **narrative simulator first**, extensible to genuine agent-based and numerical emergence later, is the chosen MVP strategy.

---

## 4. Claude World Director — intended behavior

Claude API is the **main AI service**. A future server-side `ANTHROPIC_API_KEY` will be provided by the team. **Never paste it into source control, commit it, expose it in browser bundles, or log it.** Do not assume a key exists yet.

### Initial MVP flow

`User prompt → Claude Scenario Planner/World Director → schema-validated events → backend state/event scheduler → WebSocket stream → animated frontend + newsroom`.

Later, make it cyclical:

`World state snapshot → Claude observes → proposes next events/government actions → validation → numerical/state engine resolves consequences → new snapshot → repeat`.

Prefer **small event batches** over one enormous, fixed timeline, so interventions can alter future outcomes. Cache event sequences for playback; changing playback speed should **not** make extra LLM calls. Agent decisions should be periodic rather than token-by-token continuous.

### Illustrative event shape from conversation (not yet approved contract)

```json
{
  "simulation_day": 3,
  "events": [
    {
      "type": "infrastructure_failure",
      "location": "Tokyo",
      "severity": 0.85,
      "description": "Major power disruptions",
      "visual": "power_grid_failure"
    },
    {
      "type": "government_response",
      "country": "Japan",
      "action": "deploy_emergency_services",
      "visual": "emergency_mobilization"
    },
    {
      "type": "international_aid",
      "origin": "United States",
      "destination": "Japan",
      "visual": "animated_transport_route"
    }
  ]
}
```

**Proposed hardening:** stable event ID, simulation ID, branch ID, simulated timestamp, country/region/geographic coordinates, event type, payload, animation key, causal parent IDs, provenance (`model`, `user`, `numeric`), and schema version. The schema in `contracts/events.schema.json` must be approved before teams implement incompatible versions.

### Newsroom

**WORLD//WIRE** is a fictional, live-feeling feed. Generate short breaking news from **confirmed simulation events**. Display simulated day/time and label every headline as **SIMULATED**. Clicking a card focuses the map. Never present generated news as actual current events. Optional future narration/TTS.

---

## 5. Technical architecture (proposed)

| Component | Proposed stack | Owner |
|---|---|---|
| Web UI and map | Next.js, React, TypeScript, MapLibre GL JS, deck.gl | Hamza |
| World Director | Claude API, structured outputs, prompt templates | Mathys |
| Simulation API | Python, FastAPI, NumPy | Anthony |
| Live events | WebSockets, JSON event contracts | Anthony + Hamza |
| Newsroom | Claude API, event-derived news | Amir |
| Integration/test harness | Shared fixtures, end-to-end tests, CI | Amir, with all owners |
| State persistence | Initially in-memory + JSON snapshots or SQLite; PostgreSQL later | Anthony |
| Repo coordination | GitHub Issues, PRs, protected main, CI | All |

### Suggested repo layout

```text
worldsim/
├── WORLDSIM_MASTER_BRIEF.md
├── AGENTS.md
├── CLAUDE.md
├── README.md
├── .env.example
├── docs/
│   ├── ARCHITECTURE.md
│   ├── PRODUCT.md
│   ├── DECISIONS.md
│   ├── TASKS.md
│   └── HANDOFFS.md
├── contracts/
│   ├── events.schema.json
│   ├── world-state.schema.json
│   └── api.md
├── apps/
│   └── web/
├── services/
│   ├── director/
│   ├── simulation/
│   └── newsroom/
├── tests/
└── .github/
    ├── workflows/
    ├── ISSUE_TEMPLATE/
    └── pull_request_template.md
```

**Do not create empty scaffolding blindly:** establish a minimal runnable skeleton, mock fixtures, shared contracts, and one working end-to-end vertical slice first.

### MVP integration milestone

**One hardcoded earthquake event** travels through the entire system: mock event JSON → backend event stream → frontend animation → fictional news card → click news to focus camera. This can run **without an API key**. Replace mock director/newsroom with Claude only after the pipeline works.

---

## 6. Features by priority

### P0 — Demonstrable vertical slice

- Interactive pannable/zoomable world map, country borders.
- Natural-language scenario input and a few scenario presets.
- A validated structured event schema.
- Simulation clock and playback controls: pause/play, at least 1×/2×/4× (16× optional).
- Earthquake animation or similar highly visible effect.
- Real-time event delivery (WebSocket or a simpler tested stream if necessary).
- Fictional news card tied to an event and map location.
- Deterministic mock scenario with stable IDs/timestamps.
- Runnable local development instructions and automated smoke test.

### P1 — Hackathon differentiators

- Claude generates event batches from a prompt.
- 5–10 country/government decision agents, if feasible.
- Country inspection and changing status overlays.
- Rewind and timeline branching from saved snapshots.
- Compare two outcomes after intervention.
- Animated aid routes, pandemic heatmap, cinematic camera.
- Clear simulation-vs-real-world disclaimers.

### P2 — Post-MVP

- Multiple specialized scenario engines: pandemic SEIR, trade, migration, energy, infrastructure.
- Cohort-based population simulation with realistic demographic initialization.
- On-demand simulated citizen interviews.
- News anchor narration/TTS.
- Multiple stochastic trials and uncertainty bands.
- More institutions and richer diplomacy/economics.

### Potential scenarios

- Earthquake in Japan/Taiwan → infrastructure failure, humanitarian response, chip supply-chain disruption.
- Novel pandemic in Singapore/Tokyo → travel, infections, health policy, economic effects.
- Suez Canal blocked for six months → shipping and supply-chain disruption.
- Global internet outage for 72 hours → finance, logistics, communications.
- Major solar storm → power, satellites, transport.
- Sudden 40% drop in oil production → energy, trade, inflation.
- Global four-day workweek → labor/productivity/consumption.
- One-meter sea-level rise → migration, geography, infrastructure.
- AI automates 50% of office tasks → employment, wages, education.

These are **hypothetical scenario ideas**, not implemented or validated models.

---

## 7. Reference data and visual approach

- UN World Population Prospects: https://population.un.org/wpp/
- World Bank: https://www.worldbank.org/en/home
- Natural Earth geography: https://www.naturalearthdata.com/
- WHO data: https://www.who.int/data

Inspect source licenses, dates, granularity, and usage restrictions before importing. For the hackathon, prioritize small reliable datasets over a giant unverified data ingestion system.

Visual references discussed: **Plague Inc.**, **Hearts of Iron IV**, dark futuristic global command centers, stylized grand-strategy maps, glowing transport routes, heatmaps, shockwaves, breaking-news UI. These are inspiration, not permission to reuse copyrighted assets. Generate original assets if desired.

---

## 8. Timeline and demo plan

### Proposed 48-hour sprint (adapt to actual schedule)

- **Hours 0–8:** repo, contracts, interactive map, population/border data, scenario input.
- **Hours 8–18:** clock, mock event scheduler, simple disease/event engine, live transport.
- **Hours 18–30:** Claude director integration, small number of government agents if feasible.
- **Hours 30–40:** map animations, news cards, playback, timeline branching.
- **Hours 40–48:** integration, polish, CI, demo rehearsal, fallback mock mode.

### Ideal demo script

1. Start on an animated world map.
2. Prompt: “A novel virus emerges in Singapore” or “A magnitude 9.1 earthquake strikes Japan.”
3. Watch the timeline progress and major events animate.
4. News flashes; click a headline to fly to the affected region.
5. Inspect government decisions and world state.
6. Rewind to an earlier day, choose an intervention, and replay.
7. Compare branches and explain differences and uncertainty.

**Demo fallback:** prerecorded/seeded JSON events should always work if Claude API, network, or rate limits fail.

---

## 9. Team roster and ownership

**Named members, as explicitly supplied by the user:** Mathys, Anthony, Amir, Hamza.

**Assignment status:** Hamza's frontend ownership follows the earlier recommendation. The other name-to-role mappings are **proposed defaults pending team confirmation**. Do not represent them as confirmed decisions.

| Human name | Coding agent | Initial role | Owned paths | Initial mission |
|---|---|---|---|---|
| **Hamza** | **Codex** | Frontend / animated world | `apps/web/**` | Interactive map, camera, event visuals, playback controls |
| **Mathys** | **Claude Code** (assumed) | Claude World Director | `services/director/**` | Scenario prompt → validated event batches, agent decision prompts |
| **Anthony** | **Claude Code** (assumed) | Simulation/backend | `services/simulation/**` | Clock, world state, event application, FastAPI, streaming |
| **Amir** | **Claude Code** (assumed) | Newsroom / integration / QA | `services/newsroom/**`, `tests/**`, CI | Event-derived fictional news, integration harness, end-to-end tests |

Shared paths `contracts/**`, `docs/ARCHITECTURE.md`, root agent instruction files, and global configuration require cross-team review. Every person can suggest changes; nobody silently breaks an interface used by another module.

### Agent onboarding examples

**Hamza:** “I'm Hamza. Own the frontend. Read the contracts, start the animated map issue, use mock events first, and update me on progress.”

**Mathys:** “I'm Mathys. Own the Claude director. Build prompt-to-event structured generation against the agreed schema; mock the Claude call if the key is unavailable.”

**Anthony:** “I'm Anthony. Own the simulation backend. Implement the event loop, state model, and WebSocket API; coordinate event contract changes with Hamza and Mathys.”

**Amir:** “I'm Amir. Own the newsroom and integration. Make fictional news from confirmed events, add the news/map linkage and tests, and coordinate with the other three.”

### Expected agent status report

```text
Operator: <name>
Area: <role>
Issue / branch: <issue-number> / <branch>
Completed: <concrete changes>
Checks: <commands and actual results>
Blocked by: <specific dependency or none>
Contract changes: <none or linked proposal>
Next: <one concrete step>
```

---

## 10. WORLD//SYNC — GitHub-based collaboration protocol

**WORLD//SYNC** is a proposed **repository workflow convention**, **not** an existing external standard, MCP server, or real-time chat bus.

### State machine

1. **SYNC:** `git fetch`, inspect `main`, read latest contracts, assigned GitHub Issues, PRs, and docs.
2. **CLAIM:** assign/claim a task; create branch `feat/<area>-<short-description>` or `fix/<area>-<short-description>`.
3. **BUILD:** implement only within scope; use mock interfaces for unmet dependencies.
4. **VALIDATE:** run lint, typecheck, unit/integration tests and schema validation applicable to the change.
5. **REPORT:** open PR with summary, changed files, tests, contract changes, blockers, dependencies, and screenshots/video for visual changes.
6. **INTEGRATE:** peer review, passing CI, merge to `main`; dependent agents re-sync.

### Suggested GitHub issue labels

`frontend`, `director`, `simulation`, `newsroom`, `integration`, `contract-change`, `blocked`, `bug`, `priority:P0`, `priority:P1`.

### Initial GitHub issues (proposed)

- **WEB-001 — Render animated world map:** owner Hamza; pan/zoom, country borders, a hardcoded marker/shockwave; done when visible and testable locally.
- **DIR-001 — Scenario-to-event schema output:** owner Mathys; mock JSON first, then Claude structured output; done when fixture validates.
- **SIM-001 — Simulation clock and event stream:** owner Anthony; load mock events, advance time, expose snapshot and stream; done when a client receives ordered events.
- **NEWS-001 — Event-driven fictional news feed:** owner Amir; generate/display a card from an event and link it to map focus; done when a click highlights the event location.
- **INT-001 — Earthquake vertical slice:** jointly owned, coordinated by Amir; connect the above; done when reproducible without API keys.
- **CONTRACT-001 — Approve event/world-state contracts:** cross-team prerequisite; designate a reviewer from each affected area.

### Branching and merge rules

```bash
git checkout main
git pull origin main
git checkout -b feat/world-map
# code, test, commit
git push -u origin feat/world-map
# open a PR, request review, merge after CI
```

- Never push directly to `main`.
- Configure protected main / ruleset where available; require CI and a human review if supported.
- Do not let multiple agents concurrently modify the same worktree without coordination; separate branches and preferably separate worktrees/clones.
- A contract change needs an explicit PR and signoff from affected owners. Prefer backward-compatible additions and schema versions.
- GitHub Issues are the task queue; PRs are implementation handoffs; contracts are the machine-readable integration agreement; docs/DECISIONS.md records major choices.
- `docs/HANDOFFS.md` is a human-readable summary, **not** a replacement for Issues/PRs or authoritative code.
- Agents should not claim to have messaged each other merely because they edited a file. GitHub-based communication happens when content is pushed/published and others sync/read it.
- No automatic background work, notifications, or cross-agent awareness should be promised without explicitly configured infrastructure.

### Suggested pull request template

```markdown
## Issue / Owner
## What changed
## Files / modules touched
## Tests run and results
## Contract changes (none / linked PR)
## Screenshots or demo (if UI)
## Dependencies / blockers
## What the next agent needs to know
```

### Why not direct agent-to-agent messaging yet?

The team discussed MCP or a custom orchestration service, but **deferred it**: for four developers on a hackathon, GitHub already provides issues, branches, reviews, and CI. Direct communication can be added later only if a real bottleneck emerges.

---

## 11. Shared agent instruction templates

Create root `AGENTS.md` for Codex and root `CLAUDE.md` for Claude Code. Avoid divergent instruction sets.

### Suggested `AGENTS.md`

```markdown
# WORLD//SIM Agent Rules
Read WORLDSIM_MASTER_BRIEF.md first.

- Identify your human operator: Hamza, Mathys, Anthony, or Amir.
- Follow the role/ownership table in Section 9 of the master brief.
- Read architecture, product docs, and applicable contracts.
- Check GitHub issues and current repo state before choosing work.
- Work on a feature branch; do not push directly to main.
- Do not silently modify shared contracts or other owners' modules.
- The simulation engine owns authoritative state; LLM outputs are proposals.
- News must be derived from confirmed simulation events and labeled fictional.
- Never commit or reveal API keys; use server-side environment variables.
- Add tests and report only checks actually executed.
- Open PRs with handoff details and request human review.
- Keep the operator informed at meaningful milestones.
```

### Suggested `CLAUDE.md`

```markdown
# WORLD//SIM — Claude Code
Read and follow ./AGENTS.md and ./WORLDSIM_MASTER_BRIEF.md.
Use the human operator's name to select the ownership area.
Check issues and contracts before implementing.
Do not bypass shared collaboration rules.
```

If tools cannot access GitHub, state that limitation and work against local files; do not invent issue assignments or PR status.

---

## 12. API, security, and simulation quality safeguards

- API keys only on backend, `.env` excluded by `.gitignore`, `.env.example` contains placeholders only.
- Validate Claude JSON against strict schema; reject unknown/unsafe/invalid event types and malformed locations.
- Cap token usage, request concurrency, timeouts, and retries; keep deterministic mock mode.
- Do not allow model text to execute arbitrary code, shell commands, or SQL.
- Version and persist simulation snapshots for rewind/branching; define replay determinism before promising exact rewind.
- Ensure event timestamps are simulation timestamps, not wall-clock unless explicitly labeled.
- Keep map events geographically grounded and data sources attributed.
- Label fictional news prominently and avoid misleading presentation as real breaking news.
- For sensitive disaster/war scenarios, focus on public-interest and high-level effects; avoid pretending precision or validated geopolitical predictions.
- Avoid population stereotypes; nationality/gender are demographic attributes, not personality determiners.
- Protect against prompt injection in user prompts, LLM outputs, external data, and GitHub issue content.

---

## 13. Decisions, proposals, and unresolved questions

### Clearly expressed user preferences

- Build this ASAP as a **four-person hackathon project**.
- The world must be **animated, entertaining, stylized, pannable, and game-like**.
- The **Claude API** should be the main AI responsible for event/timeline generation.
- The user particularly likes **AI-generated live news**.
- Team coordination should work with **Codex and Claude**, ideally using **GitHub**.
- Each named human should have a role so they can identify themselves to their coding agent and immediately start assigned work.
- The master brief should include **everything discussed and conversation history**.

### Assistant recommendations accepted positively but not yet technically ratified

- Claude as iterative World Director rather than one monolithic script.
- Structured event output + separate animation renderer.
- GitHub as source of truth for tasks and code.
- Stylized strategy-map + futuristic UI aesthetic.
- Narrative simulation first, extensible to more realistic models.
- Mock earthquake vertical slice before real Claude integration.

### Open questions for the team

- Confirm whether **Mathys = Director, Anthony = Simulation, Amir = Newsroom**.
- Confirm whether all three teammates use **Claude Code** or other Claude products.
- Choose GitHub organization/repository name and access rights.
- Decide if map is flat 2D, tilted 2.5D, or 3D globe for MVP.
- Finalize event and world-state schemas and API endpoints.
- Decide which scenario to showcase (earthquake vs pandemic).
- Choose whether initial event generation is precomputed batches or a state-driven loop.
- Determine hackathon deadline, judging criteria, and exact team capacity.
- Confirm whether branch protection and GitHub Actions are enabled.
- Determine Claude model, API limits/budget, and availability of credentials.

**Do not block all work on these questions.** Start with mocks, minimal contracts, and a runnable vertical slice; escalate only decisions that affect cross-team compatibility.

---

## 14. Chronological conversation history and decision trail

This section records **the full topical progression of the WORLD//SIM discussion in this conversation**, including direct user messages and detailed assistant-response summaries. It is a faithful briefing, **not a verbatim reproduction of every assistant paragraph, image, chart, or UI element**. Earlier unrelated chats are not part of this project history.

### Exchange 1 — Original concept (user)

> “I basically we're thinking, right? We're gonna have some kind of AI world sandbox where we simulate the entire human population as it is. And every single human is an AI agent. So we have like 8 billion really small AI agents. And their personalities reflect the country they're from, their gender. It's like very accurate to the real world population. And basically what we want, like the actual flow of the application is you open it, like you see a view of the world map and you prompt it to simulate like some kind of mass world event, like a natural disaster or a pandemic or a war or something. And it's gonna simulate in real time or like 2x speed, 4x speed, kind of like how PlayGank and Hearts of Iron style games work. It's gonna simulate like the result of that event in real time based on like how the countries would act and whatnot. So, you know, expand on this idea more and see how we can apply it and come up with a brief plan as well”

**Assistant response, detailed record:** Proposed **WORLD//SIM**, inspired by Plague Inc. and Hearts of Iron IV; interactive world map and natural-language global crises; four-layer architecture (physical world, synthetic populations, institutional AI, simulation intelligence); cascading effects such as a Taiwan earthquake affecting semiconductors, supply chains, and humanitarian aid; branching timelines, country/citizen inspection, fictional AI news, natural-language world editing. Explained that 8B actual LLMs are infeasible and recommended weighted demographic cohorts with lightweight rules plus a few LLM institutional agents. Suggested Next.js, React, MapLibre/deck.gl, Python/FastAPI/NumPy, LangGraph optional, WebSockets, and demographic/geographic data. Recommended a focused pandemic MVP, a 48-hour plan, and a compelling demo that rewinds to test intervention. Warned about scientific validity, performance, stereotyping, and scope creep. Also noted that fit with a “Touch Grass” hackathon category depends on organizers' criteria.

### Exchange 2 — Animation and Claude timeline direction (user)

> “It's also important that we have like an animated aspect. So it's actually entertaining to watch. You know, like we want like a world view. And we want to kind of gamify it, like, you know, maybe we want it stylized or something. We can generate images for that and have like the ability to pan over it. And then have a nicer UI on top of that. But anyways, those are later elements to add. I like the idea you're talking about so far, especially the AI-generated live news. That all makes sense. What we're gonna do is I'm gonna give you a Cloud API key that you can, or we'll give it at some point, but that Claude API is gonna be the main AI that actually, you know, has a system prompt that once prompted with a natural disaster or whatever, will kind of like give the timeline of events”

**Assistant response, detailed record:** Emphasized an **animated AI-directed strategy-game world**. Proposed Claude as **World Director** operating in a feedback loop rather than producing a fixed giant timeline. Showed structured JSON events with `simulation_day`, event `type`, `location`, `severity`, `action`, `visual`; the frontend maps event types to animations. Proposed stylized grand-strategy geography + futuristic overlays, animated shockwaves/heatmaps/routes, WORLD//WIRE fictional breaking-news cards that focus the camera, and a stack of Next.js/React, MapLibre/deck.gl, FastAPI, Claude, WebSockets, SQLite/PostgreSQL. Distinguished **A: AI-directed world storytelling** (fast, cinematic MVP) from **B: emergent agent-based simulation** (harder but richer). Recommended A first while designing event contracts to grow into B. Emphasized server-side API key storage, playback independent of API calls, and event schema as the next key artifact.

### Exchange 3 — Four developers and cross-agent communication (user)

> “Okay, this is perfect. This is exactly what we want. And honestly, I want to get started as soon as possible. I'm working in a group of four. I have friends who are using Claude and I'm using Codex. So we need a way to kind of sync and coordinate all of our AI agents, you know, some kind of communication protocol. We can use GitHub for that honestly. But it just needs to be established. I need you to figure out how to handle that for us”

**Assistant response, detailed record:** Proposed GitHub as the coordination layer, not direct agent chat. Introduced **WORLD//SYNC** workflow: SYNC, CLAIM, BUILD, VALIDATE, REPORT, INTEGRATE. Proposed root `AGENTS.md` for Codex and `CLAUDE.md` for Claude Code; shared `contracts/`, architecture/product docs, task/decision/handoff docs; GitHub Issues, PRs, CI, and branch protection. Proposed four roles: frontend/world map; Claude Director/event schema; simulation backend; newsroom/integration. Defined ownership boundaries and contract-change reviews. Recommended initial mock earthquake vertical slice and no custom MCP/A2A protocol yet. Asked whether the repository already exists or should be created. **No repo creation or GitHub configuration occurred in this exchange.**

### Exchange 4 — Comprehensive Markdown and name-based onboarding (user)

> “Okay, I need you to create a markdown file with all possible details, every single thing from this conversation. Even include the conversation history in that markdown file. I'm gonna give that to Codex. Make sure it's briefed on what it is. And also, when we go to GitHub, right? My group members' names are Mateese, Anthony, Amir, and Hamza. I want you to make sure like each role is reflected by one of the names, right? So that, you know, people can just go on GitHub. Like they can pull the repo and then tell their coding agent, hey, my name is this. Start doing my work and, you know, keep me updated or whatever. So we need that kind of efficient communication”

**Resulting deliverable:** This Markdown master brief. Names are attached to proposed responsibilities, agent onboarding is specified in Section 0, and GitHub handoffs are specified in Section 10. No repository or live GitHub issue has been created by writing this file.

---

## 15. Immediate next steps for Codex

If Hamza gives this file to Codex in an empty repo:

1. Confirm proposed team role assignments (or keep them explicitly provisional).
2. Initialize the repository and create `AGENTS.md`, `CLAUDE.md`, minimal docs, `.gitignore`, and `.env.example` with no secrets.
3. Propose the first **versioned event schema** and sample earthquake fixture; get cross-team agreement before binding other modules to it.
4. Scaffold a runnable frontend showing a map and playing the fixture; keep the interface polished but small.
5. Open/prepare the initial GitHub Issues per Section 10 if authenticated GitHub access is available.
6. Have each teammate start with the identity prompt in Section 0, on separate branches.
7. Integrate the mock earthquake end-to-end; only then wire Claude API and expand scenarios.

**North star:** a cohesive, visually compelling, watchable world simulation where a user can prompt an event, see animated consequences, follow fictional news, and eventually rewind and change history.
