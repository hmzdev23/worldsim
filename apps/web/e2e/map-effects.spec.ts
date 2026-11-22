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

async function mockScenarioService(page: Page) {
  let submissions = 0;
  await page.route(/\/api\/simulation\/scenarios(?:\/.*)?$/, async (route) => {
    const [, path] = new URL(route.request().url()).pathname.split("/scenarios");
    if (!path) {
      const run = runs[submissions++];
      return route.fulfill({ status: 202, json: { id: run.id, ...run.identity, status: "generating" } });
    }
    const [, id, endpoint] = path.split("/");
    const run = runs.find((item) => item.id === id)!;
    if (endpoint === "timeline") {
      return route.fulfill({ json: { ...run.identity, sim_time_minutes: start, end_minutes: end, events: run.events } });
    }
    if (endpoint === "news") {
      return route.fulfill({ json: { ...run.identity, items: run.events.map(fallbackNewsItem).reverse() } });
    }
    return route.fulfill({ json: { id, ...run.identity, status: "ready", title: run.title, start_minutes: start } });
  });

  await page.routeWebSocket(/\/scenarios\/[^/]+\/stream$/, (socket) => {
    const run = runs.find((item) => new URL(socket.url()).pathname.includes(`/${item.id}/`))!;
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
  await page.getByRole("button", { name: "Generate scenario" }).click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
}

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Map effects are covered by the desktop project.");
});

test("an outbreak without a reported radius stays a point pulse", () => {
  const event = evt("evt-no-radius", 10, "disease_outbreak", "contagion_spread",
    loc("Quebec City", "Canada", "CAN", 46.81, -71.21), { pathogen: "unknown pathogen" });
  expect(deriveMapEffects([event]).outbreaks[0]).toMatchObject({ id: "evt-no-radius", radiusKm: 0 });
});

test("outbreaks accumulate, disasters ring, and only a supported aid route is drawn", async ({ page }) => {
  await mockScenarioService(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Watch a simulation", exact: true }).click();
  const map = page.getByRole("region", { name: "Interactive world map" });
  const effects = map.getByRole("group", { name: "Map effects" });
  const playback = page.getByRole("region", { name: "Simulation playback" });

  await generate(page, "A new virus spreads from Singapore while aid moves.", "Pandemic and aid");
  await expect(effects).toHaveCount(0);
  await playback.getByRole("button", { name: "Play", exact: true }).click();

  await expect(effects.getByRole("listitem")).toHaveText([
    "novel respiratory virus reported · Singapore",
    "novel respiratory virus reported · London",
    "Eruption · Reykjanes Peninsula",
    "Inferred aid route · Germany (Frankfurt) → Lagos",
  ]);
  await expect(effects).toContainText("Routes are inferred");
  await expect(effects).toContainText("Outbreak circles mark reported places only.");
  // One route: Germany has an earlier event (Frankfurt); Norway has none, so no route to Reykjavik.
  await expect(map.locator('[data-effect="aid-marker"]')).toHaveCount(1);
  await expect(map.locator('[data-effect="aid-marker"]')).toHaveAttribute("data-event-id", "evt-0004");
  await expect(map.locator('[data-effect="route-label"]')).toHaveText("Inferred route · Germany");

  // The effects never block the map controls or take clicks.
  await expect(effects).toHaveCSS("pointer-events", "none");
  await map.getByRole("button", { name: "Zoom in" }).click();

  // Seeking back removes effects for events that are no longer applied.
  const slider = playback.getByRole("slider");
  await slider.press("Home");
  await expect(effects).toHaveCount(0);
  await expect(map.locator('[data-effect="aid-marker"]')).toHaveCount(0);
  await expect(map.locator('[data-effect="route-label"]')).toHaveCount(0);

  // Replaying brings them back, and switching runs clears them.
  await playback.getByRole("button", { name: "Play", exact: true }).click();
  await expect(effects.getByRole("listitem")).toHaveCount(4);
  await generate(page, "Power returns to Laval.", "Quiet recovery");
  await expect(effects).toHaveCount(0);
  await expect(map.locator('[data-effect="aid-marker"]')).toHaveCount(0);
});

test.describe("with reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("the aid marker rests at the destination instead of moving", async ({ page }) => {
    await mockScenarioService(page);
    await page.goto("/");
  await page.getByRole("button", { name: "Watch a simulation", exact: true }).click();
    const map = page.getByRole("region", { name: "Interactive world map" });
    await generate(page, "A new virus spreads from Singapore while aid moves.", "Pandemic and aid");
    await page.getByRole("region", { name: "Simulation playback" }).getByRole("button", { name: "Play", exact: true }).click();
    await expect(map.locator('[data-effect="aid-marker"]')).toHaveAttribute("data-moving", "false");
  });
});
