import { expect, test, type Page } from "@playwright/test";
import type { ScenarioEvent } from "../lib/scenario";

// WEB-006 (#60): generation progress from the service's real stage, and the
// run's relative pacing (SIM-005) next to the timeline. Desktop project only.

const start = 29;
const end = 450;
const identity = { schema_version: "0.1", simulation_id: "sim-paced", branch_id: "main" };
const event: ScenarioEvent = {
  id: "evt-0001", type: "flooding", status: "applied", sim_time_minutes: 30, sequence: 0, severity: 0.6,
  visual: "weather_disaster", parent_ids: [], payload: {},
  location: { name: "Delta Town", country: "Testland", country_code: "TST", lat: 10, lon: 20 },
};
const pacing = {
  mode: "relative", fraction_per_tick: 0.05, start_minutes: start, span_minutes: end - start,
  minutes_per_tick: 0.05 * (end - start), tick_seconds: 1,
};

async function mockService(page: Page, stages: string[]) {
  let polls = 0;
  await page.route(/\/api\/simulation\/scenarios(?:\/.*)?$/, async (route) => {
    const [, path] = new URL(route.request().url()).pathname.split("/scenarios");
    if (!path) {
      return route.fulfill({ status: 202, json: { id: "paced", ...identity, status: "generating", stage: "queued", elapsed_s: 0 } });
    }
    const [, , endpoint] = path.split("/");
    if (endpoint === "timeline") {
      return route.fulfill({ json: { ...identity, sim_time_minutes: start, end_minutes: end, events: [event], pacing } });
    }
    if (endpoint === "news") return route.fulfill({ json: { ...identity, items: [] } });
    const stage = stages[polls++];
    if (stage) {
      return route.fulfill({ json: { id: "paced", ...identity, status: "generating", stage, elapsed_s: polls * 0.7 } });
    }
    return route.fulfill({ json: { id: "paced", ...identity, status: "ready", title: "Paced flood", start_minutes: start } });
  });
  await page.routeWebSocket(/\/scenarios\/[^/]+\/stream$/, (socket) => {
    let speed = 1;
    const send = (data: object) => socket.send(JSON.stringify({ ...identity, sim_time_minutes: start, ...data }));
    send({ kind: "snapshot", playback: { state: "paused", speed }, events: [] });
    socket.onMessage((raw) => {
      const control = JSON.parse(String(raw));
      if (control.action === "speed") {
        speed = control.speed;
        send({ kind: "clock", playback: { state: "paused", speed } });
      }
    });
  });
}

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "The console is covered by the desktop project.");
});

test("generation shows the service's actual stage, then the run's relative pacing", async ({ page }) => {
  await mockService(page, ["model", "model", "validate"]);
  await page.goto("/");
  await page.getByLabel("Scenario prompt").fill("A river floods Delta Town.");
  await page.getByRole("button", { name: "Generate scenario" }).click();

  const status = page.locator(".scenario-launch-footer p");
  await expect(status).toContainText("The Director is predicting events");
  await expect(status).toContainText("Elapsed:");
  await expect(status).not.toContainText("%");  // no invented completion percentage
  await expect(status).toContainText("Validating events");
  await expect(page.getByRole("heading", { name: "Paced flood" })).toBeVisible();

  const playback = page.getByRole("region", { name: "Simulation playback" });
  const pacingNote = playback.getByLabel("Playback pacing");
  await expect(pacingNote).toContainText("≈5% of the scenario per second");
  await expect(pacingNote).toContainText("about 20s left");
  await playback.getByRole("button", { name: "4×" }).click();
  await expect(pacingNote).toContainText("≈20% of the scenario per second");
  await expect(pacingNote).toContainText("about 5s left");
});

test("the Japan demo keeps its fixed rate and shows no pacing note", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Earthquake off Japan" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Simulation playback" }).getByLabel("Playback pacing")).toHaveCount(0);
});
