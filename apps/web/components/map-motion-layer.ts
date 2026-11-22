// Draws map motion (map-motion.ts) on a MapLibre map: one requestAnimationFrame loop,
// three GeoJSON sources (areas, rings, trails) and DOM markers for vehicles and storms.
//
// Animations play in real time from the moment an event appears, so they keep moving
// while the story pauses on a headline. Events that arrive in a batch (a seek, a new
// run) and anything under reduced motion are drawn in their final state instead.
// While `follow` is on, the camera rides along with the newest journey, then settles
// on its destination; any manual pan or zoom stops following.

import type { Feature } from "geojson";
import type { GeoJSONSource, Map as MapLibreMap, Marker as MarkerType } from "maplibre-gl";
import { Marker } from "maplibre-gl";
import { arc, distanceKm, greatCircle, hash01, offset, type Cloud, type Journey, type LonLat, type Motion } from "./map-motion";

const PER_PIXEL = 40075 / 512;
const SETTLED = Number.NEGATIVE_INFINITY;
const ease = (x: number) => 1 - (1 - Math.min(1, Math.max(0, x))) ** 3;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const LEAD = 0.45;  // seconds for the camera to reach a journey's start before take-off

/** Circle radius in pixels for a km radius (already divided by cos(latitude)), never below minPx. */
const kmCircle = ["interpolate", ["exponential", 2], ["zoom"],
  0, ["max", ["get", "minPx"], ["*", ["get", "rkm"], 1 / PER_PIXEL]],
  8, ["max", ["get", "minPx"], ["*", ["get", "rkm"], 256 / PER_PIXEL]]] as const;

function circle(p: LonLat, radiusKm: number, props: Record<string, unknown>): Feature {
  const rkm = radiusKm / Math.max(0.2, Math.cos((p[1] * Math.PI) / 180));
  return { type: "Feature", properties: { rkm, minPx: 0, ...props }, geometry: { type: "Point", coordinates: p } };
}

function flightSeconds(j: Journey) { return Math.min(3.6, Math.max(2, 1.6 + j.distanceKm / 6000)); }

const SVG: Record<string, string> = {
  plane: '<svg viewBox="-12 -12 24 24"><path d="M0-11 2-4 10 1V3L2 1 1.4 7 4 9V10.5L0 9.5-4 10.5V9L-1.4 7-2 1-10 3V1L-2-4Z" fill="currentColor" stroke="#10131b" stroke-width="1"/></svg>',
  missile: '<svg viewBox="-12 -12 24 24"><path d="M0-11 2.2-6V6L4 9H-4L-2.2 6V-6Z" fill="currentColor" stroke="#10131b" stroke-width="1"/><path d="M-1.6 9.5 0 12 1.6 9.5Z" fill="#ffb347"/></svg>',
  ufo: '<svg viewBox="-14 -10 28 20"><ellipse cx="0" cy="2" rx="13" ry="4.5" fill="#566070" stroke="#10131b"/><path d="M-6 1A6 6 0 0 1 6 1Z" fill="currentColor"/><circle cx="-7" cy="3" r="1.2" fill="#fff"/><circle cx="0" cy="4" r="1.2" fill="#fff"/><circle cx="7" cy="3" r="1.2" fill="#fff"/></svg>',
  meteor: '<svg viewBox="-12 -12 24 24"><circle r="5" fill="#ffb36a" stroke="#fff2c4" stroke-width="1.5"/></svg>',
  storm: '<svg viewBox="-50 -50 100 100"><g fill="none" stroke="#e6eefc" stroke-linecap="round" stroke-opacity=".8"><path d="M0 0C14-4 22 6 18 20S-6 40-24 30" stroke-width="7"/><path d="M0 0C-14 4-22-6-18-20S6-40 24-30" stroke-width="7"/><path d="M0 0C4 14-6 22-20 18S-40-6-30-24" stroke-width="5"/><path d="M0 0C-4-14 6-22 20-18S40 6 30 24" stroke-width="5"/></g><circle r="6" fill="#10131b"/></svg>',
};

type Vehicle = { marker: MarkerType; glyph: HTMLElement; label: HTMLElement };

export class MotionLayer {
  private map: MapLibreMap;
  private born = new Map<string, number>();
  private vehicles = new Map<string, Vehicle>();
  private storms = new Map<string, MarkerType>();
  private meteors = new Map<string, Vehicle>();
  private motion: Motion = { journeys: [], clouds: [], waves: [], blackouts: [], evacuations: [], storms: [], meteors: [], flashes: [], quakes: [], rings: [], ufos: [] };
  private ufos = new Map<string, MarkerType>();
  private frame = 0;
  private following?: { id: string; stage: "lead" | "flight" | "land" };
  private flashEl: HTMLElement;
  follow = false;
  reduced = false;

  constructor(map: MapLibreMap, overlay: HTMLElement) {
    this.map = map;
    this.flashEl = overlay;
    const empty = { type: "FeatureCollection" as const, features: [] };
    map.addSource("motion-areas", { type: "geojson", data: empty });
    map.addSource("motion-rings", { type: "geojson", data: empty });
    map.addSource("motion-trails", { type: "geojson", data: empty });
    map.addSource("motion-dots", { type: "geojson", data: empty });
    map.addLayer({ id: "motion-area", type: "circle", source: "motion-areas", paint: {
      "circle-radius": kmCircle as never, "circle-color": ["get", "color"], "circle-opacity": ["get", "opacity"], "circle-blur": ["get", "blur"],
    } });
    map.addLayer({ id: "motion-ring", type: "circle", source: "motion-rings", paint: {
      "circle-radius": kmCircle as never, "circle-opacity": 0, "circle-stroke-color": ["get", "color"],
      "circle-stroke-opacity": ["get", "opacity"], "circle-stroke-width": ["get", "width"],
    } });
    map.addLayer({ id: "motion-trail", type: "line", source: "motion-trails", layout: { "line-cap": "round", "line-join": "round" }, paint: {
      "line-color": ["get", "color"], "line-opacity": ["get", "opacity"], "line-width": ["get", "width"], "line-blur": 0.4,
    } });
    map.addLayer({ id: "motion-dot", type: "circle", source: "motion-dots", paint: {
      "circle-radius": ["get", "px"], "circle-color": ["get", "color"], "circle-opacity": ["get", "opacity"],
      "circle-stroke-color": "#10131b", "circle-stroke-width": 0.6, "circle-stroke-opacity": ["get", "opacity"],
    } });
    map.on("movestart", this.onManual);
    map.on("zoomstart", this.onManual);
  }

  private onManual = (e: { originalEvent?: unknown }) => { if (e.originalEvent) this.following = undefined; };

  /** The zoom that keeps a cloud in view when focusing on `p` inside it, else undefined. */
  contextZoom(p: LonLat): number | undefined {
    const zooms = this.motion.clouds.filter((c) => distanceKm(c.at, p) < c.radiusKm * 1.5)
      .map((c) => Math.max(1.6, 4.9 - Math.log2(c.radiusKm / 250)));
    return zooms.length ? Math.min(...zooms) : undefined;
  }

  /** Whether the camera is riding along with a journey (focus requests should wait). */
  isFollowing() { return this.following !== undefined; }

  /** New applied events: `settle` draws new items in their final state (a seek or a new run). */
  update(motion: Motion, settle: boolean) {
    const now = performance.now() / 1000;
    const ids = new Set<string>();
    const all: { id: string }[] = [...motion.journeys, ...motion.clouds, ...motion.waves, ...motion.blackouts, ...motion.evacuations,
      ...motion.storms, ...motion.meteors, ...motion.flashes, ...motion.quakes, ...motion.rings.map((r) => ({ id: `ring-${r.id}` })),
      ...motion.ufos.map((u) => ({ id: `ufo-${u.id}` }))];
    let newest: Journey | undefined;
    let newCloud: Cloud | undefined;
    for (const item of all) {
      ids.add(item.id);
      if (this.born.has(item.id)) continue;
      const fresh = !settle && !this.reduced;
      this.born.set(item.id, fresh ? now : SETTLED);
      if (fresh && "vehicle" in item) newest = item as Journey;
      if (fresh && "windDeg" in item) newCloud = item as Cloud;
      if (fresh && motion.quakes.some((q) => q.id === item.id)) this.shake();
    }
    for (const id of [...this.born.keys()]) if (!ids.has(id)) this.born.delete(id);
    this.motion = motion;
    this.syncMarkers();
    if (newCloud && this.follow && !newest) {
      // Pull back so the whole cloud is in view, centred a little downwind of the source.
      this.following = { id: newCloud.id, stage: "land" };
      this.map.stop();
      this.map.easeTo({ center: offset(newCloud.at, newCloud.radiusKm * 0.7, newCloud.windDeg),
        zoom: Math.max(1.6, 4.9 - Math.log2(newCloud.radiusKm / 250)), duration: 2200 });
      setTimeout(() => { if (this.following?.id === newCloud!.id) this.following = undefined; }, 2400);
    }
    if (newest && this.follow) {
      this.following = { id: newest.id, stage: "lead" };
      const zoom = Math.min(4.4, Math.max(1.4, 5.4 - Math.log2(Math.max(400, newest.distanceKm) / 400)));
      this.map.stop();
      this.map.easeTo({ center: newest.from, zoom, duration: LEAD * 900 });
    }
    this.start();
  }

  private shake() {
    const el = this.map.getContainer();
    el.classList.remove("map-shake"); void el.offsetWidth; el.classList.add("map-shake");
  }

  private syncMarkers() {
    const keep = (map: Map<string, { marker: MarkerType } | MarkerType>, ids: Set<string>) => {
      for (const [id, v] of map) if (!ids.has(id)) { ("marker" in v ? v.marker : v).remove(); map.delete(id); }
    };
    keep(this.vehicles as never, new Set(this.motion.journeys.map((j) => j.id)));
    keep(this.storms as never, new Set(this.motion.storms.map((s) => s.id)));
    keep(this.meteors as never, new Set(this.motion.meteors.map((s) => s.id)));
    keep(this.ufos as never, new Set(this.motion.ufos.map((s) => s.id)));
    for (const u of this.motion.ufos) {
      if (this.ufos.has(u.id)) continue;
      const el = document.createElement("div");
      el.className = "motion-ufo"; el.dataset.effect = "ufo"; el.setAttribute("aria-hidden", "true");
      el.innerHTML = `<div class="motion-beam"></div><div class="motion-saucer">${SVG.ufo}</div>`;
      this.ufos.set(u.id, new Marker({ element: el, anchor: "bottom" }).setLngLat(u.at).addTo(this.map));
    }
    for (const j of this.motion.journeys) if (!this.vehicles.has(j.id)) this.vehicles.set(j.id, this.vehicle(j.vehicle, j.color, j.label, j.id));
    for (const s of this.motion.meteors) if (!this.meteors.has(s.id)) this.meteors.set(s.id, this.vehicle("meteor", "#ffb36a", "", s.id));
    for (const s of this.motion.storms) {
      if (this.storms.has(s.id)) continue;
      const el = document.createElement("div");
      el.className = "motion-storm"; el.dataset.effect = "storm"; el.setAttribute("aria-hidden", "true"); el.innerHTML = SVG.storm;
      this.storms.set(s.id, new Marker({ element: el }).setLngLat(s.at).addTo(this.map));
    }
  }

  private vehicle(kind: string, color: string, label: string, id: string): Vehicle {
    const el = document.createElement("div");
    el.className = "motion-vehicle"; el.dataset.effect = kind; el.dataset.journey = id; el.setAttribute("aria-hidden", "true");
    const glyph = document.createElement("div");
    glyph.className = "motion-glyph"; glyph.style.color = color; glyph.innerHTML = kind === "pulse" ? "" : SVG[kind];
    if (kind === "pulse") { glyph.classList.add("motion-pulse"); glyph.style.background = color; glyph.style.boxShadow = `0 0 14px 4px ${color}`; }
    const text = document.createElement("span");
    text.className = "motion-label"; text.textContent = label;
    el.append(glyph, text);
    el.style.visibility = "hidden";
    return { marker: new Marker({ element: el }).setLngLat([0, 0]).addTo(this.map), glyph, label: text };
  }

  private start() {
    if (this.frame) return;
    const loop = () => { this.frame = 0; if (this.draw()) this.frame = requestAnimationFrame(loop); };
    this.frame = requestAnimationFrame(loop);
  }

  private age(id: string, now: number) { const b = this.born.get(id); return b === undefined || b === SETTLED ? Infinity : now - b; }

  private headingDeg(p: LonLat, ahead: LonLat) {
    const a = this.map.project(p), b = this.map.project(ahead);
    return (Math.atan2(b.x - a.x, -(b.y - a.y)) * 180) / Math.PI;  // glyphs point up; rotate to face travel
  }

  /** Draw one frame. Returns whether another frame is needed. */
  private draw(): boolean {
    const now = performance.now() / 1000;
    const m = this.motion;
    const areas: Feature[] = [], rings: Feature[] = [], trails: Feature[] = [], dots: Feature[] = [];
    let busy = false;
    let flash = 0;

    for (const j of m.journeys) {
      const age = this.age(j.id, now), fly = flightSeconds(j), t = Number.isFinite(age) ? clamp01((age - LEAD) / fly) : 1;
      const v = this.vehicles.get(j.id)!;
      const flying = t > 0 && t < 1;
      trails.push({ type: "Feature", properties: { color: j.color, opacity: flying ? 0.9 : 0.4, width: flying ? 2.6 : 1.6 },
        geometry: { type: "LineString", coordinates: arc(j.from, j.to, Math.max(0.001, ease(t)) * (t > 0 ? 1 : 0.001)) } });
      if (flying) {
        busy = true;
        const k = ease(t), p = greatCircle(j.from, j.to, k), ahead = greatCircle(j.from, j.to, Math.min(1, k + 0.01));
        v.marker.setLngLat(p);
        v.marker.getElement().style.visibility = "visible";
        if (j.vehicle !== "ufo" && j.vehicle !== "pulse") v.glyph.style.rotate = `${this.headingDeg(p, ahead)}deg`;
        if (this.following?.id === j.id) {
          this.following.stage = "flight";
          this.map.jumpTo({ center: p });
        }
      } else {
        v.marker.getElement().style.visibility = "hidden";
        if (age < LEAD) busy = true;
        if (t >= 1 && this.following?.id === j.id) {
          this.following = undefined;
          this.map.easeTo({ center: j.to, zoom: 4.65, duration: 900 });
        }
      }
    }

    for (const c of m.clouds) drawCloud(c, this.age(c.id, now), now, areas);
    if (m.clouds.length) busy = true;  // clouds keep drifting

    for (const f of m.flashes) {
      const age = this.age(f.id, now);
      if (Number.isFinite(age) && age < 1) { flash = Math.max(flash, 1 - age); busy = true; }
      const g = Number.isFinite(age) ? ease(age / 1.6) : 1;
      areas.push(circle(f.at, f.radiusKm * g, { color: g < 1 ? "#fff2c4" : "#ff9a4a", opacity: g < 1 ? 0.75 : 0.22, blur: 0.5, minPx: 6 }));
      if (g < 1) rings.push(circle(f.at, f.radiusKm * 2.2 * g, { color: "#fff2c4", opacity: 1 - g, width: 3 }));
      if (g < 1) busy = true;
    }

    for (const s of m.meteors) {
      const age = this.age(s.id, now), v = this.meteors.get(s.id)!;
      const fall = Number.isFinite(age) ? clamp01(age / 1.3) : 1;
      if (fall < 1) {
        busy = true;
        const start = offset(s.at, 1800, 300), p = greatCircle(start, s.at, fall * fall);
        v.marker.setLngLat(p); v.marker.getElement().style.visibility = "visible";
        trails.push({ type: "Feature", properties: { color: "#ffd8a0", opacity: 0.85, width: 3 }, geometry: { type: "LineString", coordinates: arc(start, p, 1, 16) } });
      } else v.marker.getElement().style.visibility = "hidden";
      const boom = Number.isFinite(age) ? clamp01((age - 1.3) / 1.6) : 1;
      if (Number.isFinite(age) && age > 1.3 && age < 1.8) flash = Math.max(flash, 0.7 * (1 - (age - 1.3) / 0.5));
      if (boom > 0 && boom < 1) { busy = true; rings.push(circle(s.at, s.radiusKm * 3 * ease(boom), { color: "#ffd8a0", opacity: 1 - boom, width: 3 })); }
      areas.push(circle(s.at, s.radiusKm * ease(boom), { color: "#5a3b2a", opacity: 0.45, blur: 0.4, minPx: 4 }));
    }

    for (const w of m.waves) {
      const age = this.age(w.id, now);
      for (let k = 0; k < 4; k++) {
        const phase = this.reduced ? (k + 1) / 4 : ((now * 0.09 + k / 4 + hash01(w.id)) % 1);
        const grow = Number.isFinite(age) ? ease(age / 6) : 1;
        rings.push(circle(w.at, 60 + w.radiusKm * phase * grow, { color: "#8dd8f4", opacity: 0.75 * (1 - phase), width: 2.2 - phase }));
      }
      busy = true;
    }

    for (const b of m.blackouts) {
      const age = this.age(b.id, now);
      const flicker = Number.isFinite(age) && age < 1.6 ? (Math.sin(age * 40) > 0 ? 0.6 : 0.1) : 0.55;
      if (Number.isFinite(age) && age < 1.6) busy = true;
      areas.push(circle(b.at, b.radiusKm, { color: "#070a12", opacity: flicker * 0.7, blur: 0.85, minPx: 14 }));
    }

    for (const e of m.evacuations) {
      for (let k = 0; k < 16; k++) {
        const h = hash01(`${e.id}-${k}`), bearing = (k / 16) * 360 + h * 20;
        const phase = this.reduced ? 0.5 : (now * 0.22 + h) % 1;
        dots.push({ type: "Feature", properties: { px: 2.6, color: "#ffd166", opacity: 0.95 * (1 - phase) },
          geometry: { type: "Point", coordinates: offset(e.at, 12 + e.radiusKm * phase, bearing) } });
      }
      busy = true;
    }

    for (const s of m.storms) {
      const marker = this.storms.get(s.id)!, el = marker.getElement();
      const a = this.map.project(s.at), b = this.map.project(offset(s.at, s.radiusKm, 90));
      const px = Math.max(26, Math.hypot(b.x - a.x, b.y - a.y) * 2);
      el.style.width = el.style.height = `${px}px`;
      (el.firstElementChild as HTMLElement).style.rotate = this.reduced ? "0deg" : `${-(now * 70) % 360}deg`;
      busy = true;
    }

    for (const u of m.ufos) {
      const age = this.age(`ufo-${u.id}`, now), el = this.ufos.get(u.id)!.getElement();
      const arrive = Number.isFinite(age) ? ease(age / 2.2) : 1;
      el.style.setProperty("--ufo-y", `${(1 - arrive) * -120 + (this.reduced ? 0 : Math.sin(now * 1.6) * 3)}px`);
      el.style.setProperty("--ufo-beam", String(arrive >= 1 ? 0.55 + 0.25 * Math.sin(now * 3) : 0));
      el.style.opacity = String(Math.min(1, arrive * 3));
      busy = true;
    }

    for (const r of m.rings) {
      const age = this.age(`ring-${r.id}`, now);
      if (!Number.isFinite(age) || age > 2.4) continue;
      busy = true;
      const g = ease(age / 2.4);
      rings.push(circle(r.at, r.radiusKm * g, { color: r.color, opacity: 1 - g, width: 3 }));
    }

    const set = (id: string, features: Feature[]) => this.map.getSource<GeoJSONSource>(id)?.setData({ type: "FeatureCollection", features });
    set("motion-areas", areas); set("motion-rings", rings); set("motion-trails", trails); set("motion-dots", dots);
    this.flashEl.style.opacity = String(flash);
    return busy && !this.reduced;
  }

  /** Draw once (after a seek, a zoom or a reduced-motion change). */
  redraw() { if (!this.frame) this.draw(); }

  dispose() {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.map.off("movestart", this.onManual); this.map.off("zoomstart", this.onManual);
    for (const v of [...this.vehicles.values(), ...this.meteors.values()]) v.marker.remove();
    for (const s of [...this.storms.values(), ...this.ufos.values()]) s.remove();
  }
}

/**
 * A volcanic ash cloud or a fallout plume: overlapping soft puffs that grow out of the
 * source and drift downwind (wind direction fixed per event, so replays look the same).
 */
function drawCloud(c: Cloud, age: number, now: number, out: Feature[]) {
  const grow = Number.isFinite(age) ? ease(age / 5) : 1;
  const ash = c.kind === "ash";
  // A faint haze under the plume, then distinct billows along the wind with darker cores.
  out.push(circle(offset(c.at, c.radiusKm * 0.8 * grow, c.windDeg), c.radiusKm * 1.15 * grow,
    { color: ash ? "#9a948e" : "#b5a97e", opacity: 0.22 * grow, blur: 1, minPx: 8 }));
  const puffs = ash ? 34 : 20;
  for (let k = 0; k < puffs; k++) {
    const h = hash01(`${c.id}-${k}`), h2 = hash01(`${c.id}-${k}-b`), u = k / (puffs - 1);
    const along = c.radiusKm * 1.8 * u * grow;
    const side = (h - 0.5) * c.radiusKm * 0.9 * (0.25 + u) * grow;
    const drift = Math.sin(now * 0.2 + h * 6) * c.radiusKm * 0.05;
    const centre = offset(offset(c.at, along + drift, c.windDeg), side, c.windDeg + 90);
    const r = c.radiusKm * (0.12 + 0.3 * Math.sin(Math.PI * Math.min(1, u * 1.1 + 0.08))) * (0.5 + 0.5 * grow) * (0.7 + h2 * 0.6);
    const tone = ash ? ["#5f5a56", "#7d7772", "#a39d97", "#8a847f"][k % 4] : ["#8f8566", "#b9ab7c", "#a0956d"][k % 3];
    out.push(circle(centre, r, { color: tone, opacity: (ash ? 0.5 : 0.38) * (0.55 + 0.45 * grow) * (0.75 + h * 0.5), blur: 0.45, minPx: 5 }));
  }
}
