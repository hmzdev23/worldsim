export type RecapFilmJob = {
  status: "queued" | "generating" | "ready" | "failed";
  stage: string;
  videoUrl?: string;
  message?: string;
};

type JobStore = Map<string, RecapFilmJob>;
const globalJobs = globalThis as typeof globalThis & { worldsimRecapFilmJobs?: JobStore };
export const recapFilmJobs = globalJobs.worldsimRecapFilmJobs ??= new Map();
