// Map motion: animated illustrations of what the run's applied events report.
//
// A pure function from applied events to the animations the map plays. Every
// animation is anchored to event fields (type, location, parent_ids, severity,
// payload.vei / radius_km), and is labelled as an illustration, not a forecast:
//   - journeys fly along the Director's own cause links (parent_ids) when the
//     cause happened far away: an infected traveller's plane for an outbreak, a
//     missile for a strike, a UFO for first contact, a pulse for a market shock;
//   - an eruption puts up a drifting ash cloud; a detonation a flash and fallout;
//   - tsunamis send waves across the ocean; outages black out their area;
//   - evacuations stream outward; storms spin; meteors streak in; quakes shake;
//   - ceasefires and recoveries ring once.
// Sizes come from the event when it reports them (radius_km, vei) and otherwise
// from severity, within fixed illustrative bounds.

import type { ScenarioEvent } from "../lib/scenario";

export type LonLat = [number, number];
export type Vehicle = "plane" | "missile" | "ufo" | "pulse";
export type Journey = {
  id: string; eventId: string; from: LonLat; to: LonLat; fromPlace: string; toPlace: string;
  vehicle: Vehicle; color: string; label: string; distanceKm: number;
};
export type Cloud = { id: string; at: LonLat; place: string; kind: "ash" | "fallout"; radiusKm: number; windDeg: number };
export type Area = { id: string; at: LonLat; place: string; radiusKm: number };
export type Motion = {
  journeys: Journey[]; clouds: Cloud[]; waves: Area[]; blackouts: Area[]; evacuations: Area[];
  storms: Area[]; meteors: Area[]; flashes: Area[]; quakes: Area[]; rings: (Area & { color: string })[]; ufos: Area[];
};

const EARTH_KM = 6371;
const MIN_JOURNEY_KM = 280;

// Child event type -> what travels along the cause link.
const VEHICLES: Record<string, { vehicle: Vehicle; color: string; label: string }> = {
  disease_outbreak: { vehicle: "plane", color: "#ff6b6b", label: "Infected traveller" },
  contamination: { vehicle: "plane", color: "#d9c36a", label: "Contaminated cargo" },
  evacuation: { vehicle: "plane", color: "#ffd166", label: "Evacuation flight" },
  alien_contact: { vehicle: "ufo", color: "#9fe8ff", label: "Object in transit" },
  military_strike: { vehicle: "missile", color: "#ff8f5c", label: "Strike" },
  nuclear_detonation: { vehicle: "missile", color: "#ffd38a", label: "Launch" },
  cyber_attack: { vehicle: "pulse", color: "#7fe7ff", label: "Cyberattack spreads" },
  economic_shock: { vehicle: "pulse", color: "#ffc76b", label: "Market shock" },
  infrastructure_failure: { vehicle: "pulse", color: "#ffe28a", label: "Cascading failure" },
  civil_unrest: { vehicle: "pulse", color: "#ff9fb0", label: "Unrest spreads" },
  government_response: { vehicle: "pulse", color: "#e6edf5", label: "Response" },
  recovery: { vehicle: "pulse", color: "#8fe3a8", label: "Recovery spreads" },
  extreme_weather: { vehicle: "pulse", color: "#bcd4ff", label: "Weather moves" },
  other_hazard: { vehicle: "pulse", color: "#e6edf5", label: "Spreads" },
};

function canonical(a: ScenarioEvent, b: ScenarioEvent) {
  return a.sim_time_minutes - b.sim_time_minutes || a.sequence - b.sequence;
}
const at = (e: ScenarioEvent): LonLat => [e.location.lon, e.location.lat];
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** Great-circle distance in km. */
export function distanceKm(a: LonLat, b: LonLat) {
  const [lo1, la1, lo2, la2] = [rad(a[0]), rad(a[1]), rad(b[0]), rad(b[1])];
  const h = Math.sin((la2 - la1) / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin((lo2 - lo1) / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** The point `t` (0..1) of the way along the great circle from a to b. */
export function greatCircle(a: LonLat, b: LonLat, t: number): LonLat {
  const [lo1, la1, lo2, la2] = [rad(a[0]), rad(a[1]), rad(b[0]), rad(b[1])];
  const d = distanceKm(a, b) / EARTH_KM;
  if (d < 1e-9) return a;
  const A = Math.sin((1 - t) * d) / Math.sin(d), B = Math.sin(t * d) / Math.sin(d);
  const x = A * Math.cos(la1) * Math.cos(lo1) + B * Math.cos(la2) * Math.cos(lo2);
  const y = A * Math.cos(la1) * Math.sin(lo1) + B * Math.cos(la2) * Math.sin(lo2);
  const z = A * Math.sin(la1) + B * Math.sin(la2);
  return [deg(Math.atan2(y, x)), deg(Math.atan2(z, Math.hypot(x, y)))];
}

/** Points along the great circle, with longitudes unwrapped so lines never jump across the map. */
export function arc(a: LonLat, b: LonLat, upTo = 1, steps = 64): LonLat[] {
  const out: LonLat[] = [];
  const n = Math.max(2, Math.ceil(steps * Math.min(1, Math.max(0, upTo))));
  for (let i = 0; i <= n; i++) {
    const p = greatCircle(a, b, (i / n) * Math.min(1, Math.max(0, upTo)));
    if (out.length) {
      const prev = out[out.length - 1][0];
      while (p[0] - prev > 180) p[0] -= 360;
      while (p[0] - prev < -180) p[0] += 360;
    }
    out.push(p);
  }
  return out;
}

/** A point `km` away from `p` on compass bearing `bearingDeg`. */
export function offset(p: LonLat, km: number, bearingDeg: number): LonLat {
  const d = km / EARTH_KM, b = rad(bearingDeg), la1 = rad(p[1]), lo1 = rad(p[0]);
  const la2 = Math.asin(Math.sin(la1) * Math.cos(d) + Math.cos(la1) * Math.sin(d) * Math.cos(b));
  const lo2 = lo1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(la1), Math.cos(d) - Math.sin(la1) * Math.sin(la2));
  return [deg(lo2), deg(la2)];
}

/** A stable 0..1 number for an id, so every illustration is the same on every replay. */
export function hash01(id: string) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10000) / 10000;
}

function sized(e: ScenarioEvent, min: number, max: number) {
  const reported = e.payload?.radius_km;
  if (typeof reported === "number" && Number.isFinite(reported) && reported > 0) return Math.min(max * 2, Math.max(min, reported));
  return min + (max - min) * Math.min(1, Math.max(0, e.severity ?? 0.5));
}

const text = (v: unknown) => (typeof v === "string" ? v : "");

export function deriveMotion(applied: ScenarioEvent[]): Motion {
  const events = applied.filter((e) => e.status === "applied" && e.location && Number.isFinite(e.location.lat) && Number.isFinite(e.location.lon)).sort(canonical);
  const byId = new Map(events.map((e) => [e.id, e]));
  const m: Motion = { journeys: [], clouds: [], waves: [], blackouts: [], evacuations: [], storms: [], meteors: [], flashes: [], quakes: [], rings: [], ufos: [] };
  for (const e of events) {
    const place = e.location.name;
    const area = (min: number, max: number): Area => ({ id: e.id, at: at(e), place, radiusKm: sized(e, min, max) });
    const words = `${text(e.payload?.label)} ${text(e.payload?.description)}`;

    // Journeys: from the farthest earlier cause, when it is far enough away to travel.
    const vehicle = VEHICLES[e.type];
    if (vehicle) {
      const causes = (e.parent_ids ?? []).map((id) => byId.get(id)).filter((p): p is ScenarioEvent => !!p && canonical(p, e) < 0);
      const far = causes.map((p) => ({ p, d: distanceKm(at(p), at(e)) })).filter((c) => c.d >= MIN_JOURNEY_KM).sort((x, y) => y.d - x.d)[0];
      if (far) m.journeys.push({ id: `journey-${e.id}`, eventId: e.id, from: at(far.p), to: at(e), fromPlace: far.p.location.name,
        toPlace: place, distanceKm: far.d, ...vehicle });
    }

    switch (e.type) {
      case "volcanic_eruption": {
        const vei = Number(e.payload?.vei);
        const radiusKm = Number.isFinite(vei) && vei > 0 ? Math.min(2600, 180 * 1.6 ** vei) : sized(e, 500, 1400);
        m.clouds.push({ id: e.id, at: at(e), place, kind: "ash", radiusKm, windDeg: 50 + hash01(e.id) * 70 });
        break;
      }
      case "nuclear_detonation":
        m.flashes.push(area(120, 260));
        m.clouds.push({ id: `fallout-${e.id}`, at: at(e), place, kind: "fallout", radiusKm: sized(e, 300, 700), windDeg: 60 + hash01(e.id) * 60 });
        break;
      case "meteor_impact": m.meteors.push(area(80, 200)); break;
      case "alien_contact": m.ufos.push(area(60, 120)); break;
      case "tsunami_warning": m.waves.push(area(1500, 3600)); break;
      case "infrastructure_failure":
      case "cyber_attack": m.blackouts.push(area(90, 260)); break;
      case "evacuation": m.evacuations.push(area(60, 160)); break;
      case "earthquake":
      case "aftershock": m.quakes.push(area(100, 300)); break;
      case "extreme_weather": m.storms.push(area(250, 600)); break;
      case "ceasefire": m.rings.push({ ...area(300, 600), color: "#ffffff" }); break;
      case "recovery": m.rings.push({ ...area(200, 500), color: "#8fe3a8" }); break;
      default: break;
    }
    if (e.type !== "extreme_weather" && /\b(hurricane|typhoon|cyclone)\b/i.test(words)) m.storms.push(area(250, 600));
  }
  return m;
}

/** Legend lines for the animations that need one (the rest are labelled by their event already). */
export function describeMotion(m: Motion) {
  return [
    ...m.journeys.filter((j) => j.vehicle !== "pulse").map((j) => ({ id: j.id, kind: "journey", text: `${j.label} · ${j.fromPlace} → ${j.toPlace}` })),
    ...m.clouds.map((c) => ({ id: c.id, kind: c.kind, text: `${c.kind === "ash" ? "Ash cloud" : "Fallout plume"} · ${c.place}` })),
  ];
}
