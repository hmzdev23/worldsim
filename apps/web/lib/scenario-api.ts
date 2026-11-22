import {
  sameRun, type GenerationProgress, type NewsItem, type Pacing, type RunIdentity, type SatireReport, type ScenarioEvent,
  type ScenarioRun, type Tone,
} from "./scenario";

const proxy = "/api/simulation";

type ScenarioJob = {
  id: string;
  simulation_id: string;
  status: "generating" | "ready" | "failed";
  title?: string;
  tone?: Tone;
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
  tone: Tone = "straight",
): Promise<ScenarioRun> {
  let job = await requestJson<ScenarioJob>("/scenarios", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, tone }),
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
    tone: job.tone ?? tone,
    startMinute,
    endMinute: timeline.end_minutes,
    firstEvent,
    pacing: timeline.pacing,
  };
}

export async function readScenarioNews(run: ScenarioRun, signal: AbortSignal) {
  const report = await requestJson<RunIdentity & { items: NewsItem[] }>(
    `${scenarioPath(run.id)}/news`,
    { signal },
  );
  return sameRun(run, report) ? report.items : [];
}

/** The satire layer for the run's released events (the demo uses the fixture server's /satire). */
export async function readSatire(run: ScenarioRun, isDemo: boolean, tone: Tone, signal: AbortSignal) {
  const path = isDemo ? "/satire" : `${scenarioPath(run.id)}/satire`;
  const report = await requestJson<SatireReport>(`${path}?tone=${encodeURIComponent(tone)}`, { signal });
  return sameRun(run, report) && report.tone === tone ? report : undefined;
}

export function streamUrl(runId?: string) {
  const path = runId ? `${scenarioPath(runId)}/stream` : "/stream";
  const override = process.env.NEXT_PUBLIC_SIMULATION_WS_URL;
  if (override) return runId ? new URL(path, override).href : override;
  const url = new URL(proxy + path, window.location.href);
  url.protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return url.href;
}
