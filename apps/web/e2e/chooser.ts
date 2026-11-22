import { expect, type Page } from "@playwright/test";

/** The scenario chooser: open a scenario's default timeline, then pick "You decide" and a role. */
export async function chooseRole(page: Page, scenario: string, role: string) {
  const chooser = page.getByRole("region", { name: "Scenario chooser" });
  await chooser.getByRole("navigation", { name: "Sample scenarios" }).getByRole("button", { name: scenario, exact: true }).click();
  await expect(page.getByText("Scenario loaded")).toBeVisible({ timeout: 20_000 });
  await chooser.getByRole("radio", { name: "You decide" }).click();
  await chooser.getByRole("radiogroup", { name: "Your role" })
    .getByRole("radio", { name: new RegExp(`^${role}`) }).click();
  return chooser;
}
