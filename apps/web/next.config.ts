import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";

const config: NextConfig = {
  devIndicators: false,
  turbopack: {
    root: fileURLToPath(new URL("../..", import.meta.url)),
  },
  async rewrites() {
    const simulationUrl = (process.env.SIMULATION_HTTP_URL ?? "http://127.0.0.1:8765").replace(/\/$/, "");
    return [
      { source: "/api/simulation/scenarios/:path*", destination: `${simulationUrl}/scenarios/:path*` },
      { source: "/api/simulation/timeline", destination: `${simulationUrl}/timeline` },
      { source: "/api/simulation/stream", destination: `${simulationUrl}/stream` },
      { source: "/api/simulation/satire", destination: `${simulationUrl}/satire` },
      { source: "/api/simulation/starters", destination: `${simulationUrl}/starters` },
    ];
  },
};

export default config;
