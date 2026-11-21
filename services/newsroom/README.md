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
  "dek": "Simulated shaking reported across Japan ...",
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

Each event type in the contract has its own headline template, and `international_aid` uses `payload.origin` when present. A test fails if the contract adds a type without a template.

## Impact figures

When an event carries `payload.impacts`, the story reports the figures that matter for its type. Casualties go with hazards, displacement with evacuations, households without power or water with outages and recovery, losses with economic shocks, contaminated or flooded area and debris with contamination, and contributors with aid. For example:

- `An estimated 210,000 people displaced as evacuations widen in Sendai, Japan`
- `United States has now sent 500 personnel and 120 tonnes of aid to Sendai Airport, Japan`
- dek: `… Simulated estimates so far: 240 dead, 1,900 injured, 610 missing.`

Impact values are **scenario-wide estimates as of that event**, so each story shows the latest snapshot as given and never adds snapshots together. Every figure is labeled as a simulated estimate. A figure used in the headline isn't repeated in the dek. Snapshots without `basis: "fictional_estimate"` are ignored, and malformed values (negative, non-numeric, NaN) are dropped rather than guessed. An omitted key means no estimate yet. On an `international_aid` event, `payload.origin` names the sender. The story reports that country's running totals and cargo from its `impacts.aid_contributors` entry and counts how many countries have sent help. Contributors are never added together.

Field names follow Mathys's DIR-003 (#26) shape agreed in [#13](https://github.com/hmzdev23/worldsim/issues/13). `tests/newsroom/fixtures/impact-chain.json` is a test-only multi-event chain until the canonical fixture lands.

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
