import { expect, test } from "@playwright/test";
import fixture from "../../../contracts/fixtures/japan-earthquake.json";
import feed from "../../../services/newsroom/feeds/japan-earthquake.json";

const [quake, tsunami, evacuation] = fixture.events;
const [firstReport, secondReport, thirdReport] = [quake, tsunami, evacuation].map(
  (event) => feed.find((report) => report.event_id === event.id)!,
);

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Headline alerts use the desktop project.");
});

test("live headlines stay in order while playback and the wire advance", async ({ page }) => {
  await page.goto("/");
  await page.goto("/?demo=japan");
  const map = page.getByRole("region", { name: "Interactive world map" });
  const alert = map.locator(".headline-alert");
  const headline = alert.getByRole("heading");
  const wire = page.getByRole("region", { name: "Reports" });
  const playback = page.getByRole("region", { name: "Simulation playback" });
  await expect(map.getByRole("button", { name: "Zoom in" })).toBeEnabled();
  await expect(wire).toContainText("No reports yet");
  await expect(alert).toHaveCount(0);

  await playback.getByRole("button", { name: "4×" }).click();
  await playback.getByRole("button", { name: "Play", exact: true }).click();
  await expect(headline).toHaveText(firstReport.headline);
  await expect(alert).toContainText(firstReport.dek);
  await expect(alert).toContainText(firstReport.sim_time_label);
  await expect(alert).toContainText("earthquake");
  await expect(alert).toContainText("Severity 90%");
  await expect(alert).toContainText("SIMULATED");

  const clock = playback.locator(".timeline-meta > span");
  const timeWithAlert = await clock.textContent();
  await expect(clock).not.toHaveText(timeWithAlert!);
  await expect(playback.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
  await expect(wire.getByText(thirdReport.headline, { exact: true })).toBeVisible();
  await expect(headline).toHaveText(firstReport.headline);
  await expect(alert.getByText(/\d+ queued/)).toBeVisible();

  const next = alert.getByRole("button", { name: "Next headline" });
  await next.click();
  await expect(headline).toHaveText(secondReport.headline);
  await expect(alert).toContainText("tsunami warning");
  await expect(alert).toContainText(secondReport.sim_time_label);

  const focus = page.evaluate(() => new Promise((resolve) => {
    window.addEventListener("worldsim:focus", (event) => resolve((event as CustomEvent).detail), { once: true });
  }));
  await alert.getByRole("button", { name: "Focus map" }).click();
  expect(await focus).toEqual(secondReport.focus);
  const marker = map.locator(".event-marker-tsunami_warning");
  await expect.poll(async () => {
    const [target, canvas, overlay] = await Promise.all([marker.boundingBox(), map.boundingBox(), alert.boundingBox()]);
    if (!target || !canvas || !overlay) return false;
    const x = target.x + target.width / 2;
    const y = target.y + target.height / 2;
    return Math.abs(x - (canvas.x + canvas.width / 2)) < 6
      && Math.abs(y - (canvas.y + canvas.height / 2)) < 6
      && (y < overlay.y || x < overlay.x);  // never hidden behind the compact card at the right
  }).toBe(true);
  await expect(headline).toHaveText(secondReport.headline);

  await next.click();
  await expect(headline).toHaveText(thirdReport.headline);
  await expect(wire.getByText(firstReport.headline, { exact: true })).toBeVisible();
});

test("seek and reset clear queued headlines, then replay can show them again", async ({ page }) => {
  await page.goto("/");
  await page.goto("/?demo=japan");
  const alert = page.locator(".headline-alert");
  const wire = page.getByRole("region", { name: "Reports" });
  const playback = page.getByRole("region", { name: "Simulation playback" });
  const play = playback.getByRole("button", { name: "Play", exact: true });
  const reset = playback.getByRole("button", { name: "Reset playback" });
  const seek = playback.getByRole("slider", { name: "Simulation timeline" });

  await playback.getByRole("button", { name: "4×" }).click();
  await play.click();
  await expect(alert.getByRole("button", { name: "Next headline" })).toBeVisible();
  await playback.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(play).toBeVisible();

  await seek.press("End");
  await expect(wire.getByRole("button")).toHaveCount(fixture.events.length);
  await expect(alert).toHaveCount(0);
  await playback.getByRole("button", { name: "Replay", exact: true }).click();
  await expect(alert.getByRole("heading")).toHaveText(firstReport.headline);
  await expect(alert.getByRole("button", { name: "Next headline" })).toBeVisible();

  await reset.click();
  await expect(wire).toContainText("No reports yet");
  await expect(alert).toHaveCount(0);
  await play.click();
  await expect(alert.getByRole("heading")).toHaveText(firstReport.headline);
});

test("an event from a different scenario can be dismissed and duplicate frames stay silent", async ({ page }) => {
  // Reuse a fixture ID in another scenario to exercise the existing feed boundary.
  const event = {
    id: quake.id,
    type: "other_hazard",
    status: "applied",
    sim_time_minutes: quake.sim_time_minutes,
    sequence: quake.sequence,
    location: { lat: 46.81, lon: -71.21, name: "Québec City", country: "Canada", country_code: "CAN" },
    severity: 0.35,
    visual: "breaking_news",
    payload: { label: "Solar storm", description: "Radio service is interrupted across the region." },
    parent_ids: [],
    provenance: quake.provenance,
  };
  const header = { schema_version: fixture.schema_version, simulation_id: "solar-storm-demo", branch_id: fixture.branch_id };

  await page.routeWebSocket("**/stream", (socket) => {
    let clockMinute = event.sim_time_minutes;
    socket.onMessage((raw) => {
      const control = JSON.parse(String(raw));
      if (control.action === "seek") {
        socket.send(JSON.stringify({
          ...header,
          kind: "snapshot",
          events: [],
          sim_time_minutes: control.sim_time_minutes,
          playback: { state: "paused", speed: 1 },
        }));
      }
      if (control.action === "play") {
        const frame = JSON.stringify({ ...header, kind: "event", event, sim_time_minutes: event.sim_time_minutes });
        socket.send(frame);
        socket.send(frame);
        socket.send(JSON.stringify({
          ...header,
          kind: "clock",
          sim_time_minutes: ++clockMinute,
          playback: { state: "paused", speed: 1 },
        }));
      }
    });
  });

  await page.goto("/");
  await page.goto("/?demo=japan");
  const alert = page.locator(".headline-alert");
  const play = page.getByRole("button", { name: "Play", exact: true });
  await play.click();
  await expect(alert.getByRole("heading")).toHaveText("Solar storm reported near Québec City");
  await expect(alert).toContainText(event.payload.description);
  await expect(alert).toContainText("Severity 35%");
  await alert.getByRole("button", { name: "Dismiss" }).click();
  await expect(alert).toHaveCount(0);

  await play.click();
  await expect(page.locator(".timeline-meta")).toContainText("DAY 1 · 06:44");
  await expect(alert).toHaveCount(0);
});

test("an applied event delivered late after a seek does not create a headline", async ({ page }) => {
  const startMinute = quake.sim_time_minutes - 1;
  const staleEvent = { ...quake, sim_time_minutes: startMinute };
  const header = { schema_version: fixture.schema_version, simulation_id: fixture.simulation_id, branch_id: fixture.branch_id };

  await page.routeWebSocket("**/stream", (socket) => {
    let minute = startMinute;
    const send = (data: object) => socket.send(JSON.stringify({ ...header, sim_time_minutes: minute, ...data }));
    socket.onMessage((raw) => {
      const control = JSON.parse(String(raw));
      if (control.action === "seek") {
        minute = control.sim_time_minutes;
        send({ kind: "snapshot", playback: { state: "paused", speed: 1 }, events: [] });
        send({ kind: "event", event: staleEvent });
      } else if (control.action === "play") {
        minute = quake.sim_time_minutes;
        send({ kind: "event", event: quake });
        send({ kind: "clock", playback: { state: "playing", speed: 1 } });
      }
    });
  });

  await page.goto("/");
  await page.goto("/?demo=japan");
  const alert = page.locator(".headline-alert");
  await expect(alert).toHaveCount(0);
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(alert.getByRole("heading")).toHaveText(firstReport.headline);
});
