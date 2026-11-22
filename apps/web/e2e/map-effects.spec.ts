import { expect, test, type Page } from "@playwright/test";
import { fallbackNewsItem, type ScenarioEvent } from "../lib/scenario";
import { deriveMapEffects } from "../components/map-effects";

// DIR-006 (#61): map effects come from applied events only. Desktop project only.

const start = 0;
const end = 60;
const loc = (name: string, country: string, code: string, lat: number, lon: number) => (
  { name, country, country_code: code, lat, lon }
);

function evt(id: string, minute: number, type: string, visual: string, location: ScenarioEvent["location"],
  payload: ScenarioEvent["payload"] = {}, parents: string[] = []): ScenarioEvent {
  return {
    id, type, visual, status: "applied", sim_time_minutes: minute, sequence: 0, location, severity: 0.5,
    payload, parent_ids: parents,
  };
}

async function expectAnchored(visual: import("@playwright/test").Locator, event: import("@playwright/test").Locator, bottom = false) {
  await expect.poll(async () => {
    const a = await visual.boundingBox(), b = await event.boundingBox();
    if (!a || !b) return Infinity;
    const dx = Math.abs(a.x + a.width / 2 - (b.x + b.width / 2));
    const dy = Math.abs((bottom ? a.y + a.height : a.y + a.height / 2) - (b.y + b.height / 2));
    return Math.max(dx, dy);
  }).toBeLessThan(2);
}

const pandemic = [
  evt("evt-0001", 10, "disease_outbreak", "contagion_spread", loc("Singapore", "Singapore", "SGP", 1.35, 103.82),
    { pathogen: "novel respiratory virus", radius_km: 20 }),
  evt("evt-0002", 20, "disease_outbreak", "contagion_spread", loc("London", "United Kingdom", "GBR", 51.51, -0.13),
    { pathogen: "novel respiratory virus", radius_km: 60 }, ["evt-0001"]),
  evt("evt-0003", 30, "economic_shock", "market_shock", loc("Frankfurt", "Germany", "DEU", 50.11, 8.68), {}, ["evt-0002"]),
  evt("evt-0004", 40, "international_aid", "animated_transport_route", loc("Lagos", "Nigeria", "NGA", 6.52, 3.38),
    { origin: "Germany" }, ["evt-0001"]),
  evt("evt-0005", 50, "international_aid", "animated_transport_route", loc("Reykjavik", "Iceland", "ISL", 64.15, -21.94),
    { origin: "Norway" }, ["evt-0001"]),
  evt("evt-0006", 60, "volcanic_eruption", "ash_plume", loc("Reykjanes Peninsula", "Iceland", "ISL", 63.88, -22.27),
    { vei: 3, radius_km: 40 }),
];
const quiet = [evt("evt-0001", 30, "recovery", "recovery_pulse", loc("Laval", "Canada", "CAN", 45.57, -73.75))];

const runs = [
  { id: "pandemic", title: "Pandemic and aid", events: pandemic },
  { id: "quiet", title: "Quiet recovery", events: quiet },
].map((run) => ({ ...run, identity: { schema_version: "0.1", simulation_id: `sim-${run.id}`, branch_id: "main" } }));

async function mockScenarioService(page: Page, special = false) {
  const runsForTest = special ? [{ id: "special", title: "Special effects", identity: { schema_version: "0.1", simulation_id: "sim-special", branch_id: "main" }, events: [
    evt("water", 10, "tsunami_warning", "weather_disaster", loc("Valparaiso", "Chile", "CHL", -33.05, -71.62)),
    evt("alien", 20, "alien_contact", "weather_disaster", loc("Nairobi", "Kenya", "KEN", -1.29, 36.82)),
    evt("tornado", 30, "other_hazard", "weather_disaster", loc("Toronto", "Canada", "CAN", 43.65, -79.38), { label: "Tornado" }),
  ] }] : runs;
  let submissions = 0;
  await page.route(/\/api\/simulation\/scenarios(?:\/.*)?$/, async (route) => {
    const [, path] = new URL(route.request().url()).pathname.split("/scenarios");
    if (!path) {
      const run = runsForTest[submissions++];
      return route.fulfill({ status: 202, json: { id: run.id, ...run.identity, status: "generating" } });
    }
    const [, id, endpoint] = path.split("/");
    const run = runsForTest.find((item) => item.id === id)!;
    if (endpoint === "timeline") {
      return route.fulfill({ json: { ...run.identity, sim_time_minutes: start, end_minutes: end, events: run.events } });
    }
    if (endpoint === "news") {
      return route.fulfill({ json: { ...run.identity, items: run.events.map(fallbackNewsItem).reverse() } });
    }
    return route.fulfill({ json: { id, ...run.identity, status: "ready", title: run.title, start_minutes: start } });
  });

  await page.routeWebSocket(/\/scenarios\/[^/]+\/stream$/, (socket) => {
    const run = runsForTest.find((item) => new URL(socket.url()).pathname.includes(`/${item.id}/`))!;
    let minute = start;
    let state: "paused" | "playing" = "paused";
    const send = (data: object) => socket.send(JSON.stringify({ ...run.identity, sim_time_minutes: minute, ...data }));
    const snapshot = () => send({
      kind: "snapshot", playback: { state, speed: 1 },
      events: run.events.filter((event) => event.sim_time_minutes <= minute),
    });
    snapshot();
    socket.onMessage((raw) => {
      const control = JSON.parse(String(raw));
      if (control.action === "seek") {
        minute = control.sim_time_minutes;
        snapshot();
      } else if (control.action === "play") {
        state = "playing";
        for (const event of run.events.filter((item) => item.sim_time_minutes > minute)) {
          minute = event.sim_time_minutes;
          send({ kind: "event", event });
        }
        state = "paused";
        send({ kind: "clock", playback: { state, speed: 1 } });
      } else if (control.action === "pause") {
        state = "paused";
        send({ kind: "clock", playback: { state, speed: 1 } });
      }
    });
  });
}

async function generate(page: Page, prompt: string, title: string) {
  await page.getByLabel("Scenario prompt").fill(prompt);
  await page.getByRole("button", { name: "Simulate", exact: true }).click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
}

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Map effects are covered by the desktop project.");
});

test("special effects appear on the map and clear on rewind", async ({ page }) => {
  await mockScenarioService(page, true);
  await page.goto("/");
  await page.getByRole("button", { name: "Japan demo", exact: true }).click();
  await generate(page, "A hypothetical chain of events", "Special effects");
  const map = page.getByRole("region", { name: "Interactive world map" });
  const playback = page.getByRole("region", { name: "Simulation playback" });
  // A new run plays by itself.
  await expect(map.getByRole("group", { name: "Map effects" })).toContainText("Tsunami warning");
  await expect(map.locator('[data-effect="alien"]')).toHaveCount(1);
  await expect(map.locator('[data-effect="tornado"]')).toHaveCount(1);
  const alien = map.locator('[data-effect="alien"]');
  const tornado = map.locator('[data-effect="tornado"]');
  const initialAlien = (await alien.boundingBox())!.width;
  const initialTornado = (await tornado.boundingBox())!.width;
  const alienEvent = map.locator('[title="alien contact · Nairobi"]');
  const tornadoEvent = map.locator('[title="other hazard · Toronto"]');
  await expectAnchored(alien, alienEvent);
  await expectAnchored(tornado, tornadoEvent);
  await map.getByRole("button", { name: "Zoom in" }).click();
  await expect.poll(async () => (await alien.boundingBox())!.width).toBeGreaterThan(initialAlien);
  await expect.poll(async () => (await tornado.boundingBox())!.width).toBeGreaterThan(initialTornado);
  await expectAnchored(alien, alienEvent);
  await expectAnchored(tornado, tornadoEvent);
  await playback.getByRole("slider").press("Home");
  await expect(map.locator('[data-effect="alien"]')).toHaveCount(0);
  await expect(map.locator('[data-effect="tornado"]')).toHaveCount(0);
});

test("an outbreak without a reported radius stays a point pulse", () => {
  const event = evt("evt-no-radius", 10, "disease_outbreak", "contagion_spread",
    loc("Quebec City", "Canada", "CAN", 46.81, -71.21), { pathogen: "unknown pathogen" });
  expect(deriveMapEffects([event]).outbreaks[0]).toMatchObject({ id: "evt-no-radius", radiusKm: 0 });
});

test("water, zombie and tornado effects follow applied events without inventing an extent", () => {
  const location = loc("Toronto", "Canada", "CAN", 43.65, -79.38);
  const tsunami = evt("wave", 1, "tsunami_warning", "weather_disaster", location);
  const flood = evt("flood", 2, "flooding", "weather_disaster", location, { radius_km: 3 });
  const zombie = evt("zombie", 3, "disease_outbreak", "contagion_spread", location, { pathogen: "Fictional Z-series" });
  const tornado = evt("tornado", 4, "other_hazard", "weather_disaster", location, { label: "Tornado" });
  const effects = deriveMapEffects([tsunami, flood, zombie, tornado]);
  expect(effects.water).toMatchObject([{ id: "wave", radiusKm: 0, flooding: false }, { id: "flood", radiusKm: 3, flooding: true }]);
  expect(effects.outbreaks[0]).toMatchObject({ id: "zombie", zombie: true, radiusKm: 0 });
  expect(effects.tornadoes).toMatchObject([{ id: "tornado" }]);
  expect(deriveMapEffects([tsunami]).tornadoes).toHaveLength(0);
  expect(deriveMapEffects([{ ...flood, status: "proposed" }]).water).toHaveLength(0);
});

test("special scenarios get identifiable cues at their reported locations", () => {
  const location = loc("Nairobi", "Kenya", "KEN", -1.29, 36.82);
  const cases = [
    ["alien_contact", "Alien contact is reported", "alien"],
    ["cyber_attack", "Automated services fail", "ai"],
    ["other_hazard", "Giant Insect Mutation", "insects"],
    ["other_hazard", "The Sun mysteriously ceases to provide light", "darkness"],
    ["other_hazard", "Monitors report a nuclear exchange in unnamed conflict zones", "nuclear"],
  ];
  for (const [type, description, kind] of cases) {
    const result = deriveMapEffects([evt(kind, 1, type, "weather_disaster", location, { description })]);
    expect(result.cues).toMatchObject([{ id: kind, kind, place: "Nairobi" }]);
  }
});

test("outbreaks accumulate, disasters ring, and only a supported aid route is drawn", async ({ page }) => {
  await mockScenarioService(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Japan demo", exact: true }).click();
  const map = page.getByRole("region", { name: "Interactive world map" });
  const effects = map.getByRole("group", { name: "Map effects" });
  const playback = page.getByRole("region", { name: "Simulation playback" });

  await generate(page, "A new virus spreads from Singapore while aid moves.", "Pandemic and aid");
  // A new run plays by itself.

  await expect(effects.getByRole("listitem")).toHaveText([
    "novel respiratory virus reported · Singapore",
    "novel respiratory virus reported · London",
    "Eruption · Reykjanes Peninsula",
    "Inferred aid route · Germany (Frankfurt) → Lagos",
    // Map motion: a flight along the run's own cause link, and the eruption's ash cloud.
    "Infected traveller · Singapore → London",
    "Ash cloud · Reykjanes Peninsula",
  ]);
  await expect(effects).toContainText("clouds and paths are illustrations, not forecasts");
  await expect(map.locator('[data-effect="plane"][data-journey="journey-evt-0002"]')).toHaveCount(1);
  await expect(effects).toContainText("Routes are inferred");
  await expect(effects).toContainText("Outbreak circles mark reported places only.");
  await expect(map.locator('[data-effect="volcano"]')).toHaveCount(1);
  const volcano = map.locator('[data-effect="volcano"]');
  const initialWidth = (await volcano.boundingBox())!.width;
  const eruptionEvent = map.locator('[title="volcanic eruption · Reykjanes Peninsula"]');
  await expectAnchored(volcano, eruptionEvent, true);
  // One route: Germany has an earlier event (Frankfurt); Norway has none, so no route to Reykjavik.
  await expect(map.locator('[data-effect="aid-marker"]')).toHaveCount(1);
  await expect(map.locator('[data-effect="aid-marker"]')).toHaveAttribute("data-event-id", "evt-0004");
  await expect(map.locator('[data-effect="route-label"]')).toHaveText("Inferred route · Germany");

  // The effects never block the map controls or take clicks.
  await expect(effects).toHaveCSS("pointer-events", "none");
  await map.getByRole("button", { name: "Zoom in" }).click();
  await expect.poll(async () => (await volcano.boundingBox())!.width).toBeGreaterThan(initialWidth);
  await expectAnchored(volcano, eruptionEvent, true);

  // Seeking back removes effects for events that are no longer applied.
  const slider = playback.getByRole("slider");
  await slider.press("Home");
  await expect(effects).toHaveCount(0);
  await expect(map.locator('[data-effect="aid-marker"]')).toHaveCount(0);
  await expect(map.locator('[data-effect="route-label"]')).toHaveCount(0);
  await expect(map.locator('[data-effect="volcano"]')).toHaveCount(0);

  // Replaying brings them back, and switching runs clears them.
  await playback.getByRole("button", { name: "Play", exact: true }).click();
  await expect(effects.getByRole("listitem")).toHaveCount(6);
  await generate(page, "Power returns to Laval.", "Quiet recovery");
  await expect(effects).toHaveCount(0);
  await expect(map.locator('[data-effect="aid-marker"]')).toHaveCount(0);
});

test.describe("with reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("the aid marker rests at the destination instead of moving", async ({ page }) => {
    await mockScenarioService(page);
    await page.goto("/");
  await page.getByRole("button", { name: "Japan demo", exact: true }).click();
    const map = page.getByRole("region", { name: "Interactive world map" });
    await generate(page, "A new virus spreads from Singapore while aid moves.", "Pandemic and aid");
    // A new run plays by itself.
    await expect(map.locator('[data-effect="aid-marker"]')).toHaveAttribute("data-moving", "false");
    await expectAnchored(map.locator('[data-effect="aid-marker"]'), map.locator('[title="international aid · Lagos"]'));
  });
});
