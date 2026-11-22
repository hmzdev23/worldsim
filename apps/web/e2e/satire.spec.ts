import { expect, test } from "@playwright/test";

// Satire layer (local experiment): the tone selector swaps WORLD//WIRE to satirical
// copy, adds fictional reactions and a separate absurdity index, and follows the clock.

test("satirical tone adds labelled satire that follows playback", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.getByRole("button", { name: "Japan demo", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("stream connected");

  await page.getByRole("radio", { name: "Satirical" }).click();
  await expect(page.getByRole("radio", { name: "Satirical" })).toHaveAttribute("aria-checked", "true");
  const reactions = page.getByRole("region", { name: "Reactions" });
  const absurdity = page.getByRole("region", { name: "Absurdity index" });
  await expect(reactions).toContainText("No reactions yet");

  await page.getByRole("button", { name: "Play", exact: true }).click();
  const wire = page.getByRole("region", { name: "WORLD//WIRE" });
  const card = wire.getByRole("button").filter({ hasText: /tectonic|calendar/i }).first();
  await expect(card).toContainText("SATIRE · FICTIONAL");
  await expect(card).toContainText(/Original report: .*earthquake strikes/i);
  await expect(reactions.locator(".social-post").first()).toContainText("FICTIONAL");
  await expect(absurdity).toContainText("Committees established");
  // Impact estimates stay their own, unchanged section.
  await expect(page.getByRole("region", { name: "Impact estimates" })).toBeVisible();

  await page.getByRole("button", { name: "Reset playback" }).click();
  await expect(reactions).toContainText("No reactions yet");
  await expect(wire).toContainText("No reports yet");
  expect(errors).toEqual([]);
});

test("straight-faced tone keeps the original experience", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Japan demo", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("stream connected");
  await page.getByRole("radio", { name: "Straight-faced" }).click();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  const wire = page.getByRole("region", { name: "WORLD//WIRE" });
  await expect(wire.getByRole("button").filter({ hasText: /earthquake strikes/i })).toContainText("SIMULATED");
  await expect(page.getByRole("region", { name: "Reactions" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Absurdity index" })).toHaveCount(0);
});
