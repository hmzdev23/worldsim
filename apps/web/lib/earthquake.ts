import fixture from "../../../contracts/fixtures/japan-earthquake.json";

export type MapLocation = {
  lat: number;
  lon: number;
  zoom?: number;
};

const [event] = fixture.events;

export const earthquake = {
  id: event.id,
  title: "Earthquake off Japan",
  description:
    "A fictional offshore earthquake near Miyagi. Follow the shockwave as it expands from the epicenter.",
  location: event.location,
  simTimeMinutes: event.sim_time_minutes,
  magnitude: `${event.payload.magnitude} Mw`,
  region: `Miyagi coast, ${event.location.country}`,
  durationSeconds: 24,
} as const;
