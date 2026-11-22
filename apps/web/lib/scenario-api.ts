import {
  sameRun, type GenerationProgress, type NewsItem, type Pacing, type RunIdentity, type SatireReport, type ScenarioEvent,
  type ScenarioRun, type Starter, type Tone,
} from "./scenario";

const proxy = "/api/simulation";

type ScenarioJob = {
  id: string;
  simulation_id: string;
  status: "generating" | "ready" | "failed";
  title?: string;
  tone?: Tone;
  seed?: number;
  start_minutes?: number;
  error?: { message: string };
  stage?: string;
  elapsed_s?: number;
};

type Timeline = RunIdentity & {
  sim_time_minutes: number;
  end_minutes: number;
  events: ScenarioEvent[];
  headline_event_ids?: string[];
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
  fixture?: string,
): Promise<ScenarioRun> {
  // No seed is sent: the server rolls a new one for every run, so no two runs repeat.
  const extra = fixture ? { fixture } : {};
  let job = await requestJson<ScenarioJob>("/scenarios", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, tone, ...extra }),
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
    seed: job.seed,
    startMinute,
    endMinute: timeline.end_minutes,
    firstEvent,
    headlineEventIds: timeline.headline_event_ids,
    pacing: timeline.pacing,
  };
}

export async function readDemoHeadlines(signal: AbortSignal) {
  const timeline = await requestJson<Timeline>("/timeline", { signal });
  return timeline.headline_event_ids;
}

export async function readScenarioNews(run: ScenarioRun, signal: AbortSignal) {
  const report = await requestJson<RunIdentity & { items: NewsItem[] }>(
    `${scenarioPath(run.id)}/news`,
    { signal },
  );
  return sameRun(run, report) ? report.items : [];
}

/** Starter scenarios: a prompt plus an offline fixture each. Every run of one is still unique. */
export async function listStarters(signal: AbortSignal): Promise<Starter[]> {
  const body = await requestJson<{ starters: Starter[] }>("/starters", { signal });
  return Array.isArray(body.starters) ? body.starters : [];
}

/** The run's canonical result (seed, prompt, every event): what the map plays and the recap film follows. */
export async function readRunResult(run: ScenarioRun, signal?: AbortSignal) {
  return requestJson<RunIdentity & { seed?: number; prompt: string; events: ScenarioEvent[]; headline_event_ids?: string[] }>(
    `${scenarioPath(run.id)}/result`, { signal },
  );
}

/** Pause a run over HTTP (when leaving it without a socket). */
export async function pauseRun(runId: string) {
  await requestJson(`${scenarioPath(runId)}/control`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "pause" }),
  });
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
