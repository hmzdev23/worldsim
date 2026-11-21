# WORLD//WIRE newsroom

Turns **applied** simulation events into short, clearly fictional news items, one story per event (NEWS-001 #5, NEWS-003 #28). Templates are keyed by event type, not by scenario, so any prompted crisis gets the same treatment. Python 3.10+ standard library only, with no API key and no model calls.

```bash
cd services/newsroom
python3 -m worldwire ../../contracts/fixtures/japan-earthquake.json                 # print the feed as JSON
python3 -m worldwire ../../contracts/fixtures/japan-earthquake.json --html wire.html # self-contained preview page
python3 -m worldwire ../../contracts/fixtures/japan-earthquake.json > feeds/japan-earthquake.json  # regenerate the web feed
python3 -m unittest discover -s ../../tests/newsroom                 # tests
```

## News item shape

```json
{
  "id": "news-evt-0001",
  "event_id": "evt-0001",
  "event_type": "earthquake",
  "severity": 0.9,
  "label": "SIMULATED",
  "headline": "M7.8 earthquake strikes off the coast of Miyagi, Japan",
  "dek": "Simulated estimates so far: 8 dead, 310 injured, 40 missing. A powerful offshore earthquake ...",
  "sim_time_minutes": 402,
  "sequence": 0,
  "sim_time_label": "DAY 1 · 06:42",
  "focus": { "event_id": "evt-0001", "lat": 38.3, "lon": 142.4, "zoom": 6.0 },
  "provenance": "template"
}
```

- Every item has `label: "SIMULATED"`, and the UI shows it next to the simulation time.
- Events with any status other than `"applied"` are skipped. Only events the simulation has confirmed become news.
- The feed is deterministic and sorted newest first by `(sim_time_minutes, sequence)`.
- `WireFeed` holds the live feed: `feed.apply(message)` adds a story on an applied `event`, replaces everything on a `snapshot` (connect, seek, or replay), and ignores `clock`. `news_from_stream(messages)` folds a whole sequence. Proposed or rejected events never appear.

Each event type in the contract has its own headline template, and `international_aid` uses `payload.origin` when present. A type the newsroom doesn't know yet gets a generic headline such as `Solar flare reported in …`. A test fails if the contract adds a type without a template.

## Alert-ready copy (NEWS-004)

Each item can be shown as a large in-game alert:

- **Headline** says what happened and where, in at most 72 characters (`HEADLINE_MAX`). When `Name, Country` would be too long, only the place name is used. No figures appear in headlines, except that aid headlines name the contributor and its quantities.
- **Dek** is at most 160 characters (`DEK_MAX`). It leads with the most useful impact figures, then the event's own `payload.description` if it still fits. When neither is available, a generic simulated line for the event type is used instead.
- **Follow-ups read as follow-ups.** `derive_news` walks applied events in canonical order and gives each one the previous impact snapshot and a count of earlier events of the same type. Examples:
  - a second aftershock reads `Another M6.1 aftershock rattles …`
  - a second government response reads `Japan steps up emergency response in …`
  - a second aid delivery from the same country reads `… has now sent …`
  - recovery headlines follow what improved: `Power returning across …`, `Displacement eases in …`
- A story depends only on events before it, so seeking or replaying never rewrites earlier stories. `news_for_event(event)` on its own writes the event without that context.

## Impact figures

When an event carries `payload.impacts`, the dek reports the figures that matter for its type:

| Event type | Figures |
| --- | --- |
| Hazards | Casualties |
| Evacuations | Displacement and shelters |
| Outages and recovery | Households without power or water |
| Economic shocks | Losses |
| Contamination | Contaminated or flooded area, and debris |
| Floods | Flooded area and casualties |

Of those figures, the dek shows only the ones this event changed from the previous snapshot. It shows all of them only if the event changed none. Zero values are left out, and later figures are dropped to keep the dek within its length limit. For example:

- `Regional power grid knocked out in Sendai, Japan`, with dek `Simulated estimates so far: 2.3 million households without power. …`
- `United States sends 180 personnel, 60 tonnes of aid to Yamagata Airport`, with dek `Simulated relief: search-and-rescue teams and relief supplies.`

Impact values are **scenario-wide estimates as of that event**, so each story shows the latest snapshot as given and never adds snapshots together. Every figure is labeled as a simulated estimate. Snapshots without `basis: "fictional_estimate"` are ignored, and malformed values (negative, non-numeric, NaN) are dropped rather than guessed. An omitted key means no estimate yet. On an `international_aid` event, `payload.origin` names the sender. The story reports that country's running totals and cargo from its `impacts.aid_contributors` entry and counts how many countries have sent help. Contributors are never added together.

Field names follow Mathys's DIR-003 (#26) shape agreed in [#13](https://github.com/hmzdev23/worldsim/issues/13). `tests/newsroom/fixtures/impact-chain.json` is a test-only chain covering rejected and proposed events. The NEWS-004 alert checks run against the canonical 20-event `contracts/fixtures/japan-earthquake.json`.

## Live news for any run (NEWS-005)

The simulation service builds the response for `GET /scenarios/{id}/news` from the run's released snapshot:

```python
from worldwire import news_response

body = news_response(sim.snapshot())   # sim is that run's Simulation
```

```json
{
  "schema_version": "0.1",
  "simulation_id": "run-iceland",
  "branch_id": "main",
  "sim_time_minutes": 1500,
  "items": [
    {
      "id": "news-evt-0006",
      "event_id": "evt-0006",
      "event_type": "international_aid",
      "severity": 0.3,
      "label": "SIMULATED",
      "headline": "Norway sends 40 personnel, 25 tonnes of aid to Reykjavik, Iceland",
      "dek": "Simulated relief: gas masks and field shelters.",
      "sim_time_minutes": 1500,
      "sequence": 0,
      "sim_time_label": "DAY 2 · 01:00",
      "focus": { "event_id": "evt-0006", "lat": 64.15, "lon": -21.94, "zoom": 6.0 },
      "provenance": "template"
    }
  ]
}
```

- **Run identity.** The envelope carries `simulation_id` and `branch_id`. Items keep the usual shape, newest first.
- **Released events only.** Only applied events at or before `sim_time_minutes` are reported. The adapter applies this filter even when it receives future events, such as from the `/timeline` view.
- **Stateless.** Each call is derived from scratch from that run's events. Nothing is cached by event ID, so runs that reuse `evt-0001` never mix, and a story reads the same during play, after a seek, and after a replay. A live alert and the archive entry for the same event are identical.
- **Matching in the browser.** Drop a response whose `simulation_id` or `branch_id` isn't the active run. Keep only items whose `event_id` is in the current applied set. That also discards a response that was requested before a seek and arrives after it. The alert shows the item for each newly applied stream event, and the archive shows all kept items.
- **Stream consumers.** `WireFeed` follows one run. A snapshot from another run starts it over, and event messages from any other run or branch are ignored.

## Web panel

`apps/web` imports the generated `feeds/japan-earthquake.json`. Its `WorldWire` component shows a story only for events the simulation stream has applied, and falls back to a basic card for events missing from the feed. A test fails if the committed feed drifts from the fixture. The regenerate command is above.

## Click to focus

When a card is clicked, the page dispatches a window event with the item's `focus` object:

```js
window.dispatchEvent(new CustomEvent("worldsim:focus", { detail: item.focus }));
```

The map (WEB-001) can listen for `worldsim:focus`, then fly to `lat`/`lon`/`zoom` and highlight `event_id`. The preview page uses a stand-in SVG map that handles the same event. If the web app prefers a direct `flyTo(focus)` callback, the `focus` object stays the same.

## Input

Events follow [contracts/events.schema.json](../../contracts/events.schema.json) v0.1. The newsroom reads `id`, `type`, `status`, `severity`, `sim_time_minutes`, `sequence`, `location.{name,country,lat,lon}`, `payload.{magnitude,depth_km,vei,origin,target,pathogen,label}`, and `payload.impacts`.
