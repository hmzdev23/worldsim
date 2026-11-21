import fixture from "../../../contracts/fixtures/japan-earthquake.json";
import type { ScenarioEvent } from "./scenario";

const [event] = fixture.events;

export const japanDemo = {
  id: fixture.simulation_id,
  simulation_id: fixture.simulation_id,
  branch_id: fixture.branch_id,
  title: "Earthquake off Japan",
  firstEvent: event as ScenarioEvent,
  startMinute: Math.max(0, event.sim_time_minutes - 1),
  endMinute: Math.max(...fixture.events.map((item) => item.sim_time_minutes)),
} as const;
