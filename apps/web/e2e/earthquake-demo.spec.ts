import { expect, test } from "@playwright/test";
import fixture from "../../../contracts/fixtures/japan-earthquake.json";

// INT-001 browser check: Play reveals the simulated headline, and clicking it
// asks the map to focus the originating event.
const quake = fixture.events.find((event) => event.type === "earthquake")!;

test("earthquake headline appears on play and focuses the map", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/");
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
  await page.getByRole("button", { name: "Play", exact: true }).click();
  const wire = page.getByRole("region", { name: "WORLD//WIRE" });
  await expect(wire.getByRole("button").first()).toBeVisible();
  await page.getByRole("button", { name: "Reset playback" }).click();
  await expect(wire).toContainText("No reports yet");
});
