import { expect, test } from "@playwright/test";
import { briefMission } from "./helpers/onboarding";

test.use({reducedMotion:"reduce"});
test("one question at a time, backtracking and one-click game start", async ({page},info)=>{
  await page.setViewportSize({width:info.project.name === "mobile" ? 390 : 1440,height:950});
  await page.goto("/");
  await expect(page.getByRole("heading",{name:"One crisis. Your decisions."})).toBeVisible();
  await expect(page.getByRole("region",{name:"Simulation playback"})).toHaveCount(0);
  await expect(page.getByLabel("Scenario prompt")).toHaveCount(0);
  await page.screenshot({path:info.outputPath("welcome.png"),fullPage:true});
  await page.getByRole("button",{name:"Start playing",exact:true}).click();
  const setup=page.getByRole("region",{name:"Game setup"});
  await expect(setup.getByRole("heading",{name:"Choose your crisis."})).toBeFocused();
  await expect(setup.getByRole("button",{name:"Choose your role",exact:true})).toBeDisabled();
  await expect(setup.locator(".setup-scenario")).toHaveCount(10);
  await expect(setup.getByRole("group",{name:"Playable roles"})).toHaveCount(0);
  await setup.getByRole("button",{name:/Alien Invasion/}).click();
  await page.screenshot({path:info.outputPath("scenarios.png"),fullPage:true});
  await setup.getByRole("button",{name:"Choose your role",exact:true}).click();
  await expect(setup.getByRole("heading",{name:"Who will you be?"})).toBeFocused();
  await expect(setup.getByRole("button",{name:"See mission briefing"})).toBeDisabled();
  await setup.getByRole("button",{name:/International diplomat/}).click();
  await page.screenshot({path:info.outputPath("roles.png"),fullPage:true});
  await setup.getByRole("button",{name:"See mission briefing"}).click();
  await expect(setup.getByRole("region",{name:"Mission briefing"})).toContainText("international diplomat");
  await setup.getByRole("button",{name:"Back",exact:true}).click();
  await expect(setup.getByRole("button",{name:/International diplomat/})).toHaveAttribute("aria-pressed","true");
  await setup.getByRole("button",{name:"Back",exact:true}).click();
  await setup.getByRole("button",{name:/Tsunami/}).click();
  await setup.getByRole("button",{name:"Choose your role",exact:true}).click();
  await expect(setup.getByRole("button",{name:"See mission briefing"})).toBeDisabled();
  await setup.getByRole("button",{name:/City mayor/}).click();
  await setup.getByRole("button",{name:"See mission briefing"}).click();
  await page.screenshot({path:info.outputPath("briefing.png"),fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await setup.getByRole("button",{name:"Begin simulation"}).click();
  const playback=page.getByRole("region",{name:"Simulation playback"});
  await expect(playback.getByRole("button",{name:"Pause",exact:true})).toBeVisible();
  await expect(setup).toHaveCount(0);
  await expect(page.getByLabel("Scenario prompt")).toHaveCount(0);
  await expect(page.getByRole("region",{name:"Your mission"})).toContainText("City mayor");
  await page.screenshot({path:info.outputPath("game.png"),fullPage:true});
  await page.getByRole("button",{name:"New game",exact:true}).click();
  await expect(page.getByRole("heading",{name:"Choose your crisis."})).toBeVisible();
});

test("quick demo opens a clear briefing and recovers from preparation failure",async({page})=>{
  await page.goto("/");
  await page.getByRole("button",{name:/Quick demo: first contact/}).click();
  await expect(page.getByRole("region",{name:"Mission briefing"})).toContainText("international diplomat");
  let reject=true;
  await page.route(/\/api\/simulation\/scenarios$/,route=> reject ? (reject=false,route.fulfill({status:503,json:{detail:"Please try again."}})) : route.continue());
  await page.getByRole("button",{name:"Begin simulation"}).click();
  await expect(page.getByRole("region",{name:"Game setup"}).getByRole("alert")).toContainText("Try again");
  await expect(page.getByRole("region",{name:"Mission briefing"})).toBeVisible();
  await page.getByRole("button",{name:"Begin simulation"}).click();
  await expect(page.getByRole("region",{name:"Simulation playback"}).getByRole("button",{name:"Pause",exact:true})).toBeVisible();
});


test("setup can be completed with the keyboard", async ({page})=>{
  await page.goto("/");
  await page.getByRole("button",{name:"Start playing",exact:true}).focus();
  await page.keyboard.press("Enter");
  const setup=page.getByRole("region",{name:"Game setup"});
  await setup.getByRole("button",{name:/Alien Invasion/}).focus();
  await page.keyboard.press("Space");
  await setup.getByRole("button",{name:"Choose your role",exact:true}).focus();
  await page.keyboard.press("Enter");
  await setup.getByRole("button",{name:/Scientific research director/}).focus();
  await page.keyboard.press("Space");
  await setup.getByRole("button",{name:"See mission briefing"}).focus();
  await page.keyboard.press("Enter");
  await expect(setup.getByRole("heading",{name:"Your mission starts here."})).toBeFocused();
  await expect(setup.getByRole("region",{name:"Mission briefing"})).toContainText("scientific research director");
});
