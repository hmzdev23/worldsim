import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.E2E_PORT ?? 3200);

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  reporter: "list",
  workers: 1,
  use: { baseURL: `http://localhost:${port}` },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 } } },
  ],
  webServer: [
    {
      command: "../../scripts/run-simulation-server.sh",
      url: "http://127.0.0.1:8765/health",
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command: `NEXT_PUBLIC_SIMULATION_MINUTES_PER_SECOND=60 npm run dev -- --port ${port}`,
      url: `http://localhost:${port}`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
