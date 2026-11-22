// The scenario chooser (offline Director fixtures in services/director/fixtures).
// Each scenario has two chains:
//   fixture        its default timeline: the narrative chain played when nobody intervenes
//   playerFixture  the chain "You decide" plays, with five roles and decision points
//                  (fixtures/player/<playerFixture>.json, from #82)
// Both run through the scenario service, 5% of the run per tick, with step and rewind.

export type SampleScenario = {
  fixture: string;
  playerFixture: string;
  hazard: "earthquake" | "tsunami" | "eruption" | "pandemic" | "nuclear" | "zombie" | "alien" | "sun" | "insect" | "ai";
  label: string;
  title: string;
};

export const sampleScenarios: SampleScenario[] = [
  { fixture: "japan-earthquake", playerFixture: "japan-earthquake", hazard: "earthquake", label: "Earthquake", title: "M7.8 earthquake off Miyagi, Japan" },
  { fixture: "pacific-tsunami", playerFixture: "tsunami", hazard: "tsunami", label: "Tsunami", title: "M9.0 quake off Chile sends a tsunami across the Pacific" },
  { fixture: "vesuvius-eruption", playerFixture: "iceland-eruption", hazard: "eruption", label: "Volcanic eruption", title: "Major VEI 5 eruption of Vesuvius, Italy" },
  { fixture: "global-pandemic", playerFixture: "global-pandemic", hazard: "pandemic", label: "Pandemic", title: "A new virus spreads from Singapore" },
  { fixture: "north-sea-nuclear-war", playerFixture: "nuclear-war", hazard: "nuclear", label: "Nuclear war", title: "Nuclear strikes on two North Sea ports" },
  { fixture: "atlanta-zombie-outbreak", playerFixture: "zombie-outbreak", hazard: "zombie", label: "Zombie outbreak", title: "A reanimation virus spreads from Atlanta" },
  { fixture: "alien-craft-arrival", playerFixture: "alien-invasion", hazard: "alien", label: "Alien invasion", title: "Alien craft arrive over New York, Tokyo and Cairo" },
  { fixture: "sun-vanishes", playerFixture: "sun-disappearing", hazard: "sun", label: "The Sun disappears", title: "The Sun vanishes and the world goes dark" },
  { fixture: "amazon-giant-insects", playerFixture: "giant-insect-mutation", hazard: "insect", label: "Giant insects", title: "Mutated giant insects spread from the Amazon" },
  { fixture: "rogue-ai-takeover", playerFixture: "ai-takeover", hazard: "ai", label: "AI takeover", title: "A rogue AI seizes networks, grids and markets" },
];
