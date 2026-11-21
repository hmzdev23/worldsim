"use client";

import { useState } from "react";
import feed from "../../../services/newsroom/feeds/japan-earthquake.json";
import type { ScenarioEvent } from "../lib/earthquake";

type NewsItem = (typeof feed)[number];
export function focusNewsItem(item: NewsItem | { focus: NewsItem["focus"] }) {
  window.dispatchEvent(new CustomEvent("worldsim:focus", { detail: item.focus }));
}
function fallback(event: ScenarioEvent) {
  const place = event.location.name || event.location.country;
  return { id: `news-${event.id}`, event_id: event.id, label: "SIMULATED", headline: `${event.type.replaceAll("_", " ")} reported near ${place}`, dek: typeof event.payload.description === "string" ? event.payload.description : "A simulated event has been applied to the world state.", sim_time_label: `DAY ${Math.floor(event.sim_time_minutes / 1440) + 1} · ${String(Math.floor(event.sim_time_minutes % 1440 / 60)).padStart(2, "0")}:${String(event.sim_time_minutes % 60).padStart(2, "0")}`, focus: { event_id: event.id, lat: event.location.lat, lon: event.location.lon, zoom: 5.5 } };
}
export function WorldWire({ events }: { events: ScenarioEvent[] }) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const items = [...events].reverse().filter((event) => event.status === "applied").map((event) => (feed.find((item) => item.event_id === event.id) ?? fallback(event)));
  return <section className="world-wire" aria-labelledby="world-wire-title" aria-live="polite">
    <div className="world-wire-heading"><div><span className="section-label">Live global desk</span><h2 id="world-wire-title">WORLD//WIRE</h2></div><span className="world-wire-note">FICTIONAL SIMULATION · {items.length} REPORTS</span></div>
    {items.length === 0 ? <p className="world-wire-empty">No reports yet. Applied events will appear here in simulation time.</p> : <ul className="world-wire-list">{items.map((item) => <li key={item.id}><button type="button" className="wire-card" aria-pressed={activeId === item.id} onClick={() => { setActiveId(item.id); focusNewsItem(item); }}><span className="wire-meta"><span className="wire-label">{item.label}</span><span>{item.sim_time_label}</span></span><span className="wire-headline">{item.headline}</span><span className="wire-dek">{item.dek}</span></button></li>)}</ul>}
  </section>;
}
