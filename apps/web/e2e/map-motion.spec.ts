import { expect, test } from "@playwright/test";
import type { ScenarioEvent } from "../lib/scenario";
import { arc, deriveMotion, describeMotion, distanceKm, greatCircle } from "../components/map-motion";

// Map motion: every animation is anchored to the run's own events. Pure checks, desktop only.

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Pure map-motion checks run once.");
});

const loc = (name: string, lat: number, lon: number, country = "Testland") => ({ name, country, country_code: "TST", lat, lon });
function evt(id: string, minute: number, type: string, location: ScenarioEvent["location"], payload: ScenarioEvent["payload"] = {},
  parents: string[] = [], severity = 0.5): ScenarioEvent {
  return { id, type, visual: "breaking_news", status: "applied", sim_time_minutes: minute, sequence: 0, location, severity, payload, parent_ids: parents };
}
const singapore = loc("Singapore", 1.35, 103.82), london = loc("London", 51.51, -0.13), slough = loc("Slough", 51.51, -0.59);

test("an outbreak caused far away flies in as an infected traveller, along the cause link", () => {
  const m = deriveMotion([
    evt("evt-1", 0, "disease_outbreak", singapore),
    evt("evt-2", 60, "disease_outbreak", london, {}, ["evt-1"]),
    evt("evt-3", 90, "disease_outbreak", slough, {}, ["evt-2"]),  // 32 km away: no flight
  ]);
  expect(m.journeys).toHaveLength(1);
  expect(m.journeys[0]).toMatchObject({ eventId: "evt-2", vehicle: "plane", fromPlace: "Singapore", toPlace: "London", label: "Infected traveller" });
  expect(describeMotion(m)).toEqual([{ id: "journey-evt-2", kind: "journey", text: "Infected traveller · Singapore → London" }]);
});

test("nothing travels without a cause link, and later events never cause earlier ones", () => {
  const m = deriveMotion([evt("evt-1", 0, "disease_outbreak", singapore), evt("evt-2", 60, "disease_outbreak", london)]);
  expect(m.journeys).toHaveLength(0);
  // A "cause" listed with a later time is ignored: nothing flies backwards in time.
  const backwards = deriveMotion([evt("evt-1", 0, "disease_outbreak", singapore, {}, ["evt-2"]), evt("evt-2", 60, "disease_outbreak", london)]);
  expect(backwards.journeys).toHaveLength(0);
});

test("each kind of event gets its own vehicle", () => {
  const m = deriveMotion([
    evt("a", 0, "infrastructure_failure", singapore),
    evt("b", 10, "military_strike", london, {}, ["a"]),
    evt("c", 20, "alien_contact", london, {}, ["a"]),
    evt("d", 30, "economic_shock", london, {}, ["a"]),
  ]);
  expect(m.journeys.map((j) => j.vehicle)).toEqual(["missile", "ufo", "pulse"]);
  expect(m.ufos.map((u) => u.id)).toEqual(["c"]);
});

test("an eruption puts up an ash cloud sized by its VEI, a detonation a flash and fallout", () => {
  const m = deriveMotion([
    evt("v", 0, "volcanic_eruption", loc("Reykjanes", 63.9, -22.3), { vei: 4 }),
    evt("n", 10, "nuclear_detonation", loc("Open sea", 48.9, -7.6)),
  ]);
  expect(m.clouds.map((c) => c.kind)).toEqual(["ash", "fallout"]);
  expect(m.clouds[0].radiusKm).toBeGreaterThan(1000);
  expect(m.flashes.map((f) => f.id)).toEqual(["n"]);
  expect(describeMotion(m).map((d) => d.text)).toEqual(["Ash cloud · Reykjanes", "Fallout plume · Open sea"]);
});

test("waves, outages, evacuations, storms, quakes and endings each animate at their own place", () => {
  const m = deriveMotion([
    evt("t", 0, "tsunami_warning", singapore), evt("o", 1, "infrastructure_failure", london), evt("e", 2, "evacuation", london),
    evt("s", 3, "extreme_weather", london), evt("q", 4, "earthquake", london), evt("r", 5, "recovery", london), evt("c", 6, "ceasefire", london),
  ]);
  expect([m.waves, m.blackouts, m.evacuations, m.storms, m.quakes].map((list) => list.map((a) => a.id))).toEqual([["t"], ["o"], ["e"], ["s"], ["q"]]);
  expect(m.rings.map((r) => r.id)).toEqual(["r", "c"]);
});

test("flight paths follow the great circle and never jump across the map", () => {
  const sg: [number, number] = [103.82, 1.35], ny: [number, number] = [-74, 40.7];
  expect(Math.round(distanceKm(sg, ny))).toBeGreaterThan(15000);
  expect(greatCircle(sg, ny, 0)[0]).toBeCloseTo(103.82, 5);
  const path = arc(sg, ny);
  // Longitudes are unwrapped: no step ever wraps around the antimeridian (even passing near the pole).
  for (let i = 1; i < path.length; i++) expect(Math.abs(path[i][0] - path[i - 1][0])).toBeLessThan(180);
  const pacific = arc([170, 0], [-170, 0]);
  expect(pacific.at(-1)![0]).toBeCloseTo(190, 5);
});
