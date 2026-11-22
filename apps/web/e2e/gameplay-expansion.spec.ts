import { expect, test } from "@playwright/test";
import fixture from "../../../contracts/fixtures/japan-earthquake.json";
import { japanDemo } from "../lib/earthquake";
import { chooseRole } from "./chooser";

test.use({ reducedMotion: "reduce" });
test.beforeEach(({}, info) => test.skip(info.project.name !== "desktop", "Explicit desktop, tablet and mobile widths in this suite."));

for (const sample of [
  { fixture: "global-pandemic", scenario: "Pandemic", role: "Hospital director", title: "Novel virus outbreak", width: 1440 },
  { fixture: "alien-invasion", scenario: "Alien invasion", role: "International diplomat", title: "Alien Invasion", width: 768 },
  { fixture: "tsunami", scenario: "Tsunami", role: "City mayor", title: "Tsunami", width: 390 },
]) {
  test(`${sample.title}: full gameplay at ${sample.width}px`, async ({ page }, info) => {
    test.setTimeout(120_000);
    await page.setViewportSize({width: sample.width, height: 1000});
    const errors: string[] = [];
    page.on("pageerror", e => errors.push(e.message));
    await page.goto("/");
    const library = page.getByRole("region", {name: "Scenario chooser"});
    await expect(library.locator(".sample-button")).toHaveCount(10);
    await chooseRole(page, sample.scenario, sample.role);
    await expect(library.getByRole("region", {name: "Mission briefing"})).toContainText("Your mission");
    await page.screenshot({path: info.outputPath("library.png"), fullPage:true});
    const created = page.waitForResponse(r => r.request().method() === "POST" && new URL(r.url()).pathname.endsWith("/scenarios"));
    await library.getByRole("button", {name: "Start with my decisions"}).click();
    const runId = (await (await created).json()).id;
    await page.evaluate(() => {
      const seen: {id: string; minute: number}[] = [];
      (window as unknown as {stories: typeof seen}).stories = seen;
      const record = () => {
        const card = document.querySelector<HTMLElement>(".headline-alert");
        const id = card?.dataset.eventId;
        if(id && !seen.some(s => s.id === id)) seen.push({id,minute:Number(card?.dataset.minute)});
      };
      new MutationObserver(record).observe(document.body,{subtree:true,childList:true,attributes:true}); record();
    });
    const controls=page.getByRole("region", {name:"Story presentation"});
    await expect(controls.getByRole("button",{name:"Normal",exact:true})).toHaveAttribute("aria-pressed","true");
    await controls.getByRole("button",{name:"Hold to read"}).click();
    await expect(controls.getByRole("button",{name:"Continue presentation"})).toHaveAttribute("aria-pressed","true");
    await controls.getByRole("button",{name:"Continue presentation"}).click();
    await controls.getByRole("button",{name:"Cinematic",exact:true}).click();
    await expect(controls.getByRole("button",{name:"Cinematic",exact:true})).toHaveAttribute("aria-pressed","true");
    await controls.getByRole("button",{name:"Fast",exact:true}).click();
    await controls.getByRole("button",{name:"Auto-follow: on"}).click();
    await expect(controls.getByRole("button",{name:"Auto-follow: off"})).toBeVisible();
    await controls.getByRole("button",{name:"Auto-follow: off"}).click();
    const map=page.getByRole("region",{name:"Interactive world map"});
    await expect(map.getByRole("button",{name:"Zoom in"})).toBeEnabled();
    await map.getByRole("button",{name:"Zoom in"}).click();
    await expect(controls.getByRole("button",{name:"Auto-follow: suspended"})).toBeVisible();
    await controls.getByRole("button",{name:"Auto-follow: suspended"}).click();
    const playback=page.getByRole("region",{name:"Simulation playback"});
    await playback.getByRole("button",{name:"4×"}).click();
    await playback.getByRole("button",{name:"Play",exact:true}).click();
    const card=page.getByRole("dialog");
    let count=0;
    for (;;) {
      await expect.poll(async()=>await card.count() > 0 || await page.locator(".player-summary").count() > 0, {timeout:35_000}).toBe(true);
      if (await page.locator(".player-summary").count()) break;
      count++;
      expect(count).toBeLessThan(20);
      await expect(card.getByRole("heading")).toBeFocused();
      await expect(card.getByRole("list",{name:"Your options"}).getByRole("button")).toHaveCount(4);
      await expect(map.locator(".headline-alert")).toHaveCount(0);
      if(count===1) {
        await page.screenshot({path:info.outputPath("decision.png"),fullPage:true});
        const current=await card.getByRole("heading").innerText();
        await page.waitForTimeout(700);
        await expect(card.getByRole("heading")).toHaveText(current);
      }
      await card.getByRole("list",{name:"Your options"}).getByRole("button").nth((count-1)%3).click();
      await expect(card).toHaveCount(0);
    }
    expect(count).toBeGreaterThanOrEqual(3);
    await expect(page.getByRole("region",{name:"Current crisis phase"})).toBeVisible();
    await page.getByRole("button",{name:"See what your decisions changed"}).click();
    const comparison=page.getByRole("region",{name:"What your decisions changed"});
    await expect(comparison.getByRole("table")).toBeVisible();
    await expect(comparison).toContainText("Identical");
    const wire=page.getByRole("region",{name:"WORLD//WIRE"});
    expect(await wire.locator(".wire-card").count()).toBeGreaterThan(8);
    const reports = (await (await page.request.get(`/api/simulation/scenarios/${runId}/news`)).json()).items;
    expect(await wire.locator(".wire-card").count()).toBe(reports.length);
    const presented = await page.evaluate(() => (window as unknown as {stories: {id:string;minute:number}[]}).stories);
    expect(presented.map(s=>s.id).sort()).toEqual(reports.map((r:{event_id:string})=>r.event_id).sort());
    expect(presented.map(s=>s.minute)).toEqual(presented.map(s=>s.minute).sort((a,b)=>a-b));
    const firstStory=wire.locator(".wire-card").first();
    await firstStory.click(); await expect(firstStory).toHaveAttribute("aria-pressed","true");
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await comparison.scrollIntoViewIfNeeded();
    await page.screenshot({path:info.outputPath("results.png"),fullPage:true});
    expect(errors).toEqual([]);
    await page.getByRole("button",{name:"Try a different role"}).click();
    await expect(library.getByRole("radio", {name: "You decide"})).toHaveAttribute("aria-checked", "true");
    await expect(library.getByRole("radiogroup", {name: "Your role"}).getByRole("radio", {name: new RegExp(`^${sample.role}`)}))
      .toHaveAttribute("aria-checked", "true");
  });
}


test("normal story cadence holds the deterministic clock and permits reading / skipping", async ({page}) => {
  await page.goto("/");
  const library=await chooseRole(page, "Alien invasion", "International diplomat");
  await library.getByRole("button",{name:"Start with my decisions"}).click();
  await expect(page.getByRole("region",{name:"Story presentation"})).toBeVisible();
  const playback=page.getByRole("region",{name:"Simulation playback"});
  const position=playback.getByRole("slider");
  const initial=await position.inputValue();
  await playback.getByRole("button",{name:"Play",exact:true}).click();
  await expect.poll(()=>position.inputValue()).not.toBe(initial);
  const firstBeat=await position.inputValue();
  await page.waitForTimeout(1300);
  await expect(position).toHaveValue(firstBeat);
  const controls=page.getByRole("region",{name:"Story presentation"});
  await controls.getByRole("button",{name:"Hold to read"}).click();
  await page.waitForTimeout(4500);
  await expect(position).toHaveValue(firstBeat);
  await expect(page.locator(".headline-alert")).toHaveCount(1);
  await controls.getByRole("button",{name:"Advance story"}).click();
  await controls.getByRole("button",{name:"Continue presentation"}).click();
  await expect.poll(()=>position.inputValue()).not.toBe(firstBeat);
  await playback.getByRole("button",{name:"Pause",exact:true}).click();
  await page.waitForTimeout(500);
  const paused=await position.inputValue();
  await page.waitForTimeout(1200);
  await expect(position).toHaveValue(paused);
});


test("a report without grounded geography stays in history without crashing the map", async ({page}) => {
  const errors:string[]=[]; page.on("pageerror",e=>errors.push(e.message));
  await page.routeWebSocket(/\/stream$/, socket => {
    const identity={schema_version:"0.1",simulation_id:japanDemo.simulation_id,branch_id:japanDemo.branch_id};
    const snapshot=()=>socket.send(JSON.stringify({...identity,kind:"snapshot",sim_time_minutes:japanDemo.startMinute,playback:{state:"paused",speed:1},events:[]}));
    snapshot();
    socket.onMessage(message=>{
      const control=JSON.parse(String(message));
      if(control.action==="seek")snapshot();
      if(control.action==="play") {
        socket.send(JSON.stringify({...identity,kind:"event",event:{...fixture.events[0],id:"evt-unlocated",type:"other_hazard",location:undefined,payload:{label:"Unlocated report",description:"Simulated report has no grounded geographic location."}}}));
        socket.send(JSON.stringify({...identity,kind:"event",event:fixture.events[0]}));
      }
    });
  });
  await page.goto("/");
  await expect(page.getByRole("status")).toContainText("stream connected");
  await page.getByRole("button",{name:"Play",exact:true}).click();
  await expect(page.getByRole("region",{name:"WORLD//WIRE"})).toContainText("Unlocated report");
  await expect(page.locator(".epicenter-marker")).toHaveCount(1);
  expect(errors).toEqual([]);
});
