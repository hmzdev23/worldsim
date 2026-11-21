// Map effects for applied events (DIR-006, #61).
//
// A pure function from the run's applied events to what the map draws. Every
// effect comes from event fields in the v0.1 contract: type, visual, location,
// time, payload.radius_km, payload.origin and parent_ids. Nothing is invented:
//   - outbreak pulses sit only at locations of reported outbreak events and
//     accumulate as later outbreaks arrive (no spread geometry between them);
//   - disaster shockwaves sit at the disaster's own location;
//   - an aid route is drawn only when both ends are event locations: the aid
//     event's location, and an earlier event in the sender's country. That
//     start point is inferred, and the route is always labelled as inferred.
// The same aid rule is checked against the Director fixtures in
// tests/director/test_map_ready.py.

import type { ScenarioEvent } from "../lib/scenario";

export type EffectPoint = { lon: number; lat: number; place: string };

export type Outbreak = EffectPoint & { id: string; radiusKm: number; pathogen: string };
export type Shockwave = EffectPoint & { id: string; radiusKm: number; visual: string; label: string };
export type AidRoute = {
  id: string;
  from: EffectPoint & { eventId: string };
  to: EffectPoint;
  origin: string;
  inferred: true;
};
export type MapEffects = { outbreaks: Outbreak[]; shockwaves: Shockwave[]; routes: AidRoute[] };

// Disaster visuals that get a shockwave. Earthquakes keep the map's existing
// epicenter pulse, so they are left out here.
const shockwaveLabels: Record<string, string> = {
  earthquake_shockwave: "Aftershock",
  ash_plume: "Eruption",
  impact_blast: "Impact",
  missile_strike: "Strike",
  nuclear_blast: "Detonation",
  weather_disaster: "Severe weather",
};
const defaultRadiusKm = 40;

function canonical(a: ScenarioEvent, b: ScenarioEvent) {
  return a.sim_time_minutes - b.sim_time_minutes || a.sequence - b.sequence;
}

function point(event: ScenarioEvent): EffectPoint {
  return { lon: event.location.lon, lat: event.location.lat, place: event.location.name };
}

function radius(event: ScenarioEvent) {
  const value = event.payload?.radius_km;
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : defaultRadiusKm;
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

/** The latest event before `aid` located in the sender's country, or undefined. */
export function routeStart(events: ScenarioEvent[], aid: ScenarioEvent) {
  const origin = text(aid.payload?.origin).toLowerCase();
  if (!origin || origin === "unknown") return undefined;
  return events
    .filter((event) => canonical(event, aid) < 0 && event.location.country.trim().toLowerCase() === origin)
    .sort(canonical)
    .at(-1);
}

export function deriveMapEffects(applied: ScenarioEvent[]): MapEffects {
  const events = applied.filter((event) => event.status === "applied").sort(canonical);
  const effects: MapEffects = { outbreaks: [], shockwaves: [], routes: [] };
  for (const event of events) {
    if (event.visual === "contagion_spread") {
      effects.outbreaks.push({
        ...point(event), id: event.id, radiusKm: radius(event), pathogen: text(event.payload?.pathogen) || "Outbreak",
      });
    } else if (event.visual in shockwaveLabels && event.type !== "earthquake") {
      effects.shockwaves.push({
        ...point(event), id: event.id, radiusKm: radius(event), visual: event.visual, label: shockwaveLabels[event.visual],
      });
    } else if (event.type === "international_aid") {
      const start = routeStart(events, event);
      const sameSpot = start && start.location.lat === event.location.lat && start.location.lon === event.location.lon;
      if (start && !sameSpot) {
        effects.routes.push({
          id: event.id,
          from: { ...point(start), eventId: start.id },
          to: point(event),
          origin: text(event.payload.origin),
          inferred: true,
        });
      }
    }
  }
  return effects;
}

/** A point `t` (0..1) of the way along a straight lon/lat line. Not a real flight path. */
export function along(route: AidRoute, t: number): [number, number] {
  const clamped = Math.min(1, Math.max(0, t));
  return [
    route.from.lon + (route.to.lon - route.from.lon) * clamped,
    route.from.lat + (route.to.lat - route.from.lat) * clamped,
  ];
}

/** Text for the map's effects list; screen readers get the same words. */
export function describeEffects(effects: MapEffects) {
  return [
    ...effects.outbreaks.map((item) => ({ id: item.id, kind: "outbreak", text: `${item.pathogen} reported · ${item.place}` })),
    ...effects.shockwaves.map((item) => ({ id: item.id, kind: "shockwave", text: `${item.label} · ${item.place}` })),
    ...effects.routes.map((item) => ({
      id: item.id, kind: "route", text: `Inferred aid route · ${item.origin} (${item.from.place}) → ${item.to.place}`,
    })),
  ];
}
