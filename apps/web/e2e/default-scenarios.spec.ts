import { expect, test } from "@playwright/test";

test("nuclear defaults and variations use the selected countries", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Start playing", exact: true }).click();
  const setup = page.getByRole("region", { name: "Game setup" });
  await setup.getByRole("button", { name: /Nuclear War/ }).click();
  const watch = setup.getByRole("region", { name: "Watch this scenario" });
  const start = watch.getByRole("button", { name: "Watch default simulation" });
  await expect(start).toBeDisabled();
  await watch.getByLabel("First country").selectOption({ label: "Canada" });
  await watch.getByLabel("Second country").selectOption({ label: "Canada" });
  await expect(start).toBeDisabled();
  await watch.getByLabel("Second country").selectOption({ label: "France" });
  const requests: Record<string, unknown>[] = [];
  await page.route("**/api/simulation/scenarios", async route => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({ status: 503, json: { detail: "Try again" } });
  });
  await start.click();
  await expect(setup.getByRole("alert")).toBeVisible();
  expect(requests[0].prompt).toContain("Canada and France");
  expect(requests[0].fixture).toBeUndefined();
  await watch.getByLabel("Make a variation").check();
  await expect(watch.getByRole("button", { name: "Watch variation" })).toBeDisabled();
  await watch.getByLabel("Change one detail").fill("A ceasefire is negotiated early");
  await watch.getByLabel(/Change another detail/).fill("Relief arrives sooner");
  await watch.getByRole("button", { name: "Watch variation" }).click();
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[1].prompt).toContain("Canada and France");
  expect(requests[1].prompt).toContain("A ceasefire is negotiated early; Relief arrives sooner");
  expect(requests[1].fixture).toBeUndefined();
});

test("other default scenarios use their offline fixture", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Start playing", exact: true }).click();
  await page.getByRole("region", { name: "Game setup" }).getByRole("button", { name: /Tsunami/ }).click();
  const request = page.waitForRequest(r => r.url().endsWith("/api/simulation/scenarios") && r.method() === "POST");
  await page.getByRole("button", { name: "Watch default simulation" }).click();
  expect((await request).postDataJSON().fixture).toBe("tsunami");
  const playback = page.getByRole("region", { name: "Simulation playback" });
  await expect(playback).toBeVisible();
  await expect(playback.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
  await expect(playback.getByLabel("Playback pacing")).toContainText("0.5% of the scenario per second");
});
