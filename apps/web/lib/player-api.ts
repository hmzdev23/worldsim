// Player mode (prototype): HTTP client for the scenario service's player routes.
// Pending decisions are polled over HTTP; the stream contract is unchanged.

const proxy = "/api/simulation";

export type PlayerRole = { id: string; title: string; summary: string };
export type PlayableScenario = { fixture: string; title: string; summary: string; roles: PlayerRole[] };

export type DecisionOption = { id: string; label: string; tradeoff: string };

export type DecisionTrigger = {
  event_id: string;
  minute: number;
  sim_time_label: string;
  type: string;
  place: string;
  rule: string;
  rule_label: string;
  headline: string;
};

export type DecisionRecord = {
  id: string;
  status: "resolved" | "voided" | "pending";
  trigger: DecisionTrigger;
  deferrals: number;
  choice?: "action" | "do_nothing" | "free_text" | "auto";
  option_id?: string | null;
  label?: string;
  free_text?: string | null;
  at_minutes?: number;
  simulated?: boolean;
  branch_id?: string;
  delay_minutes?: number;
};

export type PendingDecision = DecisionRecord & {
  situation: string;
  waiting: boolean;
  deadline_minutes: number | null;
  options: DecisionOption[];
  do_nothing: DecisionOption;
  decide_later: { id: string; remaining: number; defer_minutes: number; defer_label: string };
  free_text: { max_chars: number; simulated: boolean; note: string };
};

export type PlayerState = {
  mode: "player";
  label: string;
  scenario: { fixture: string; title: string };
  role: { id: string; title: string };
  branch_id: string;
  sim_time_minutes: number;
  finished: boolean;
  pending: PendingDecision | null;
  decisions: DecisionRecord[];
  variables: { fixed: Record<string, unknown>; independent: Record<string, string | number> };
};

export type ScoreComponent = { id: string; label: string; points: number; max: number; explanation: string; why: string };

export type OutcomeMetric = {
  name: string; label: string; baseline: number | null; final: number | null;
  baseline_text: string; final_text: string; difference_text: string; verdict: string;
};

// The Alternate Timeline: timeline A (no intervention, the run's main segment) against timeline B (the player's branch).
export type ComparedEvent = {
  id: string; minute: number; time_label: string; type: string; type_label: string; place: string;
  country?: string | null; severity: number; description: string;
};

export type ComparisonRow = {
  kind: "event" | "decision";
  id: string;
  status: "same" | "changed" | "prevented" | "benefit" | "side_effect" | "added" | "decision";
  minute: number;
  a: ComparedEvent | null;
  b: ComparedEvent | null;
  changes: { kind: "moved" | "severity"; from: number; to: number }[];
  decisions: string[];
  note: string;
  decision_id?: string;
  choice?: DecisionRecord["choice"];
  simulated?: boolean;
  verdict?: string;
};

export type ComparedDecision = {
  id: string; minute: number; time_label: string; label: string; choice: DecisionRecord["choice"];
  option_id: string | null; simulated: boolean; branch_id: string; verdict: string;
  trigger: { headline: string; place: string; rule_label: string; minute: number };
  effects: Record<"prevented" | "moved" | "less_severe" | "more_severe" | "benefit" | "side_effect", number>;
  explanation: string;
};

export type Comparison = {
  label: string;
  note: string;
  headline: string;
  timelines: Record<"a" | "b", { id: string; title: string; branch_id: string; events: number }>;
  initial_conditions: {
    scenario: string; summary: string; role: string; start_minutes: number; start_label: string; end_label: string;
    fixed: Record<string, string | number>; first_event: ComparedEvent | null; identical: boolean;
    shared_until_minutes: number; shared_until_label: string; shared_events: number;
  };
  settings: { name: string; label: string; default: string | number; final: string | number }[];
  metrics: OutcomeMetric[];
  decisions: ComparedDecision[];
  rows: ComparisonRow[];
};

export type PlayerSummary = {
  finished: boolean;
  label: string;
  role: { id: string; title: string };
  scenario: { fixture: string; title: string };
  score: { total: number; max: number; components: ScoreComponent[] };
  decisions: (DecisionRecord & { verdict: string; caused: string[] })[];
  voided: DecisionRecord[];
  baseline: OutcomeMetric[];
  paragraph: string;
  comparison: Comparison;
};

export class PlayerRequestError extends Error {
  constructor(message: string, readonly status: number, readonly body: Record<string, unknown>) {
    super(message);
  }
}

function runPath(runId: string, rest = "") {
  return `${proxy}/scenarios/${encodeURIComponent(runId)}${rest}`;
}

async function send<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = typeof body?.detail === "string" ? body.detail : "The scenario service refused the request.";
    throw new PlayerRequestError(detail, response.status, body);
  }
  return body as T;
}

const json = (body: unknown): RequestInit => ({
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});

export async function listPlayableScenarios(signal?: AbortSignal) {
  return (await send<{ scenarios: PlayableScenario[] }>(`${proxy}/player/scenarios`, { signal })).scenarios;
}

export const readPlayerState = (runId: string, signal?: AbortSignal) =>
  send<PlayerState>(runPath(runId, "/player"), { signal });

export const readPlayerSummary = (runId: string, signal?: AbortSignal) =>
  send<PlayerSummary>(runPath(runId, "/summary"), { signal });

export const submitDecision = (runId: string, body: {
  decision_id: string; option_id?: string; free_text?: string; at_minutes: number;
}) => send<PlayerState>(runPath(runId, "/decisions"), json(body));

export const branchFromDecision = (runId: string, decisionId: string) =>
  send<PlayerState>(runPath(runId, `/decisions/${encodeURIComponent(decisionId)}/branch`), { method: "POST" });

/** Playback control over HTTP, so a seek that would void decisions can be confirmed. */
export const controlRun = (runId: string, body: Record<string, unknown>) =>
  send<{ sim_time_minutes: number; kind: string }>(runPath(runId, "/control"), json(body));
