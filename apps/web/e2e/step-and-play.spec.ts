import { expect, test, type Page } from "@playwright/test";

// Story runs: Play moves through the headlines on its own (each shows for a
// reading time); Pause stops on the current event; Next/Previous event step.
// Uses an offline starter, so no model is called.

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Covered by the desktop project.");
});

async function startTsunami(page: Page) {
  await page.goto("/");
  await page.getByRole("group", { name: "Starter scenarios" }).getByRole("button", { name: /Tsunami/ }).click();
  await page.getByRole("region", { name: "Run Tsunami" }).getByRole("button", { name: "Simulate" }).click();
  const playback = page.getByRole("region", { name: "Simulation playback" });
  await expect(playback.getByRole("button", { name: "Pause", exact: true })).toBeVisible({ timeout: 20_000 });
  return playback;
}

const headline = (page: Page) => page.locator(".headline-alert");

test("Play moves through the headlines on its own; Pause stops on one", async ({ page }) => {
  const playback = await startTsunami(page);
  await expect(headline(page)).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".headline-alert-timer")).toBeVisible();
  const first = await headline(page).getAttribute("data-event-id");
  await expect.poll(() => headline(page).getAttribute("data-event-id"), { timeout: 20_000 }).not.toBe(first);

  await playback.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(playback.getByRole("button", { name: "Play", exact: true })).toBeVisible();
  await expect(page.locator(".headline-alert-timer")).toHaveCount(0);
  const paused = await headline(page).getAttribute("data-event-id");
  await page.waitForTimeout(8000);
  expect(await headline(page).getAttribute("data-event-id")).toBe(paused);
});

test("Next and Previous event step one event at a time", async ({ page }) => {
  const playback = await startTsunami(page);
  await expect(headline(page)).toBeVisible({ timeout: 20_000 });
  await playback.getByRole("button", { name: "Pause", exact: true }).click();
  const ids: string[] = [(await headline(page).getAttribute("data-event-id"))!];

  for (let i = 0; i < 2; i++) {
    await playback.getByRole("button", { name: "Next event" }).click();
    await expect.poll(() => headline(page).getAttribute("data-event-id"), { timeout: 20_000 }).not.toBe(ids.at(-1));
    ids.push((await headline(page).getAttribute("data-event-id"))!);
  }
  await page.waitForTimeout(3000);
  expect(await headline(page).getAttribute("data-event-id")).toBe(ids.at(-1));  // stepping waits

  await playback.getByRole("button", { name: "Previous event" }).click();
  await expect.poll(() => headline(page).getAttribute("data-event-id"), { timeout: 20_000 }).toBe(ids[1]);
  await expect(playback.getByRole("button", { name: "Play", exact: true })).toBeVisible();
});
