# WORLD//SIM frontend

Open the console, enter a fictional scenario, choose **Generate scenario**,
then press **Play** once the run is ready. The playhead, map, impacts, and
WORLD//WIRE follow the selected run. **Japan demo** opens the deterministic
sample again.

Prompted scenarios need the local scenario service from [#53](https://github.com/hmzdev23/worldsim/pull/53).
The browser uses its local run, playback, and news routes. Hamza's local
Codex CLI runner owns model execution and configuration. Fixture mode is
enough to exercise the browser flow without model credentials.

The web server forwards HTTP and WebSocket requests under `/api/simulation`
to `http://127.0.0.1:8765`. Set `SIMULATION_HTTP_URL` before starting Next
if the local service uses another address.

Run the full deterministic Japan demo with Node.js 20.9 or later and Python 3.10+.

```sh
python3 -m venv .venv
.venv/bin/pip install -r services/simulation/requirements.txt
cd apps/web
npm ci
cd ../..
./scripts/run-demo.sh
```

Open [localhost:3000](http://localhost:3000). The page connects to the local
simulation stream through the web server. Choose **Play** to advance
the simulation clock; when the fixture event is applied, the map animation
and WORLD//WIRE story appear. Pause, reset, drag the timeline, or change speed
to replay it. Click the story to focus the map on the epicenter.

The sample reads the shared [Japan earthquake fixture](../../contracts/fixtures/japan-earthquake.json).
The map uses Esri World Imagery satellite
tiles and Natural Earth country boundaries. Country names appear on hover, and
the hovered country's border brightens. Map data credits are shown in the map.

To run only the frontend, use `npm run dev`; playback controls stay disabled
until the local simulation server is running. Stop `run-demo.sh` with Ctrl+C.

## Integration

The page controller uses the map component's `focusLocation` handle.
Newsroom cards and map alerts both dispatch the `worldsim:focus` event with
the newsroom item's focus object.

```ts
window.dispatchEvent(new CustomEvent("worldsim:focus", {
  detail: { event_id: "evt-0001", lat: 38.3, lon: 142.4, zoom: 4.65 },
}));
```

The map uses MapLibre GL JS for the basemap and shockwave. The external imagery
tiles require an internet connection.
