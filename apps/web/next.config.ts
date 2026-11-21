import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";

const config: NextConfig = {
  turbopack: {
    root: fileURLToPath(new URL("../..", import.meta.url)),
  },
  async rewrites() {
    const simulationUrl = (process.env.SIMULATION_HTTP_URL ?? "http://127.0.0.1:8765").replace(/\/$/, "");
    return [
      { source: "/api/simulation/scenarios/:path*", destination: `${simulationUrl}/scenarios/:path*` },
      { source: "/api/simulation/stream", destination: `${simulationUrl}/stream` },
    ];
  },
};

export default config;
