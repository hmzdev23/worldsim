import { expect, test } from "@playwright/test";

test("headlines wait for Continue and Previous revisits the prior event", async ({ page }) => {
  // Playback does not need a paid film render.
  await page.route("**/api/recap-films/**", route => route.fulfill({ json: { status: "queued" } }));
  await page.goto("/");
  await page.getByRole("group", { name: "Starter scenarios" }).getByRole("button", { name: /Tsunami/ }).click();
  await page.getByRole("region", { name: "Run Tsunami" }).getByRole("button", { name: "Simulate" }).click();
  const card = page.locator(".headline-alert");
  await expect(card).toBeVisible({ timeout: 20000 });
  const first = await card.getAttribute("data-event-id");
  const position = page.getByLabel("Simulation timeline", { exact: true });
  const minute = await position.inputValue();
  await page.waitForTimeout(7000);
  await expect(card).toHaveAttribute("data-event-id", first!);
  await expect(position).toHaveValue(minute);
  await card.getByRole("button", { name: /Continue simulation|Next headline/ }).click();
  await expect.poll(() => card.getAttribute("data-event-id")).not.toBe(first);
  await expect(card).toBeVisible();
  await expect(page.locator(".wire-headline").first()).toBeVisible();
  for (const title of await page.locator(".wire-headline").allTextContents()) {
    expect(title.trim().split(/\s+/).length).toBeLessThanOrEqual(5);
  }
  await page.getByRole("button", { name: "Previous event" }).click();
  await expect(card).toHaveAttribute("data-event-id", first!);
});
