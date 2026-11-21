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
  payload: Record<string, unknown> & { impacts?: ImpactSnapshot };
  parent_ids: string[];
};

export type RunIdentity = { simulation_id: string; branch_id: string };

export type ScenarioRun = RunIdentity & {
  id: string;
  title: string;
  startMinute: number;
  endMinute: number;
  firstEvent: ScenarioEvent;
};

export type Playback = { state: "playing" | "paused"; speed: number };
export type StreamMessage = RunIdentity & { sim_time_minutes: number } & (
  | { kind: "snapshot"; playback: Playback; events: ScenarioEvent[] }
  | { kind: "event"; event: ScenarioEvent }
  | { kind: "clock"; playback: Playback }
);

// Both the alert and the archive consume WORLD//WIRE items through this shape.
export type NewsItem = {
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
  const place = event.location.name || event.location.country;
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
    focus: { event_id: event.id, lat: event.location.lat, lon: event.location.lon, zoom: 5.5 },
  };
}
