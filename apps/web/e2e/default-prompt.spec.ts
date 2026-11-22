import { expect, test, type Page } from "@playwright/test";

// Pressing Enter in an empty prompt box runs the example shown in it.
// The scenario service is mocked, so no model is called.

const EXAMPLE = "What if a volcanic eruption closed Iceland’s main airport for two days?";

async function capturePrompts(page: Page) {
  const prompts: string[] = [];
  await page.route(/\/api\/simulation\/scenarios$/, (route) => {
    if (route.request().method() === "POST") prompts.push(JSON.parse(route.request().postData() ?? "{}").prompt);
    return route.fulfill({ status: 503, json: { error: "unavailable" } });
  });
  return prompts;
}

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Covered by the desktop project.");
});

test("Enter in an empty box runs the example prompt", async ({ page }) => {
  const prompts = await capturePrompts(page);
  await page.goto("/");
  const box = page.getByLabel("Scenario prompt");
  await expect(box).toHaveAttribute("placeholder", EXAMPLE);
  await expect(page.getByRole("button", { name: "Simulate", exact: true })).toBeEnabled();
  await box.focus();
  await page.keyboard.press("Enter");
  await expect.poll(() => prompts).toEqual([EXAMPLE]);
});

test("Enter runs a typed prompt and Shift+Enter adds a line", async ({ page }) => {
  const prompts = await capturePrompts(page);
  await page.goto("/");
  const box = page.getByLabel("Scenario prompt");
  await box.fill("A blizzard closes Oslo");
  await box.press("Shift+Enter");
  await box.pressSequentially("for a week");
  await expect(box).toHaveValue("A blizzard closes Oslo\nfor a week");
  expect(prompts).toEqual([]);
  await box.press("Enter");
  await expect.poll(() => prompts).toEqual(["A blizzard closes Oslo\nfor a week"]);
});
