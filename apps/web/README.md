# WORLD//SIM frontend

Run the WEB-001 demo with Node.js 20.9 or later.

```sh
cd apps/web
npm ci
npm run dev
```

Open [localhost:3000](http://localhost:3000). Pan and zoom the world map,
select **Fly to epicenter** to focus Japan, or choose **Play** to animate
the scenario. Use pause, reset, the timeline slider, or the speed controls
to replay a particular moment.

The demo uses the shared [Japan earthquake fixture](../../contracts/fixtures/japan-earthquake.json) and bundled [Natural Earth 1:110m country
boundaries](https://github.com/nvkelso/natural-earth-vector/blob/v5.1.2/geojson/ne_110m_admin_0_countries.geojson)
(public domain, v5.1.2), with a [1:50m outline of Japan](https://github.com/nvkelso/natural-earth-vector/blob/v5.1.2/geojson/ne_50m_admin_0_countries.geojson)
for the close-up. No API key or running backend is needed.

## Integration

The page controller uses the map component's `focusLocation` handle.
A newsroom card on the page can also dispatch the `worldsim:focus`
event using the newsroom's existing focus object.

```ts
window.dispatchEvent(new CustomEvent("worldsim:focus", {
  detail: { event_id: "evt-0001", lat: 38.3, lon: 142.4, zoom: 4.65 },
}));
```

The prototype uses MapLibre GL JS for both the basemap and shockwave.
