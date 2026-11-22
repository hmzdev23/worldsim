// Step playback helpers (pure, no React): 5% steps, timeline pins and map framing.

import { formatSimTime, type ScenarioEvent, type ScenarioRun } from "./scenario";

// Playback moves in steps of 5% of the run: twenty steps, whatever the server's
// clock tick (watch runs tick 5% at 1×; player runs tick in 60 smaller beats).
const stepFraction = 0.05;

/** Run minutes at every 5% step, from the start (step 0) to the end. */
export function stepBoundaries(run: Pick<ScenarioRun, "startMinute" | "endMinute">) {
  const count = Math.round(1 / stepFraction);
  const span = Math.max(0, run.endMinute - run.startMinute);
  const minutes = Array.from({ length: count + 1 }, (_, index) => run.startMinute + Math.round((span * index) / count));
  return minutes.filter((minute, index) => index === 0 || minute > minutes[index - 1]);
}

/** Timeline pins for applied events; events within 1.5% of the run share one pin. */
export function eventPins(applied: ScenarioEvent[], run: Pick<ScenarioRun, "startMinute" | "endMinute">) {
  const span = Math.max(1, run.endMinute - run.startMinute);
  const pins: { left: number; events: ScenarioEvent[]; label: string }[] = [];
  for (const event of applied) {
    const left = Math.max(0, Math.min(1, (event.sim_time_minutes - run.startMinute) / span));
    const last = pins.at(-1);
    if (last && left - last.left < 0.015) last.events.push(event);
    else pins.push({ left, events: [event], label: "" });
  }
  const describe = (event: ScenarioEvent) =>
    `${event.type.replaceAll("_", " ")}, ${event.location?.name || event.location?.country || "no location"}`;
  for (const pin of pins) {
    const when = formatSimTime(pin.events[0].sim_time_minutes);
    pin.label = pin.events.length === 1
      ? `${describe(pin.events[0])}, ${when}`
      : `${pin.events.length} events from ${when}: ${pin.events.map(describe).join("; ")}`;
  }
  return pins;
}

/**
 * [[west, south], [east, north]] around every event. Uses the narrower of the
 * two ways round the globe, so a Pacific run frames the Pacific (east may be > 180).
 */
export function eventBounds(events: Pick<ScenarioEvent, "location">[]): [[number, number], [number, number]] | undefined {
  // Reports without a usable location are left out, never guessed.
  events = events.filter(({ location }) => location && Number.isFinite(location.lat) && Number.isFinite(location.lon));
  if (!events.length) return undefined;
  const lats = events.map((event) => event.location.lat);
  const lons = events.map((event) => event.location.lon);
  const shifted = lons.map((lon) => (lon < 0 ? lon + 360 : lon));
  const width = (values: number[]) => Math.max(...values) - Math.min(...values);
  const use = width(shifted) < width(lons) ? shifted : lons;
  return [[Math.min(...use), Math.min(...lats)], [Math.max(...use), Math.max(...lats)]];
}
