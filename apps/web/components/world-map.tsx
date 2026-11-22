"use client";

import { CornersOut, Minus, Plus } from "@phosphor-icons/react";
import type { FeatureCollection, LineString } from "geojson";
import {
  Map as MapLibreMap, Marker, setWorkerUrl,
  type ExpressionSpecification, type GeoJSONSource, type StyleSpecification,
} from "maplibre-gl";
import { useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode, type Ref } from "react";
import type { MapLocation, ScenarioEvent } from "../lib/scenario";
import { along, deriveMapEffects, describeEffects, type AidRoute, type MapEffects } from "./map-effects";
import effectStyles from "./map-effects.module.css";

export type WorldMapHandle = {
  focusLocation: (location: MapLocation, instant?: boolean) => void;
  stopMotion: () => void;
};

const accent = "#ffa96b";
const worldBounds: [[number, number], [number, number]] = [
  [-175, -57],
  [179, 76],
];
const pulseLayers = ["pulse-first", "pulse-second", "pulse-third"];
const outbreakColor = "#78b9b5";
const shockwaveColor = "#ff8f5c";
const routeColor = "#83c9ae";
const emptyCollection = { type: "FeatureCollection" as const, features: [] };

// Circle radius in pixels for a radius in km, at any zoom (512px world at zoom 0,
// about 78 km per pixel at the equator), times `scale`, never below `min` pixels.
function kmRadius(scale: number, min = 5): ExpressionSpecification {
  const perPixel = 40075 / 512;
  return [
    "interpolate", ["exponential", 2], ["zoom"],
    0, ["max", min * 0.1, ["*", ["get", "radiusKm"], scale / perPixel]],
    4, ["max", min * 0.24, ["*", ["get", "radiusKm"], (scale * 16) / perPixel]],
    8, ["max", min * 0.8, ["*", ["get", "radiusKm"], (scale * 256) / perPixel]],
  ];
}

// Illustrative markers grow with the map, but remain bounded and do not claim
// to represent a measured disaster footprint.
function effectScale(zoom: number) {
  const stops = [[0, 0.08], [2, 0.12], [4.65, 0.28], [7, 0.65]] as const;
  if (zoom <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    const [z, value] = stops[i];
    const [prevZ, prev] = stops[i - 1];
    if (zoom <= z) return prev + (value - prev) * ((zoom - prevZ) / (z - prevZ));
  }
  return stops[stops.length - 1][1];
}

function zoomScaledRadius(radius: number): ExpressionSpecification {
  return ["interpolate", ["linear"], ["zoom"], 0, radius * 0.08, 2, radius * 0.12,
    4.65, radius * 0.28, 7, radius * 0.65];
}

function effectData(effects: MapEffects) {
  const points = <T extends { id: string; lon: number; lat: number; radiusKm: number; zombie?: boolean; flooding?: boolean }>(items: T[]) => ({
    type: "FeatureCollection" as const,
    features: items.map((item) => ({
      type: "Feature" as const,
      properties: { id: item.id, radiusKm: item.radiusKm, zombie: item.zombie ?? false, flooding: item.flooding ?? false },
      geometry: { type: "Point" as const, coordinates: [item.lon, item.lat] },
    })),
  });
  return {
    outbreaks: points(effects.outbreaks),
    shockwaves: points(effects.shockwaves),
    water: points(effects.water),
    routes: {
      type: "FeatureCollection" as const,
      features: effects.routes.map((route) => ({
        type: "Feature" as const,
        properties: { id: route.id },
        geometry: { type: "LineString" as const, coordinates: [[route.from.lon, route.from.lat], [route.to.lon, route.to.lat]] },
      })),
    },
  };
}

const grid: FeatureCollection<LineString> = {
  type: "FeatureCollection",
  features: [
    ...Array.from({ length: 24 }, (_, index) => {
      const longitude = index * 15 - 180;
      return {
        type: "Feature" as const,
        properties: {},
        geometry: { type: "LineString" as const, coordinates: [[longitude, -75], [longitude, 80]] },
      };
    }),
    ...Array.from({ length: 11 }, (_, index) => ({
      type: "Feature" as const,
      properties: {},
      geometry: {
        type: "LineString" as const,
        coordinates: Array.from({ length: 25 }, (_, meridian) => [meridian * 15 - 180, index * 15 - 75]),
      },
    })),
  ],
};

const mapStyle: StyleSpecification = {
  version: 8,
  sources: {
    imagery: {
      type: "raster",
      tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
      tileSize: 256,
      maxzoom: 19,
      attribution: "Sources: Esri, Maxar, Earthstar Geographics, and the GIS User Community",
    },
    grid: { type: "geojson", data: grid },
    countries: { type: "geojson", data: "/countries.geojson" },
    epicenter: {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    },
    "effect-outbreaks": { type: "geojson", data: emptyCollection },
    "effect-shockwaves": { type: "geojson", data: emptyCollection },
    "effect-water": { type: "geojson", data: emptyCollection },
    "effect-routes": { type: "geojson", data: emptyCollection },
  },
  layers: [
    { id: "ocean", type: "background", paint: { "background-color": "#111719" } },
    { id: "imagery", type: "raster", source: "imagery", paint: { "raster-saturation": -0.2, "raster-brightness-max": 0.84 } },
    {
      id: "grid",
      type: "line",
      source: "grid",
      paint: { "line-color": "#83918d", "line-opacity": 0.13, "line-width": 1 },
    },
    {
      id: "land",
      type: "fill",
      source: "countries",
      paint: {
        "fill-color": [
          "case",
          ["boolean", ["feature-state", "hover"], false],
          "#ffbd91",
          "#eff3ed",
        ],
        "fill-opacity": [
          "case",
          ["boolean", ["feature-state", "hover"], false], 0.28,
          0.055,
        ],
      },
    },
    {
      id: "borders",
      type: "line",
      source: "countries",
      paint: {
        "line-color": ["case", ["boolean", ["feature-state", "hover"], false], "#ffd5b8", "#e4ece5"],
        "line-width": ["case", ["boolean", ["feature-state", "hover"], false], 2.2, 0.65],
        "line-opacity": ["case", ["boolean", ["feature-state", "hover"], false], 1, 0.55],
      },
    },
    {
      id: "scenario-outline",
      type: "line",
      source: "countries",
      filter: ["==", ["get", "code"], ""],
      paint: { "line-color": "#ffc18f", "line-width": 1.3, "line-opacity": 0.95 },
    },
    ...pulseLayers.map((id, index) => ({
      id,
      type: "circle" as const,
      source: "epicenter",
      paint: {
        "circle-color": accent,
        "circle-opacity": 0,
        "circle-radius": 20 + index * 20,
        "circle-stroke-color": accent,
        "circle-stroke-width": 1,
        "circle-stroke-opacity": 0.62 - index * 0.16,
        "circle-radius-transition": { duration: 0 },
        "circle-stroke-opacity-transition": { duration: 0 },
      },
    })),
    {
      id: "epicenter-halo",
      type: "circle",
      source: "epicenter",
      paint: { "circle-color": accent, "circle-radius": zoomScaledRadius(15), "circle-opacity": 0.13 },
    },
    // Event effects (DIR-006): reported outbreak areas, disaster shockwaves, inferred aid routes.
    {
      id: "effect-outbreak-area",
      type: "circle",
      source: "effect-outbreaks",
      paint: {
        "circle-color": ["case", ["get", "zombie"], "#9ecb62", outbreakColor], "circle-opacity": 0.16, "circle-radius": kmRadius(1),
        "circle-stroke-color": ["case", ["get", "zombie"], "#9ecb62", outbreakColor], "circle-stroke-width": 1, "circle-stroke-opacity": 0.7,
      },
    },
    {
      id: "effect-outbreak-pulse",
      type: "circle",
      source: "effect-outbreaks",
      paint: {
        "circle-opacity": 0, "circle-radius": kmRadius(1),
        "circle-stroke-color": ["case", ["get", "zombie"], "#9ecb62", outbreakColor], "circle-stroke-width": 1.5, "circle-stroke-opacity": 0,
      },
    },
    { id: "effect-water-area", type: "circle", source: "effect-water", paint: {
      "circle-color": "#4cafe0", "circle-opacity": ["case", ["get", "flooding"], 0.2, 0.08],
      "circle-radius": kmRadius(1, 9),
    } },
    { id: "effect-water-wave", type: "circle", source: "effect-water", paint: {
      "circle-opacity": 0, "circle-radius": kmRadius(1, 12), "circle-stroke-color": "#8dd8f4",
      "circle-stroke-width": 1.5, "circle-stroke-opacity": 0.5,
    } },
    {
      id: "effect-shockwave-core",
      type: "circle",
      source: "effect-shockwaves",
      paint: { "circle-color": shockwaveColor, "circle-opacity": 0.22, "circle-radius": zoomScaledRadius(7) },
    },
    {
      id: "effect-shockwave-ring",
      type: "circle",
      source: "effect-shockwaves",
      paint: {
        "circle-opacity": 0, "circle-radius": kmRadius(1, 10),
        "circle-stroke-color": shockwaveColor, "circle-stroke-width": 1.5, "circle-stroke-opacity": 0.5,
      },
    },
    {
      id: "effect-route-line",
      type: "line",
      source: "effect-routes",
      layout: { "line-cap": "round" },
      paint: { "line-color": routeColor, "line-width": 1.6, "line-opacity": 0.85, "line-dasharray": [2, 2] },
    },
  ],
};

function reducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function transitionDuration(duration: number) {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : duration;
}

function validLocation(location: Partial<MapLocation> | undefined): location is MapLocation {
  return !!location && Number.isFinite(location.lat) && Number.isFinite(location.lon) &&
    Math.abs(location.lat!) <= 90 && Math.abs(location.lon!) <= 180;
}

function focusMapLocation(map: MapLibreMap, location: MapLocation, instant = false) {
  if (!validLocation(location)) return;
  const { lat, lon, zoom = 4.65 } = location;
  map.flyTo({ center: [lon, lat], zoom, duration: instant ? 0 : transitionDuration(1500) });
}

export function WorldMap({
  children,
  elapsedSeconds,
  playing,
  initialFocus,
  events,
  focusCountry,
  ref, selectedEventId, onManualInteraction,
}: {
  selectedEventId?: string;
  onManualInteraction?: () => void;
  children?: ReactNode;
  elapsedSeconds: number;
  playing: boolean;
  initialFocus?: MapLocation;
  events: ScenarioEvent[];
  focusCountry: string;
  ref: Ref<WorldMapHandle>;
}) {
  events = useMemo(() => events.filter(e => validLocation(e.location)), [events]);
  const manualCallback = useRef(onManualInteraction);
  manualCallback.current = onManualInteraction;
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [mapUnavailable, setMapUnavailable] = useState(false);
  const [country, setCountry] = useState("");
  const eventMarkers = useRef(new Map<string, Marker>());
  const aidMarkers = useRef(new Map<string, { route: AidRoute; marker: Marker; label: Marker }>());
  const cueMarkers = useRef<Marker[]>([]);
  const tornadoMarkers = useRef<Marker[]>([]);
  const volcanoMarkers = useRef<Marker[]>([]);
  const quake = events.findLast((event) => event.type === "earthquake");
  const effects = useMemo(() => deriveMapEffects(events), [events]);
  const effectList = useMemo(() => describeEffects(effects), [effects]);

  useImperativeHandle(ref, () => ({
    focusLocation(location, instant) {
      if (mapRef.current) focusMapLocation(mapRef.current, location, instant);
    },
    stopMotion() { mapRef.current?.stop(); },
  }), []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let map: MapLibreMap;
    try {
      setWorkerUrl("/maplibre-worker/maplibre-gl-worker.mjs");
      map = new MapLibreMap({
        container,
        style: mapStyle,
        bounds: worldBounds,
        fitBoundsOptions: { padding: 24, duration: 0 },
        maxZoom: 7,
        minZoom: -1,
        dragRotate: false,
        pitchWithRotate: false,
        attributionControl: false,
      });
    } catch {
      setMapUnavailable(true);
      return;
    }
    mapRef.current = map;
    const manual = (event: { originalEvent?: unknown }) => { if (event.originalEvent) manualCallback.current?.(); };
    map.on("movestart", manual);
    map.on("zoomstart", manual);
    map.getCanvas().setAttribute("aria-label", "World map. Arrow keys pan; plus and minus zoom.");
    map.touchZoomRotate.disableRotation();

    map.once("load", () => {
      let hoveredId: number | string | undefined;
      const clearHover = () => {
        if (hoveredId === undefined) return;
        map.removeFeatureState({ source: "countries", id: hoveredId }, "hover");
        hoveredId = undefined;
        setCountry("");
      };
      map.on("mousemove", "land", ({ features }) => {
        const feature = features?.[0];
        if (!feature || feature.id === hoveredId) return;
        clearHover();
        hoveredId = feature.id;
        if (hoveredId === undefined) return;
        map.setFeatureState({ source: "countries", id: hoveredId }, { hover: true });
        setCountry(String(feature.properties.name));
      });
      map.on("mouseleave", "land", clearHover);
      setMapReady(true);
      if (initialFocus && validLocation(initialFocus)) focusMapLocation(map, initialFocus, true);
    });

    const focusFromNewsroom = (event: Event) => {
      const location = (event as CustomEvent<Partial<MapLocation>>).detail;
      if (
        typeof location?.lat !== "number" || !Number.isFinite(location.lat) ||
        typeof location.lon !== "number" || !Number.isFinite(location.lon) ||
        Math.abs(location.lat) > 90 || Math.abs(location.lon) > 180
      ) return;
      const zoom = typeof location.zoom === "number" && Number.isFinite(location.zoom)
        ? location.zoom
        : undefined;
      focusMapLocation(map, { lat: location.lat, lon: location.lon, zoom });
    };
    window.addEventListener("worldsim:focus", focusFromNewsroom);

    return () => {
      window.removeEventListener("worldsim:focus", focusFromNewsroom);
      eventMarkers.current.forEach((marker) => marker.remove());
      eventMarkers.current.clear();
      aidMarkers.current.forEach(({ marker, label }) => { marker.remove(); label.remove(); });
      aidMarkers.current.clear();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    map.setFilter("scenario-outline", ["==", ["get", "code"], focusCountry]);
  }, [focusCountry, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    const currentIds = new Set(events.map((event) => event.id));
    for (const [eventId, marker] of eventMarkers.current) {
      if (currentIds.has(eventId)) continue;
      marker.remove();
      eventMarkers.current.delete(eventId);
    }
    for (const event of events) {
      if (eventMarkers.current.has(event.id)) continue;
      const element = document.createElement("div");
      element.className = event.type === "earthquake" ? "epicenter-marker" : `event-marker event-marker-${event.type}`;
      element.title = `${event.type.replaceAll("_", " ")} · ${event.location.name}`;
      if (event.provenance?.source === "user") element.classList.add("player-decision-marker");
      if (event.payload?.decision_effect) element.classList.add("player-consequence-marker");
      eventMarkers.current.set(event.id, new Marker({ element })
        .setLngLat([event.location.lon, event.location.lat]).addTo(map));
    }
  }, [events, mapReady]);

  useEffect(() => {
    const source = mapRef.current?.getSource<GeoJSONSource>("epicenter");
    if (!mapReady || !source) return;
    source.setData({
      type: "FeatureCollection",
      features: quake ? [{
        type: "Feature",
        properties: {},
        geometry: { type: "Point", coordinates: [quake.location.lon, quake.location.lat] },
      }] : [],
    });
  }, [mapReady, quake]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || !quake) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    pulseLayers.forEach((id, index) => {
      const active = elapsedSeconds > 0 && !reducedMotion;
      const phase = ((elapsedSeconds / 4) + index / pulseLayers.length) % 1;
      const radius = active ? 12 + 92 * phase : 20 + index * 20;
      const opacity = active ? (1 - phase) * 0.72 : 0.62 - index * 0.16;
      map.setPaintProperty(id, "circle-radius", zoomScaledRadius(radius));
      map.setPaintProperty(id, "circle-stroke-opacity", opacity);
    });
  }, [elapsedSeconds, mapReady, quake]);

  // Effects follow the applied events: a seek or run switch changes `events`,
  // which replaces every source and drops markers for events that are gone.
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    const data = effectData(effects);
    map.getSource<GeoJSONSource>("effect-outbreaks")?.setData(data.outbreaks);
    map.getSource<GeoJSONSource>("effect-shockwaves")?.setData(data.shockwaves);
    map.getSource<GeoJSONSource>("effect-water")?.setData(data.water);
    map.getSource<GeoJSONSource>("effect-routes")?.setData(data.routes);

    const current = new Set(effects.routes.map((route) => route.id));
    for (const [id, entry] of aidMarkers.current) {
      if (current.has(id)) continue;
      entry.marker.remove();
      entry.label.remove();
      aidMarkers.current.delete(id);
    }
    for (const route of effects.routes) {
      if (aidMarkers.current.has(route.id)) continue;
      const element = document.createElement("div");
      element.className = effectStyles.aidMarker;
      element.dataset.effect = "aid-marker";
      element.dataset.eventId = route.id;
      element.setAttribute("aria-hidden", "true");
      const text = document.createElement("div");
      text.className = effectStyles.routeLabel;
      text.dataset.effect = "route-label";
      text.textContent = `Inferred route · ${route.origin}`;
      text.setAttribute("aria-hidden", "true");
      aidMarkers.current.set(route.id, {
        route,
        marker: new Marker({ element }).setLngLat(along(route, reducedMotion() ? 1 : 0)).addTo(map),
        label: new Marker({ element: text, offset: [0, -14] }).setLngLat(along(route, 0.5)).addTo(map),
      });
    }
  }, [effects, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    tornadoMarkers.current = effects.tornadoes.map((tornado) => {
      const element = document.createElement("div");
      element.className = effectStyles.tornado;
      element.setAttribute("aria-hidden", "true");
      element.dataset.effect = "tornado";
      element.innerHTML = "<span></span><span></span><span></span>";
      return new Marker({ element }).setLngLat([tornado.lon, tornado.lat]).addTo(map);
    });
    return () => { tornadoMarkers.current.forEach(marker => marker.remove()); tornadoMarkers.current = []; };
  }, [effects.tornadoes, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    const symbols = { alien: "✦", insects: "✳", ai: "◇", darkness: "◒", nuclear: "☢" };
    cueMarkers.current = effects.cues.map((cue) => {
      const element = document.createElement("div");
      element.className = effectStyles.scenarioCue;
      element.dataset.kind = cue.kind;
      element.dataset.effect = cue.kind;
      element.setAttribute("aria-hidden", "true");
      element.textContent = symbols[cue.kind];
      return new Marker({ element }).setLngLat([cue.lon, cue.lat]).addTo(map);
    });
    return () => { cueMarkers.current.forEach(marker => marker.remove()); cueMarkers.current = []; };
  }, [effects.cues, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    volcanoMarkers.current = effects.shockwaves.filter(item => item.visual === "ash_plume").map(item => {
      const element = document.createElement("div");
      element.className = effectStyles.volcano;
      element.dataset.effect = "volcano";
      element.setAttribute("aria-hidden", "true");
      element.innerHTML = '<span class="' + effectStyles.ash + '"></span><span class="' + effectStyles.mountain + '"></span><span class="' + effectStyles.lava + '"></span>';
      return new Marker({ element, anchor: "bottom" }).setLngLat([item.lon, item.lat]).addTo(map);
    });
    return () => { volcanoMarkers.current.forEach(marker => marker.remove()); volcanoMarkers.current = []; };
  }, [effects.shockwaves, mapReady]);

  useEffect(() => {
    volcanoMarkers.current.forEach(marker => { marker.getElement().dataset.playing = String(playing); });
  }, [effects.shockwaves, mapReady, playing]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    const updateScale = () => {
      const scale = String(effectScale(map.getZoom()));
      for (const marker of [...volcanoMarkers.current, ...tornadoMarkers.current, ...cueMarkers.current]) {
        marker.getElement().style.setProperty("--effect-scale", scale);
      }
      for (const { marker } of aidMarkers.current.values()) marker.getElement().style.setProperty("--effect-scale", scale);
    };
    updateScale();
    map.on("zoom", updateScale);
    return () => { map.off("zoom", updateScale); };
  }, [effects, mapReady]);

  // Animation follows the clock: pulses, rings and aid markers move only while
  // the simulation plays, and hold still with reduced motion.
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    const still = reducedMotion() || elapsedSeconds <= 0;
    const phase = still ? 0 : (elapsedSeconds / 3) % 1;
    map.setPaintProperty("effect-outbreak-pulse", "circle-radius", kmRadius(1 + phase * 0.8));
    map.setPaintProperty("effect-outbreak-pulse", "circle-stroke-opacity", still ? 0 : 0.8 * (1 - phase));
    map.setPaintProperty("effect-shockwave-ring", "circle-radius", kmRadius(still ? 1 : 0.3 + phase * 1.4, 10));
    map.setPaintProperty("effect-shockwave-ring", "circle-stroke-opacity", still ? 0.5 : 0.85 * (1 - phase));
    map.setPaintProperty("effect-water-wave", "circle-radius", kmRadius(still ? 1 : 0.5 + phase, 12 + phase * 10));
    map.setPaintProperty("effect-water-wave", "circle-stroke-opacity", still ? 0.45 : 0.55 * (1 - phase));
    for (const marker of cueMarkers.current) {
      marker.getElement().style.setProperty("--effect-motion", still ? "1" : String(1 + 0.08 * Math.sin(elapsedSeconds * 2)));
    }
    for (const marker of tornadoMarkers.current) {
      marker.getElement().style.rotate = still ? "0deg" : `${5 * Math.sin(elapsedSeconds * 2)}deg`;
    }
    let index = 0;
    for (const { route, marker } of aidMarkers.current.values()) {
      marker.setLngLat(along(route, still ? 1 : ((elapsedSeconds / 5) + index * 0.37) % 1));
      marker.getElement().dataset.moving = String(!still);
      index += 1;
    }
  }, [effects, elapsedSeconds, mapReady]);

  useEffect(() => {
    for (const [id, marker] of eventMarkers.current) marker.getElement().dataset.selected = String(id === selectedEventId);
  }, [selectedEventId, events, mapReady]);

  return (
    <section className="map-panel" aria-label="Interactive world map">
      <div className="map-canvas" ref={containerRef} />
      <div className="map-caption">
        <h2>World map</h2>
        <span>{country || "Drag to pan · Scroll to zoom"}</span>
      </div>
      <div className="map-controls" aria-label="Map controls">
        <button type="button" title="Zoom in" aria-label="Zoom in" disabled={!mapReady}
          onClick={() => { manualCallback.current?.(); mapRef.current?.zoomIn({ duration: transitionDuration(240) }); }}>
          <Plus size={19} />
        </button>
        <button type="button" title="Zoom out" aria-label="Zoom out" disabled={!mapReady}
          onClick={() => { manualCallback.current?.(); mapRef.current?.zoomOut({ duration: transitionDuration(240) }); }}>
          <Minus size={19} />
        </button>
        <button type="button" title="Fit world view" aria-label="Fit world view" disabled={!mapReady}
          onClick={() => mapRef.current?.fitBounds(worldBounds, { padding: 24, duration: transitionDuration(800) })}>
          <CornersOut size={18} />
        </button>
      </div>
      {effectList.length > 0 && (
        <div className={effectStyles.legend} role="group" aria-label="Map effects">
          <h3>On the map</h3>
          <ul>
            {effectList.map((item) => (
              <li key={`${item.kind}-${item.id}`} data-kind={item.kind}>{item.text}</li>
            ))}
          </ul>
          {effects.routes.length > 0 && (
            <p className={effectStyles.note}>Routes are inferred: straight lines between event locations, not real paths.</p>
          )}
          {effects.outbreaks.length > 0 && (
            <p className={effectStyles.note}>Outbreak circles mark reported places only.</p>
          )}
          {effects.water.length > 0 && <p className={effectStyles.note}>Water effects illustrate reported locations, not a predicted flood boundary.</p>}
        </div>
      )}
      <div className="map-credit">
        Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community · Boundaries <a href="https://www.naturalearthdata.com/">Natural Earth</a>
      </div>
      {mapUnavailable && (
        <div className="map-message" role="status">
          <strong>Map unavailable</strong>
          <span>Try refreshing or opening the demo in a browser with WebGL support.</span>
        </div>
      )}
      {children}
    </section>
  );
}
