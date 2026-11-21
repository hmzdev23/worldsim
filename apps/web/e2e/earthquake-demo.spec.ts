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
  const card = wire.getByRole("button").first();
  await expect(card).toContainText("SIMULATED");
  await expect(card).toContainText("DAY 1 · 06:42 SIM TIME");
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
    ? { x: 0.28, country: "Canada" }
    : { x: 0.08, country: "United States of America" };
  await page.mouse.move(bounds.x + bounds.width * target.x, bounds.y + bounds.height * 0.15);
  await expect(page.locator(".map-caption span")).toHaveText(target.country);
});
