"use client";

import { CornersOut, Minus, Plus } from "@phosphor-icons/react";
import type { FeatureCollection, LineString } from "geojson";
import { Map, Marker, setWorkerUrl, type StyleSpecification } from "maplibre-gl";
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { earthquake, type MapLocation } from "../lib/earthquake";

export type WorldMapHandle = {
  focusLocation: (location: MapLocation) => void;
};

const accent = "#ffa96b";
const worldBounds: [[number, number], [number, number]] = [
  [-175, -57],
  [179, 76],
];
const epicenter = [earthquake.location.lon, earthquake.location.lat] as const;
const pulseLayers = ["pulse-first", "pulse-second", "pulse-third"];

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
      data: {
        type: "Feature",
        properties: {},
        geometry: { type: "Point", coordinates: [...epicenter] },
      },
    },
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
          ["==", ["get", "code"], "JPN"],
          "#ffa96b",
          "#eff3ed",
        ],
        "fill-opacity": [
          "case",
          ["boolean", ["feature-state", "hover"], false], 0.28,
          ["==", ["get", "code"], "JPN"], 0.2,
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
      id: "japan-outline",
      type: "line",
      source: "countries",
      filter: ["==", ["get", "code"], "JPN"],
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
      paint: { "circle-color": accent, "circle-radius": 15, "circle-opacity": 0.13 },
    },
  ],
};

function transitionDuration(duration: number) {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : duration;
}

function focusMapLocation(map: Map, { lat, lon, zoom = 4.65 }: MapLocation) {
  map.flyTo({ center: [lon, lat], zoom, duration: transitionDuration(1500) });
}

export function WorldMap({
  elapsedSeconds,
  ref,
}: {
  elapsedSeconds: number;
  ref: Ref<WorldMapHandle>;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [mapUnavailable, setMapUnavailable] = useState(false);
  const [country, setCountry] = useState("");

  useImperativeHandle(ref, () => ({
    focusLocation(location) {
      if (mapRef.current) focusMapLocation(mapRef.current, location);
    },
  }), []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let map: Map;
    try {
      setWorkerUrl("/maplibre-worker/maplibre-gl-worker.mjs");
      map = new Map({
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
    map.getCanvas().setAttribute("aria-label", "World map. Arrow keys pan; plus and minus zoom.");
    map.touchZoomRotate.disableRotation();

    map.on("error", () => {
      setMapUnavailable(true);
    });

    map.once("load", () => {
      const marker = document.createElement("div");
      marker.className = "epicenter-marker";
      const label = document.createElement("span");
      label.className = "epicenter-label";
      label.textContent = "Miyagi coast";
      marker.append(label);
      new Marker({ element: marker })
        .setLngLat([...epicenter])
        .addTo(map);

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
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || !map.getLayer(pulseLayers[0])) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    pulseLayers.forEach((id, index) => {
      const active = elapsedSeconds > 0 && elapsedSeconds < earthquake.durationSeconds && !reducedMotion;
      const phase = ((elapsedSeconds / 4) + index / pulseLayers.length) % 1;
      const radius = active ? 12 + 92 * phase : 20 + index * 20;
      const opacity = active ? (1 - phase) * 0.72 : 0.62 - index * 0.16;
      map.setPaintProperty(id, "circle-radius", radius);
      map.setPaintProperty(id, "circle-stroke-opacity", opacity);
    });
  }, [elapsedSeconds, mapReady]);

  return (
    <section className="map-panel" aria-label="Interactive world map">
      <div className="map-canvas" ref={containerRef} />
      <div className="map-caption">
        <h2>World map</h2>
        <span>{country || "Drag to pan · Scroll to zoom"}</span>
      </div>
      <div className="map-controls" aria-label="Map controls">
        <button type="button" title="Zoom in" aria-label="Zoom in" disabled={!mapReady}
          onClick={() => mapRef.current?.zoomIn({ duration: transitionDuration(240) })}>
          <Plus size={19} />
        </button>
        <button type="button" title="Zoom out" aria-label="Zoom out" disabled={!mapReady}
          onClick={() => mapRef.current?.zoomOut({ duration: transitionDuration(240) })}>
          <Minus size={19} />
        </button>
        <button type="button" title="Fit world view" aria-label="Fit world view" disabled={!mapReady}
          onClick={() => mapRef.current?.fitBounds(worldBounds, { padding: 24, duration: transitionDuration(800) })}>
          <CornersOut size={18} />
        </button>
      </div>
      <div className="map-credit">
        Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community · Boundaries <a href="https://www.naturalearthdata.com/">Natural Earth</a>
      </div>
      {mapUnavailable && (
        <div className="map-message" role="status">
          <strong>Map unavailable</strong>
          <span>Try refreshing or opening the demo in a browser with WebGL support.</span>
        </div>
      )}
    </section>
  );
}
