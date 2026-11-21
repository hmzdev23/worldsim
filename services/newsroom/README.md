# WORLD//WIRE newsroom

Turns **applied** simulation events into short, clearly fictional news items (NEWS-001, #5). Python 3.10+ standard library only, with no API key and no model calls.

```bash
cd services/newsroom
python3 -m worldwire ../../contracts/fixtures/japan-earthquake.json                 # print the feed as JSON
python3 -m worldwire ../../contracts/fixtures/japan-earthquake.json --html wire.html # self-contained preview page
python3 -m unittest discover -s ../../tests/newsroom                 # tests
```

## News item shape

```json
{
  "id": "news-evt-0001",
  "event_id": "evt-0001",
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
- `news_from_stream(messages)` folds stream messages into the current feed: a `snapshot` replaces it, an `event` adds one item, and a `clock` adds nothing.

Each event type in the contract has its own headline template, and `international_aid` uses `payload.origin` when present. A test fails if the contract adds a type without a template.

## Click to focus

When a card is clicked, the page dispatches a window event with the item's `focus` object:

```js
window.dispatchEvent(new CustomEvent("worldsim:focus", { detail: item.focus }));
```

The map (WEB-001) can listen for `worldsim:focus`, then fly to `lat`/`lon`/`zoom` and highlight `event_id`. The preview page uses a stand-in SVG map that handles the same event. If the web app prefers a direct `flyTo(focus)` callback, the `focus` object stays the same.

## Input

Events follow [contracts/events.schema.json](../../contracts/events.schema.json) v0.1. The newsroom reads `id`, `type`, `status`, `sim_time_minutes`, `sequence`, `location.{name,country,lat,lon}`, and `payload.{magnitude,depth_km}`.
