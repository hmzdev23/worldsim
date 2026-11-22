export type MapLocation = {
  lat: number;
  lon: number;
  zoom?: number;
};

// payload.impacts from contracts/events.schema.json: fictional scenario-wide
// totals as of the event (never deltas). An omitted key means no estimate yet.
export type AidContributor = {
  country: string;
  personnel?: number;
  cargo_tonnes?: number;
  cargo?: string;
};

export type ImpactSnapshot = {
  basis: "fictional_estimate";
  deaths?: number;
  injuries?: number;
  missing?: number;
  displaced?: number;
  sheltered?: number;
  households_without_power?: number;
  households_without_water?: number;
  economic_loss_usd?: number;
  flooded_area_km2?: number;
  contaminated_area_km2?: number;
  debris_tonnes?: number;
  aid_contributors?: AidContributor[];
};

export type ScenarioEvent = {
  id: string;
  type: string;
  status: "applied" | "proposed" | "rejected";
  sim_time_minutes: number;
  sequence: number;
  location: MapLocation & { name: string; country: string; country_code: string };
  severity: number;
  visual: string;
  provenance?: { source?: string };
  payload: Record<string, unknown> & { impacts?: ImpactSnapshot };
  parent_ids: string[];
};

export type RunIdentity = { simulation_id: string; branch_id: string };

// How the server paces a run's clock (SIM-005, #58): HTTP-only, from /timeline.
export type Pacing =
  | { mode: "relative"; fraction_per_tick: number; span_minutes: number; minutes_per_tick: number; tick_seconds: number }
  | { mode: "fixed"; minutes_per_tick: number; tick_seconds: number };

export type ScenarioRun = RunIdentity & {
  id: string;
  title: string;
  startMinute: number;
  endMinute: number;
  firstEvent: ScenarioEvent;
  pacing?: Pacing;
  // Player mode (prototype): the run branches when the player decides, so its
  // branch_id changes; match it by simulation_id only.
  player?: { fixture: string; role: string; roleTitle: string; scenarioTitle: string };
};

/** Whether a stream message or news response belongs to this run (any branch in player mode). */
export function sameRunOrBranch(run: ScenarioRun, other: RunIdentity) {
  return run.player ? run.simulation_id === other.simulation_id : sameRun(run, other);
}

// What the scenario service is doing while a run generates (GET /scenarios/{id}).
export type GenerationProgress = { stage?: string; elapsedSeconds?: number };

const stageLabels: Record<string, string> = {
  queued: "Waiting for the Director",
  starting: "Starting the Director",
  prompt: "Checking the prompt",
  model: "The Director is predicting events",
  fixture: "Loading the sample scenario",
  parse: "Reading the prediction",
  validate: "Validating events",
  applying: "Loading events into the simulation",
};

export function generationStageLabel(stage?: string) {
  return stage ? stageLabels[stage] ?? `Working (${stage.replaceAll("_", " ")})` : undefined;
}

function formatDuration(seconds: number) {
  return seconds >= 60
    ? `${Math.floor(seconds / 60)}m ${String(Math.round(seconds % 60)).padStart(2, "0")}s`
    : `${seconds}s`;
}

/** "≈5% of the scenario per second" and the wall time left at this speed, or undefined. */
export function pacingSummary(pacing: Pacing | undefined, speed: number, remainingMinutes: number) {
  if (!pacing || pacing.mode !== "relative" || !(pacing.tick_seconds > 0)) return undefined;
  const percent = Math.round(pacing.fraction_per_tick * 100 * speed * 10) / 10;
  const per = pacing.tick_seconds === 1 ? "second" : `${pacing.tick_seconds} seconds`;
  const step = pacing.minutes_per_tick * speed;
  const left = step > 0 ? Math.ceil(Math.max(0, remainingMinutes) / step - 1e-9) * pacing.tick_seconds : 0;
  return { rate: `≈${percent}% of the scenario per ${per}`, left: left > 0 ? `about ${formatDuration(left)} left` : "at the end" };
}

export type Playback = { state: "playing" | "paused"; speed: number };
export type StreamMessage = RunIdentity & { sim_time_minutes: number } & (
  | { kind: "snapshot"; playback: Playback; events: ScenarioEvent[] }
  | { kind: "event"; event: ScenarioEvent }
  | { kind: "clock"; playback: Playback }
);

// Both the alert and the archive consume WORLD//WIRE items through this shape.
export type NewsItem = {
  sim_time_minutes?: number;
  event_id: string;
  event_type: string;
  severity: number;
  label: string;
  headline: string;
  dek: string;
  sim_time_label: string;
  focus: MapLocation & { event_id: string };
};

export function formatSimTime(minutes: number) {
  const day = Math.floor(minutes / 1440) + 1;
  const hour = Math.floor(minutes % 1440 / 60);
  const minute = Math.floor(minutes % 60);
  return `DAY ${day} · ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function sameRun(left: RunIdentity, right: RunIdentity) {
  return left.simulation_id === right.simulation_id && left.branch_id === right.branch_id;
}

export function focusNewsItem(item: NewsItem) {
  window.dispatchEvent(new CustomEvent("worldsim:focus", { detail: item.focus }));
}

export function fallbackNewsItem(event: ScenarioEvent): NewsItem {
  const place = event.location?.name || event.location?.country || "the scenario";
  const { description, label } = event.payload;
  const subject = typeof label === "string" && label.trim()
    ? label
    : event.type.replaceAll("_", " ");
  return {
    event_id: event.id,
    event_type: event.type,
    severity: event.severity,
    label: "SIMULATED",
    headline: `${subject.charAt(0).toUpperCase()}${subject.slice(1)} reported near ${place}`,
    dek: typeof description === "string" && description.trim()
      ? description
      : "A simulated event has been applied to the world state.",
    sim_time_label: formatSimTime(event.sim_time_minutes),
    sim_time_minutes: event.sim_time_minutes,
    focus: { event_id: event.id, lat: event.location?.lat ?? Number.NaN, lon: event.location?.lon ?? Number.NaN, zoom: 5.5 },
  };
}
