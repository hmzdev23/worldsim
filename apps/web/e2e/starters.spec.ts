import { expect, test, type Page } from "@playwright/test";

// The home screen: a free prompt or a starter scenario, then watch it play out.
// There is no role, briefing or decision; every run gets a new seed from the server.

async function captureRequests(page: Page) {
  const requests: Record<string, unknown>[] = [];
  await page.route("**/api/simulation/scenarios", async (route) => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({ status: 503, json: { detail: "Try again" } });
  });
  return requests;
}

test("the home screen offers a prompt and starters, never a game", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "What if…?" })).toBeVisible();
  await expect(page.getByLabel("Scenario prompt")).toBeVisible();
  const starters = page.getByRole("group", { name: "Starter scenarios" });
  await expect(starters.getByRole("button")).toHaveCount(10);
  await expect(page.locator("body")).not.toContainText(/your role|mission|decision|score|start playing/i);
});

test("a starter runs from its offline fixture and plays straight away", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("group", { name: "Starter scenarios" }).getByRole("button", { name: /Tsunami/ }).click();
  const request = page.waitForRequest((r) => r.url().endsWith("/api/simulation/scenarios") && r.method() === "POST");
  await page.getByRole("region", { name: "Run Tsunami" }).getByRole("button", { name: "Simulate" }).click();
  const body = (await request).postDataJSON();
  expect(body.fixture).toBe("tsunami");
  expect(body.seed).toBeUndefined();
  const bar = page.getByRole("region", { name: "Current run" });
  await expect(bar).toContainText(/Seed \d+/);
  await expect(bar.getByRole("button", { name: "Run again (new seed)" })).toBeVisible();
  const playback = page.getByRole("region", { name: "Simulation playback" });
  await expect(playback.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
});

test("run again starts a new run of the same situation with a different seed", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("group", { name: "Starter scenarios" }).getByRole("button", { name: /Volcanic Eruption/ }).click();
  await page.getByRole("region", { name: "Run Volcanic Eruption" }).getByRole("button", { name: "Simulate" }).click();
  const bar = page.getByRole("region", { name: "Current run" });
  await expect(bar).toContainText(/Seed \d+/);
  const first = await bar.locator("span").first().textContent();
  const request = page.waitForRequest((r) => r.url().endsWith("/api/simulation/scenarios") && r.method() === "POST");
  await bar.getByRole("button", { name: "Run again (new seed)" }).click();
  expect((await request).postDataJSON().fixture).toBe("iceland-eruption");
  await expect.poll(() => bar.locator("span").first().textContent()).not.toBe(first);
});

test("changed starting conditions and nuclear countries generate a new scenario", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("group", { name: "Starter scenarios" }).getByRole("button", { name: /Nuclear War/ }).click();
  const panel = page.getByRole("region", { name: "Run Nuclear War" });
  const requests = await captureRequests(page);
  await panel.getByLabel(/First country/).selectOption({ label: "Canada" });
  await panel.getByLabel(/Second country/).selectOption({ label: "Canada" });
  await expect(panel.getByRole("button", { name: "Simulate" })).toBeDisabled();
  await panel.getByLabel(/Second country/).selectOption({ label: "France" });
  await panel.getByText("Change the starting conditions").click();
  await panel.getByLabel("Change one detail").fill("A ceasefire is negotiated early");
  await panel.getByRole("button", { name: "Simulate" }).click();
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0].prompt).toContain("Canada and France");
  expect(requests[0].prompt).toContain("Starting conditions: A ceasefire is negotiated early.");
  expect(requests[0].fixture).toBeUndefined();
});
