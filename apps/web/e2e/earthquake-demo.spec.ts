import { expect, test } from "@playwright/test";
import fixture from "../../../contracts/fixtures/japan-earthquake.json";

// INT-001 browser check: Play reveals the simulated headline, and clicking it
// asks the map to focus the originating event.
const quake = fixture.events.find((event) => event.type === "earthquake")!;

test("earthquake headline appears on play and focuses the map", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/");
  await expect(page.getByRole("status")).toContainText("stream connected");
  const wire = page.getByRole("region", { name: "WORLD//WIRE" });
  await expect(wire).toContainText("No reports yet");
  await expect(page.locator(".maplibregl-canvas")).toBeVisible();

  await page.getByRole("button", { name: "Play", exact: true }).click();
  // The fixture is a multi-day chain and the wire lists newest first, so find the quake's card by headline.
  const card = wire.getByRole("button").filter({ hasText: /earthquake strikes/i });
  await expect(card).toContainText("SIMULATED");
  await expect(card).toContainText("DAY 1 · 06:42");
  await expect(card).toContainText(/earthquake strikes/i);

  const focus = page.evaluate(
    () => new Promise((resolve) => {
      window.addEventListener("worldsim:focus", (event) => resolve((event as CustomEvent).detail), { once: true });
    }),
  );
  await card.click();
  expect(await focus).toMatchObject({ event_id: quake.id, lat: quake.location.lat, lon: quake.location.lon });
  await expect(card).toHaveAttribute("aria-pressed", "true");

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow, "page should not scroll horizontally").toBe(false);
  expect(errors).toEqual([]);
});

test("wire only shows events the stream has applied", async ({ page }) => {
  const last = fixture.events[fixture.events.length - 1];
  await page.goto("/");
  await expect(page.getByRole("status")).toContainText("stream connected");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  const wire = page.getByRole("region", { name: "WORLD//WIRE" });
  await expect(wire.getByRole("button").filter({ hasText: /earthquake strikes/i })).toBeVisible();
  const cards = await wire.getByRole("button").count();
  expect(cards).toBeLessThan(fixture.events.length);
  await expect(wire).not.toContainText(`DAY ${Math.floor(last.sim_time_minutes / 1440) + 1} ·`);
});

test("reset hides the headline again", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("status")).toContainText("stream connected");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  const wire = page.getByRole("region", { name: "WORLD//WIRE" });
  await expect(wire.getByRole("button").first()).toBeVisible();
  await page.getByRole("button", { name: "Reset playback" }).click();
  await expect(wire).toContainText("No reports yet");
});

test("hovering a country identifies it on the map", async ({ page }, testInfo) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Zoom in" })).toBeEnabled();
  const map = page.locator(".map-canvas");
  const bounds = await map.boundingBox();
  if (!bounds) throw new Error("map canvas is missing");

  const target = testInfo.project.name === "mobile"
    ? { x: 0.28, y: 0.33, country: "Canada" }
    : { x: 0.25, y: 0.43, country: "United States of America" };
  await page.mouse.move(bounds.x + bounds.width * target.x, bounds.y + bounds.height * target.y);
  await expect(page.locator(".map-caption span")).toHaveText(target.country);
});
