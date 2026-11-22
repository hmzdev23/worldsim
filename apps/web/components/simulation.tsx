"use client";

import { ArrowClockwise, ArrowRight, GlobeHemisphereWest } from "@phosphor-icons/react";
import { MotionConfig } from "motion/react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { japanDemo } from "../lib/earthquake";
import { listStarters, pauseRun, prepareScenario } from "../lib/scenario-api";
import { generationStageLabel, type ScenarioRun, type Starter, type Tone } from "../lib/scenario";
import { enableHeadlineSound } from "../lib/headline-sound";
import { RunConsole } from "./run-console";
import { ScenarioStarters, type StarterLaunch } from "./scenario-starters";

// Used when the box is empty: press Enter (or Simulate) to run it.
const DEFAULT_PROMPT = "What if a volcanic eruption closed Iceland’s main airport for two days?";

// Satire is switched off for now: every run is straight-faced. The satire
// layer still exists in the Director, newsroom and server, unused by the app.
const RUN_TONE: Tone = "straight";

type View = "home" | "watch";
type LaunchState = { status: "idle" | "generating" | "ready" } | { status: "failed"; message: string };
// What started the current run, so "Run again" can roll a new seed for the same situation.
type Request = StarterLaunch & { tone: Tone };

export function Simulation() { return <MotionConfig reducedMotion="user"><ScenarioWorkspace /></MotionConfig>; }

function ScenarioWorkspace() {
  const [view, setView] = useState<View>("home");
  const [prompt, setPrompt] = useState("");
  const [run, setRun] = useState<ScenarioRun>(japanDemo);
  const [launch, setLaunch] = useState<LaunchState>({ status: "idle" });
  const [starters, setStarters] = useState<Starter[]>([]);
  const [startersError, setStartersError] = useState<string>();
  const [startersLoading, setStartersLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [autoStart, setAutoStart] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [stage, setStage] = useState<string>();
  const request = useRef<AbortController | null>(null);
  const lastRequest = useRef<Request | null>(null);
  const preparingSince = useRef<number | undefined>(undefined);
  const busy = launch.status === "generating";
  const isDemo = run === japanDemo;
  const runTone = RUN_TONE;
  const nextTone = RUN_TONE;

  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    const controller = new AbortController();
    setStartersLoading(true); setStartersError(undefined);
    listStarters(controller.signal).then((list) => {
      if (!controller.signal.aborted) { setStarters(list); setStartersLoading(false); }
    }, () => {
      if (!controller.signal.aborted) {
        setStartersError("We couldn’t connect to the simulation. Check that the local server is running, then try again.");
        setStartersLoading(false);
      }
    });
    return () => controller.abort();
  }, [reload]);
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => setElapsedSeconds(Math.floor((Date.now() - (preparingSince.current ?? Date.now())) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [busy]);

  function pauseCurrent() {
    if (view === "watch" && !isDemo) void pauseRun(run.id).catch(() => {});
  }
  function goHome() {
    pauseCurrent(); setLaunch({ status: "idle" }); setView("home");
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  async function start(next: Request) {
    if (!next.prompt || request.current) return;
    enableHeadlineSound();
    const controller = new AbortController();
    request.current = controller; preparingSince.current = Date.now(); lastRequest.current = next;
    setLaunch({ status: "generating" }); setElapsedSeconds(0); setStage(undefined);
    try {
      const scenario = await prepareScenario(next.prompt, controller.signal,
        (p) => { if (!controller.signal.aborted) setStage(p.stage); }, next.tone, next.fixture);
      if (controller.signal.aborted) return;
      pauseCurrent();
      setRun(scenario); setAutoStart(true); setView("watch"); setLaunch({ status: "ready" });
    } catch (error) {
      if (!controller.signal.aborted) {
        setLaunch({ status: "failed", message: error instanceof Error ? error.message : "We couldn’t prepare this world. Please try again." });
      }
    } finally {
      if (request.current === controller) request.current = null;
    }
  }
  function runAgain() {
    if (lastRequest.current) void start({ ...lastRequest.current, tone: runTone });
  }
  // The fixed Japan earthquake run is no longer on the home screen; tests open it with /?demo=japan.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("demo") === "japan") loadDemo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  function loadDemo() {
    pauseCurrent(); request.current?.abort(); request.current = null; lastRequest.current = null;
    setRun(japanDemo); setAutoStart(false); setLaunch({ status: "idle" }); setView("watch");
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // An empty box runs the example shown in it, so Enter alone starts a run.
    void start({ prompt: prompt.trim() || DEFAULT_PROMPT, tone: nextTone });
  }

  const launchMessage = launch.status === "failed" ? launch.message : busy
    ? `Preparing a new run${stage ? ` · ${generationStageLabel(stage)}` : ""}. Elapsed: ${elapsedSeconds}s.`
    : prompt.trim()
      ? "Press Enter to simulate (Shift+Enter for a new line). Every run rolls a new seed, so it never plays out the same way twice."
      : "Describe any situation, or press Enter to run the example. Every run rolls a new seed, so it never plays out the same way twice.";

  return <main className={`simulation-shell view-${view}`}>
    <header className="masthead"><h1 className="wordmark"><span className="brand-icon"><GlobeHemisphereWest size={20} weight="duotone" /></span><span>WORLD<span className="wordmark-slashes">//</span>SIM</span></h1>
      <div className="masthead-actions">
        {view !== "home" && <button type="button" className="demo-button" disabled={busy} onClick={goHome}>New scenario</button>}
      </div>
    </header>

    {view === "home" && <section className="sim-intro" aria-labelledby="intro-title">

      <h2 id="intro-title">What if…?</h2>
      <p>Trace a scenario across the map, one headline at a time.</p>
    </section>}
    {(view === "home" || busy || launch.status === "failed") && <form className="scenario-launch" onSubmit={submit}><label htmlFor="scenario-prompt">Scenario prompt</label>
      <div className="scenario-input-row"><textarea id="scenario-prompt" rows={2} maxLength={2000} value={prompt} disabled={busy}
          placeholder={DEFAULT_PROMPT} aria-describedby="prompt-enter-hint"
          onKeyDown={(e) => {
            // Enter runs the scenario; Shift+Enter adds a line.
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
          onChange={(e) => { setPrompt(e.currentTarget.value); if (launch.status !== "idle") setLaunch({ status: "idle" }); }} />
          <button className="generate-button" type="submit" disabled={busy}>{busy ? "Preparing…" : launch.status === "failed" ? "Try again" : "Simulate"}<ArrowRight size={16} aria-hidden="true" /></button></div>
        <div className="scenario-launch-footer"><p id="prompt-enter-hint" className={launch.status === "failed" ? "launch-error" : undefined} aria-live="polite">{launchMessage}</p>
</div>
      </form>}
    {view === "home" && <ScenarioStarters starters={starters} loading={startersLoading} error={startersError} busy={busy}
      onRetry={() => setReload((n) => n + 1)} onLaunch={(s) => void start({ ...s, tone: nextTone })} />}

    {view === "watch" && <>
      <section className="run-bar" aria-label="Current run">
        <div><span>{isDemo ? "Reference demo · fixed timeline" : run.seed !== undefined ? `Seed ${run.seed}` : "Prompted scenario"}</span><p className="run-bar-title">{run.title}</p></div>
        <div className="run-bar-actions">
          {!isDemo && lastRequest.current && <button type="button" className="demo-button" disabled={busy} onClick={runAgain}>
            <ArrowClockwise size={15} aria-hidden="true" />{busy ? "Preparing…" : "Run again (new seed)"}</button>}
        </div>
      </section>
      <RunConsole key={isDemo ? "demo" : run.id} run={run} isDemo={isDemo} tone={runTone}
        autoStart={autoStart} onRunAgain={!isDemo && lastRequest.current ? runAgain : undefined} />
    </>}
  </main>;
}
