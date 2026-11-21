# WORLD//WIRE newsroom

Turns **applied** simulation events into short, clearly fictional news items (NEWS-001, #5). Python 3.10+ standard library only, with no API key and no model calls.

```bash
cd services/newsroom
python3 -m worldwire fixtures/japan-earthquake.json                 # print the feed as JSON
python3 -m worldwire fixtures/japan-earthquake.json --html wire.html # self-contained preview page
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
  "sim_time_label": "DAY 1 · 06:42",
  "focus": { "event_id": "evt-0001", "lat": 38.3, "lon": 142.4, "zoom": 6.0 },
  "provenance": "template"
}
```

- Every item has `label: "SIMULATED"`, and the UI shows it next to the simulation time.
- Events with any status other than `"applied"` are skipped. Only events the simulation has confirmed become news.
- The feed is deterministic and sorted newest simulation time first.

## Click to focus

When a card is clicked, the page dispatches a window event with the item's `focus` object:

```js
window.dispatchEvent(new CustomEvent("worldsim:focus", { detail: item.focus }));
```

The map (WEB-001) can listen for `worldsim:focus`, then fly to `lat`/`lon`/`zoom` and highlight `event_id`. The preview page uses a stand-in SVG map that handles the same event. If the web app prefers a direct `flyTo(focus)` callback, the `focus` object stays the same.

## Provisional input

`fixtures/japan-earthquake.json` uses a **provisional** event shape (`schema_version: "0.1-provisional"`) until the shared contract in #1 is agreed. These are the fields the newsroom reads: `id`, `type`, `status`, `sim_time_minutes`, `location.{name,country,lat,lon}`, `payload.{magnitude,depth_km}`. If the contract renames any of them, only `worldwire/wire.py` and the fixture need to change.
