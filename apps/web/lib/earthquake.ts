import fixture from "../../../contracts/fixtures/japan-earthquake.json";

export type MapLocation = {
  lat: number;
  lon: number;
  zoom?: number;
};

export type ImpactSnapshot = {
  fatalities_estimate?: number;
  injuries_estimate?: number;
  missing_estimate?: number;
  displaced_people?: number;
  people_in_shelters?: number;
  households_without_power?: number;
  households_without_water?: number;
  economic_loss_usd?: number;
  flooded_area_km2?: number;
  contaminated_sites?: number;
  debris_tonnes?: number;
  aid_countries?: string[];
  aid_personnel?: number;
  aid_cargo_tonnes?: number;
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

const [event] = fixture.events;

export const earthquake = {
  id: event.id,
  title: "Earthquake off Japan",
  description:
    "A deterministic proof-of-concept scenario. Watch hazards, response, and downstream impacts unfold over simulated time.",
  location: event.location,
  simTimeMinutes: event.sim_time_minutes,
  magnitude: `${event.payload.magnitude} Mw`,
  region: `Miyagi coast, ${event.location.country}`,
} as const;

export const scenarioStartMinute = Math.max(0, Math.min(...fixture.events.map((item) => item.sim_time_minutes)) - 1);
export const scenarioEndMinute = Math.max(...fixture.events.map((item) => item.sim_time_minutes));
