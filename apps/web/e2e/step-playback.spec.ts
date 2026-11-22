import { expect, test, type Page } from "@playwright/test";
import { eventBounds, stepBoundaries } from "../lib/playback";

// Sample hazard scenarios and step playback: 5% steps, stop at each step, rewind, jump to an event.
// Uses the real simulation server and the offline Director fixtures.

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Step playback is covered by the desktop project.");
});

async function openSample(page: Page, label: string, title: string) {
  await page.goto("/");
  await expect(page.getByText("stream connected")).toBeVisible();
  await page.getByRole("navigation", { name: "Sample scenarios" }).getByRole("button", { name: label, exact: true }).click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("stream connected")).toBeVisible();
}

test("a run is split into twenty 5% steps", () => {
  const steps = stepBoundaries({ startMinute: 100, endMinute: 300 });
  expect(steps).toHaveLength(21);
  expect(steps[1]).toBe(110);
  expect(steps.at(-1)).toBe(300);
  // Player runs tick in 60 beats; steps stay at 5%.
  const paced = stepBoundaries({ startMinute: 0, endMinute: 100 });
  expect(paced).toHaveLength(21);
  expect(paced[1]).toBe(5);
});

test("a Pacific run is framed across the Pacific, not around the world", () => {
  const at = (lat: number, lon: number) => ({ location: { lat, lon, name: "", country: "", country_code: "" } });
  const [[west], [east]] = eventBounds([at(-36, -73), at(19.7, -155), at(39, 142)])!;
  expect(east - west).toBeLessThan(180);
});

test("tsunami steps forward, stops at each step, rewinds and jumps to an event", async ({ page }) => {
  await openSample(page, "Tsunami", "M9.0 quake off Chile sends a tsunami across the Pacific");
  const playback = page.getByRole("region", { name: "Simulation playback" });
  const counter = playback.locator(".step-count");
  const clock = playback.locator(".timeline-meta > span");
  await expect(counter).toHaveText("Step 0 / 20 · 0%");

  const next = playback.getByRole("button", { name: "Next step" });
  for (let i = 1; i <= 3; i++) {
    await next.click();
    await expect(counter).toHaveText(`Step ${i} / 20 · ${i * 5}%`);
  }
  await playback.getByRole("button", { name: "Previous step" }).click();
  await expect(counter).toHaveText("Step 2 / 20 · 10%");

  await playback.getByLabel("Stop at each step").check();
  await playback.getByRole("button", { name: "Play", exact: true }).click();
  await expect(counter).toHaveText("Step 3 / 20 · 15%");
  await expect(playback.getByRole("button", { name: "Play", exact: true })).toBeVisible();
  await page.waitForTimeout(1500);
  await expect(counter).toHaveText("Step 3 / 20 · 15%", { timeout: 1 });

  await playback.getByLabel("Stop at each step").uncheck();
  await playback.getByRole("button", { name: "4×" }).click();
  await playback.getByRole("button", { name: "Play", exact: true }).click();
  await expect(counter).toHaveText("Step 20 / 20 · 100%", { timeout: 15_000 });
  const effects = page.getByRole("group", { name: "Map effects" });
  await expect(effects).toContainText("Tsunami warning · Hilo");
  await expect(effects).toContainText("Wave rings mark warned coasts");

  await playback.getByRole("group", { name: "Jump to event" }).getByRole("button").first().click();
  await expect(clock).toContainText("DAY 1 · 05:00 /");
  await expect(page.getByText("Tsunami warning · Hilo")).toHaveCount(0);
});

test("keyboard steps the run and the eruption sits on a real volcano", async ({ page }) => {
  await openSample(page, "Volcanic eruption", "Major VEI 5 eruption of Vesuvius, Italy");
  const counter = page.locator(".step-count");
  await page.locator("body").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("ArrowRight");
  await expect(counter).toHaveText("Step 1 / 20 · 5%");
  await page.keyboard.press(".");
  await expect(counter).toHaveText("Step 2 / 20 · 10%");
  await page.keyboard.press(",");
  await expect(counter).toHaveText("Step 1 / 20 · 5%");
  await expect(page.getByRole("group", { name: "Map effects" })).toContainText("Eruption · Vesuvius");
});
