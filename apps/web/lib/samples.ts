// Sample hazard scenarios (offline Director fixtures in services/director/fixtures).
// Each one plays through the same scenario service as a prompted run, so it
// moves 5% of its own length per tick and can be paused, stepped and rewound.

export type SampleScenario = {
  fixture: string;
  hazard: "earthquake" | "tsunami" | "eruption" | "pandemic" | "nuclear" | "zombie" | "alien" | "sun" | "insect" | "ai";
  label: string;
  title: string;
};

export const sampleScenarios: SampleScenario[] = [
  { fixture: "japan-earthquake", hazard: "earthquake", label: "Earthquake", title: "M7.8 earthquake off Miyagi, Japan" },
  { fixture: "pacific-tsunami", hazard: "tsunami", label: "Tsunami", title: "M9.0 quake off Chile sends a tsunami across the Pacific" },
  { fixture: "vesuvius-eruption", hazard: "eruption", label: "Volcanic eruption", title: "Major VEI 5 eruption of Vesuvius, Italy" },
  { fixture: "global-pandemic", hazard: "pandemic", label: "Pandemic", title: "A new virus spreads from Singapore" },
  { fixture: "north-sea-nuclear-war", hazard: "nuclear", label: "Nuclear war", title: "Nuclear strikes on two North Sea ports" },
  { fixture: "atlanta-zombie-outbreak", hazard: "zombie", label: "Zombie outbreak", title: "A reanimation virus spreads from Atlanta" },
  { fixture: "alien-craft-arrival", hazard: "alien", label: "Alien invasion", title: "Alien craft arrive over New York, Tokyo and Cairo" },
  { fixture: "sun-vanishes", hazard: "sun", label: "The Sun disappears", title: "The Sun vanishes and the world goes dark" },
  { fixture: "amazon-giant-insects", hazard: "insect", label: "Giant insects", title: "Mutated giant insects spread from the Amazon" },
  { fixture: "rogue-ai-takeover", hazard: "ai", label: "AI takeover", title: "A rogue AI seizes networks, grids and markets" },
];
