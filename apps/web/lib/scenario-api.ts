import {
  sameRunOrBranch, type GenerationProgress, type NewsItem, type Pacing, type RunIdentity, type ScenarioEvent, type ScenarioRun,
} from "./scenario";

const proxy = "/api/simulation";

type ScenarioJob = {
  id: string;
  simulation_id: string;
  status: "generating" | "ready" | "failed";
  title?: string;
  start_minutes?: number;
  error?: { message: string };
  stage?: string;
  elapsed_s?: number;
};

type Timeline = RunIdentity & {
  sim_time_minutes: number;
  end_minutes: number;
  events: ScenarioEvent[];
  pacing?: Pacing;
};

function scenarioPath(id: string) {
  return `/scenarios/${encodeURIComponent(id)}`;
}

async function requestJson<T>(path: string, options: RequestInit): Promise<T> {
  const response = await fetch(proxy + path, { cache: "no-store", ...options });
  if (response.status === 429) throw new Error("The Director is busy. Try again in a moment.");
  if (!response.ok) throw new Error("The scenario service is unavailable. Try again.");
  return response.json();
}

export async function prepareScenario(
  prompt: string,
  signal: AbortSignal,
  onProgress?: (progress: GenerationProgress) => void,
  player?: ScenarioRun["player"],
  fixture?: string,
): Promise<ScenarioRun> {
  // `fixture` replays a checked-in Director scenario (offline, no model call).
  // `player` starts the same scenario in player mode, where your decisions fork the run.
  const extra = player ? { fixture: player.fixture, mode: "player", role: player.role } : fixture ? { fixture } : {};
  let job = await requestJson<ScenarioJob>("/scenarios", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, ...extra }),
    signal,
  });
  if (!job.id || !job.simulation_id) throw new Error("The scenario service did not return a run.");

  const { id, simulation_id } = job;
  const path = scenarioPath(id);
  const report = () => onProgress?.({ stage: job.stage, elapsedSeconds: job.elapsed_s });
  report();
  while (job.status === "generating") {
    await new Promise((resolve) => setTimeout(resolve, 700));
    signal.throwIfAborted();
    job = await requestJson<ScenarioJob>(path, { signal });
    if (job.status === "generating") report();
  }
  if (job.status !== "ready") {
    throw new Error(job.error?.message || "The scenario could not be prepared. Try again.");
  }

  const timeline = await requestJson<Timeline>(`${path}/timeline`, { signal });
  const startMinute = job.start_minutes ?? timeline.sim_time_minutes;
  const firstEvent = timeline.events?.[0];
  if (timeline.simulation_id !== simulation_id || !firstEvent || !Number.isInteger(startMinute) ||
      !Number.isInteger(timeline.end_minutes) || timeline.end_minutes < startMinute) {
    throw new Error("The scenario service did not return a playable timeline.");
  }

  return {
    id,
    simulation_id,
    branch_id: timeline.branch_id,
    title: job.title?.trim() || prompt,
    startMinute,
    endMinute: timeline.end_minutes,
    firstEvent,
    pacing: timeline.pacing,
    ...(fixture ? { fixture } : {}),
    ...(player ? { player, fixture: player.fixture, title: `${player.scenarioTitle} · ${player.roleTitle}` } : {}),
  };
}

export async function readScenarioNews(run: ScenarioRun, signal: AbortSignal) {
  const report = await requestJson<RunIdentity & { items: NewsItem[] }>(
    `${scenarioPath(run.id)}/news`,
    { signal },
  );
  return sameRunOrBranch(run, report) ? report.items : [];
}

export function streamUrl(runId?: string) {
  const path = runId ? `${scenarioPath(runId)}/stream` : "/stream";
  const override = process.env.NEXT_PUBLIC_SIMULATION_WS_URL;
  if (override) return runId ? new URL(path, override).href : override;
  const url = new URL(proxy + path, window.location.href);
  url.protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return url.href;
}
