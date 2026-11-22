import { expect, test } from "@playwright/test";

// Satire is switched off for now: no tone choice, and every run is straight-faced.

test("there is no tone choice, even if satire was remembered from an earlier visit", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("worldsim:tone", "satirical"));
  await page.goto("/");
  await expect(page.getByLabel("Scenario prompt")).toBeVisible();
  await expect(page.getByRole("radio", { name: /Satirical|Straight-faced|Unhinged/ })).toHaveCount(0);
  await expect(page.getByText("Tone", { exact: true })).toHaveCount(0);
  await expect(page.locator(".masthead")).not.toContainText("satire");
});

test("runs keep the straight-faced experience", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => window.localStorage.setItem("worldsim:tone", "satirical"));
  await page.goto("/?demo=japan");
  await expect(page.getByRole("status")).toContainText("stream connected");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  const wire = page.getByRole("region", { name: "WORLD//WIRE" });
  await expect(wire.getByRole("button").filter({ hasText: /earthquake strikes/i })).toBeVisible();
  await expect(wire).not.toContainText("SATIRE");
  await expect(page.getByRole("region", { name: "Reactions" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Absurdity index" })).toHaveCount(0);
  expect(errors).toEqual([]);
});
