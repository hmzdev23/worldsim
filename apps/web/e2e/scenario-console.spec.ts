import { expect, test, type Page } from "@playwright/test";
import { fallbackNewsItem, type ScenarioEvent } from "../lib/scenario";

const iceland = { name: "Reykjanes Peninsula", country: "Iceland", country_code: "ISL", lat: 63.88, lon: -22.27 };
const canada = { name: "Laval", country: "Canada", country_code: "CAN", lat: 45.57, lon: -73.75 };
const start = 189;
const end = 250;

function fixtureRun(id: string, title: string, location: ScenarioEvent["location"]) {
  const identity = { schema_version: "0.1", simulation_id: `sim-${id}`, branch_id: "main" };
  const event: ScenarioEvent = {
    id: "evt-0001",
    type: "infrastructure_failure",
    status: "applied",
    sim_time_minutes: start + 1,
    sequence: 0,
    location,
    severity: 0.65,
    visual: "power_grid_failure",
    payload: { description: "Backup services are operating.", impacts: { basis: "fictional_estimate", households_without_power: 850 } },
    parent_ids: [],
  };
  const followUp: ScenarioEvent = {
    ...event, id: "evt-0002", type: "recovery", sim_time_minutes: end, parent_ids: [event.id],
  };
  const reports = [
    { ...fallbackNewsItem(event), headline: `Crews respond to outages in ${location.name}` },
    { ...fallbackNewsItem(followUp), headline: `Services restored in ${location.name}` },
  ];
  return { id, title, identity, events: [event, followUp], reports };
}

const runs = [fixtureRun("iceland", "Iceland eruption", iceland), fixtureRun("canada", "Québec power outage", canada)];

async function mockScenarioService(page: Page, { failFirst = false } = {}) {
  let submissions = 0;
  await page.route(/\/api\/simulation\/scenarios(?:\/.*)?$/, async (route) => {
    const [, path] = new URL(route.request().url()).pathname.split("/scenarios");
    if (!path) {
      const run = runs[failFirst ? 0 : submissions];
      expect(route.request().postDataJSON().prompt).toBeTruthy();
      submissions += 1;
      return route.fulfill({ status: 202, json: { id: run.id, ...run.identity, status: "generating" } });
    }
    const [, id, endpoint] = path.split("/");
    const run = runs.find((item) => item.id === id)!;
    if (endpoint === "timeline") {
      return route.fulfill({ json: { ...run.identity, sim_time_minutes: start, end_minutes: end, events: run.events } });
    }
    if (endpoint === "news") {
      // Give the client a scheduled story to check that only applied IDs enter the archive.
      return route.fulfill({ json: { ...run.identity, items: [...run.reports].reverse() } });
    }
    if (failFirst && submissions === 1) {
      return route.fulfill({ json: { id, ...run.identity, status: "failed", error: { message: "The Director took too long." } } });
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
        minute = start + 1;
        send({ kind: "event", event: run.events[0] });
        send({ kind: "clock", playback: { state, speed: 1 } });
      } else if (control.action === "pause") {
        state = "paused";
        send({ kind: "clock", playback: { state, speed: 1 } });
      }
    });
  });
}

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "The prompt console is covered by the desktop project.");
});

test.use({ reducedMotion: "reduce" });

test("prompted playback keeps headlines, map focus, and seeks scoped to each run", async ({ page }) => {
  await mockScenarioService(page);
  await page.goto("/");
  await page.goto("/?demo=japan");
  const prompt = page.getByLabel("Scenario prompt");
  const playback = page.getByRole("region", { name: "Simulation playback" });
  const archive = page.getByRole("region", { name: "Reports" });
  const overlay = page.locator(".headline-alert");
  const map = page.getByRole("region", { name: "Interactive world map" });
  const slider = playback.getByRole("slider");

  await prompt.fill("An Iceland eruption interrupts power on the Reykjanes Peninsula.");
  await prompt.press("Tab");
  await expect(page.getByRole("button", { name: "Simulate", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Preparing a new run")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Iceland eruption" })).toBeVisible();
  await expect(slider).toHaveAttribute("min", String(start));
  await expect(slider).toHaveAttribute("max", String(end));
  // A new run plays by itself; nothing waits for the viewer.

  await expect(overlay.getByRole("heading")).toHaveText(runs[0].reports[0].headline);
  await expect(archive.getByText(runs[0].reports[0].headline, { exact: true })).toBeVisible();
  await expect(archive).not.toContainText(runs[0].reports[1].headline);
  await expect(page.getByRole("region", { name: "Impact estimates" })).toContainText("850 households");
  await expect(map.getByRole("button", { name: "Zoom in" })).toBeEnabled();
  await overlay.getByRole("button", { name: "Focus map" }).click();
  const marker = map.locator(".event-marker-infrastructure_failure");
  await expect.poll(async () => {
    const [feature, canvas, headline] = await Promise.all([marker.boundingBox(), map.boundingBox(), overlay.boundingBox()]);
    if (!feature || !canvas || !headline) return false;
    const x = feature.x + feature.width / 2;
    const y = feature.y + feature.height / 2;
    // Centred on the map and not hidden behind the headline card (now a compact card at the right).
    return Math.abs(x - (canvas.x + canvas.width / 2)) < 6 && (y < headline.y || x < headline.x);
  }).toBe(true);

  await playback.getByRole("button", { name: "Pause", exact: true }).click();
  await slider.press("End");
  await expect(archive.getByText(runs[0].reports[1].headline)).toBeVisible();
  await expect(overlay).toHaveCount(0);
  await playback.getByRole("button", { name: "Replay", exact: true }).click();
  await expect(overlay.getByRole("heading")).toHaveText(runs[0].reports[0].headline);

  await prompt.fill("An outage shuts down part of Laval's power grid.");
  await page.getByRole("button", { name: "Simulate", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Québec power outage" })).toBeVisible();
  await expect(overlay.getByRole("heading")).toHaveText(runs[1].reports[0].headline);
  await expect(archive).not.toContainText(runs[0].reports[0].headline);
});

test("a failed generation can be retried without leaving the demo workspace", async ({ page }) => {
  await mockScenarioService(page, { failFirst: true });
  await page.goto("/");
  await page.goto("/?demo=japan");
  const prompt = page.getByLabel("Scenario prompt");
  await prompt.fill("A power outage on the Reykjanes Peninsula.");
  await page.getByRole("button", { name: "Simulate", exact: true }).click();
  await expect(page.getByText("The Director took too long.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Earthquake off Japan" })).toBeVisible();
  await expect(prompt).toHaveValue("A power outage on the Reykjanes Peninsula.");
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("heading", { name: "Iceland eruption" })).toBeVisible();
  await page.goto("/?demo=japan");
  await expect(page.getByRole("heading", { name: "Earthquake off Japan" })).toBeVisible();
});
