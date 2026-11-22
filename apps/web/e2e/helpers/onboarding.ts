import { expect, type Page } from "@playwright/test";

export async function briefMission(page: Page, scenario: string, role: string) {
  await page.getByRole("button", { name: "Start playing", exact: true }).click();
  const setup = page.getByRole("region", { name: "Game setup" });
  await setup.getByRole("button", { name: new RegExp(scenario) }).click();
  await setup.getByRole("button", { name: "Choose your role", exact: true }).click();
  await setup.getByRole("button", { name: new RegExp(role) }).click();
  await setup.getByRole("button", { name: "See mission briefing" }).click();
  await expect(setup.getByRole("region", { name: "Mission briefing" })).toBeVisible();
}
