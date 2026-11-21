export type MapLocation = {
  longitude: number;
  latitude: number;
};

// Frontend fixture for WEB-001. The shared event contract is tracked in #1.
export const earthquake = {
  title: "Earthquake off Japan",
  description:
    "A fictional offshore earthquake near Miyagi. Follow the shockwave as it expands from the epicenter.",
  location: { longitude: 142.35, latitude: 38.24 },
  magnitude: "7.8 Mw",
  region: "Miyagi coast, Japan",
  durationSeconds: 24,
} as const;
