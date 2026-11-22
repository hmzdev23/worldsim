import { expect, test } from "@playwright/test";
import { briefMission } from "./helpers/onboarding";

// Player mode (prototype): the real scenario service plays the offline pandemic
// fixture as the regional health minister. One skip ("Do nothing") and two
// decisions, then the end summary, then a confirmed seek back that voids them.
// Both viewport projects use the real offline simulation server (no model credentials).

test.use({ reducedMotion: "reduce" });

test("pandemic as health minister: skip, two decisions, score and summary", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  if (testInfo.project.name == "desktop") await page.setViewportSize({ width: 1440, height: 1000 });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await briefMission(page, "Global Pandemic", "Regional health minister");
  await page.getByRole("button", {name: "Begin simulation"}).click();
  await expect(page.getByRole("heading", {name: "Novel virus outbreak · Regional health minister"})).toBeVisible();
  await page.getByText("Pace settings", {exact:true}).click();
  await page.getByRole("button", { name: "Fast", exact: true }).click();
  const playback = page.getByRole("region", {name: "Simulation playback"});

  // Card 1: the outbreak reaches a new country. Check the card, then skip it.
  const card = page.getByRole("dialog");
  await expect(card).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".inspector .decision-card")).toBeVisible();
  await expect(page.locator(".map-panel .decision-card")).toHaveCount(0);
  await expect(card.getByRole("heading")).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath("decision.png"), fullPage: true });
  await expect(card).toContainText("A new country is affected");
  await expect(card).toContainText("So far");
  await expect(card.getByRole("list", { name: "Your options" }).getByRole("button")).toHaveCount(4);
  await expect(card.getByRole("button", { name: /Decide later \(2 left/ })).toBeEnabled();
  await card.getByText("Write your own decision").click();
  await expect(card).toContainText("Not simulated offline");
  await expect(playback.getByRole("button", { name: "Play", exact: true })).toBeDisabled();
  await card.getByRole("button", { name: /^Do nothing/ }).click();

  // Card 2: hospitals under strain. Decide.
  await expect(card).toContainText("A severe event", { timeout: 20_000 });
  await card.getByRole("button", { name: /Open surge hospital capacity/ }).click();

  // Card 3: unrest in a new country. Decide.
  await expect(card).toContainText("A new country is affected", { timeout: 20_000 });
  await card.getByRole("button", { name: /Give a public briefing/ }).click();

  // The decision is a story on WORLD//WIRE, and the run ends with a summary.
  const wire = page.getByRole("region", { name: "WORLD//WIRE" });
  await expect(wire).toContainText("Regional health minister decides: open surge hospital capacity", { timeout: 20_000 });
  const summary = page.getByRole("region", { name: /^Score / });
  await expect(summary).toBeVisible({ timeout: 30_000 });
  const scores = summary.getByRole("table", { name: "Score components" });
  await expect(scores.getByRole("rowheader")).toHaveText(["Outcome", "Timeliness", "Balance"]);
  await expect(summary.locator(".decision-timeline > li")).toHaveCount(3);
  await expect(summary.locator(".decision-timeline")).toContainText("Did nothing");
  await expect(summary.locator(".decision-timeline")).toContainText("Open surge hospital capacity");
  await expect(summary.getByRole("table", { name: "Compared with doing nothing" })).toBeVisible();
  await expect(summary).toContainText("fictional");
  await expect(summary.getByRole("button", { name: "Try again" })).toBeVisible();
  await expect(summary.getByRole("button", { name: "Branch from this decision" })).toHaveCount(3);

  await summary.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("summary.png"), fullPage: true });
  await page.getByRole("button", { name: "See what your decisions changed" }).click();
  const comparison = page.getByRole("region", { name: "What your decisions changed" });
  await expect(comparison.getByRole("table", { name: "Outcome measures at the end of each timeline" })).toBeVisible();
  const rows = comparison.getByRole("list", { name: "Event by event: timeline A and timeline B" }).locator(":scope > li");
  expect(await rows.count()).toBeGreaterThan(3);
  await comparison.locator(".alt-decision-list button").nth(1).click();
  await expect(comparison.locator(".alt-decision-list button").nth(1)).toHaveAttribute("aria-pressed", "true");
  const allRows = await rows.count();
  await comparison.getByRole("checkbox").check();
  expect(await rows.count()).toBeLessThan(allRows);
  await expect(comparison.getByRole("button", { name: "Branch from this decision" })).toBeVisible();
  await comparison.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("comparison.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await comparison.getByRole("button", { name: "Back to the map" }).first().click();
  await expect(comparison).toHaveCount(0);
  expect(errors).toEqual([]);
  if (testInfo.project.name === "mobile") {
    await summary.getByRole("button", { name: "Try again", exact: true }).click();
    await expect(summary).toHaveCount(0);
    await expect(playback.getByRole("button", { name: "Pause", exact: true })).toBeEnabled();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    return;
  }

  // Seeking back asks first, then voids the later decisions.
  page.once("dialog", (dialog) => {
    expect(dialog.message()).toContain("voids 3 later decisions");
    void dialog.accept();
  });
  await playback.getByRole("button", { name: "Reset playback" }).click();
  await expect(summary).toHaveCount(0, { timeout: 10_000 });
  await expect(wire).not.toContainText("decides:");
});
