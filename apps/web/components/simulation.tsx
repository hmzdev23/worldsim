"use client";

import { ArrowClockwise, ArrowRight, GlobeHemisphereWest } from "@phosphor-icons/react";
import { MotionConfig } from "motion/react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { japanDemo } from "../lib/earthquake";
import { listStarters, pauseRun, prepareScenario } from "../lib/scenario-api";
import { generationStageLabel, tones, type ScenarioRun, type Starter, type Tone } from "../lib/scenario";
import { RunConsole } from "./run-console";
import { ScenarioStarters, type StarterLaunch } from "./scenario-starters";
import { ToneSelector } from "./tone-selector";

const toneKey = "worldsim:tone";
function storedTone(): Tone | undefined {
  try {
    const value = window.localStorage.getItem(toneKey);
    return tones.some((tone) => tone.value === value) ? value as Tone : undefined;
  } catch {
    return undefined;
  }
}
function storeTone(tone: Tone) {
  try { window.localStorage.setItem(toneKey, tone); } catch { /* private mode: not remembered */ }
}

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
  // The tone for the next run, and the tone each run is watched in.
  const [nextTone, setNextTone] = useState<Tone>("straight");
  const [toneByRun, setToneByRun] = useState<Record<string, Tone>>({});
  const request = useRef<AbortController | null>(null);
  const lastRequest = useRef<Request | null>(null);
  const preparingSince = useRef<number | undefined>(undefined);
  const busy = launch.status === "generating";
  const isDemo = run === japanDemo;
  const runTone: Tone = toneByRun[run.id] ?? (isDemo ? nextTone : run.tone ?? "straight");
  // On the home screen the selector sets the next run's tone; while watching, the current run's.
  const shownTone: Tone = view === "home" ? nextTone : runTone;

  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    const remembered = storedTone();
    if (remembered) setNextTone(remembered);
  }, []);
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

  function chooseTone(tone: Tone) {
    setNextTone(tone);
    setToneByRun((previous) => ({ ...previous, [run.id]: tone }));
    storeTone(tone);
  }
  function pauseCurrent() {
    if (view === "watch" && !isDemo) void pauseRun(run.id).catch(() => {});
  }
  function goHome() {
    pauseCurrent(); setLaunch({ status: "idle" }); setView("home");
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  async function start(next: Request) {
    if (!next.prompt || request.current) return;
    const controller = new AbortController();
    request.current = controller; preparingSince.current = Date.now(); lastRequest.current = next;
    setLaunch({ status: "generating" }); setElapsedSeconds(0); setStage(undefined);
    try {
      const scenario = await prepareScenario(next.prompt, controller.signal,
        (p) => { if (!controller.signal.aborted) setStage(p.stage); }, next.tone, next.fixture);
      if (controller.signal.aborted) return;
      pauseCurrent();
      setToneByRun((previous) => ({ ...previous, [scenario.id]: scenario.tone ?? next.tone }));
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
  function loadDemo() {
    pauseCurrent(); request.current?.abort(); request.current = null; lastRequest.current = null;
    setRun(japanDemo); setAutoStart(false); setLaunch({ status: "idle" }); setView("watch");
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void start({ prompt: prompt.trim(), tone: nextTone });
  }

  const launchMessage = launch.status === "failed" ? launch.message : busy
    ? `Preparing a new run${stage ? ` · ${generationStageLabel(stage)}` : ""}. Elapsed: ${elapsedSeconds}s.`
    : "Describe any situation. Every run rolls a new seed, so it never plays out the same way twice.";

  return <main className={`simulation-shell view-${view}`}>
    <header className="masthead"><h1 className="wordmark"><span className="brand-icon"><GlobeHemisphereWest size={20} weight="duotone" /></span><span>WORLD<span className="wordmark-slashes">//</span>SIM</span></h1>
      <div className="masthead-actions">
        <span className="mode-label">{runTone === "straight" ? "Fictional simulation" : "Fictional simulation · satire"}</span>
        {view !== "home" && <button type="button" className="demo-button" disabled={busy} onClick={goHome}>New scenario</button>}
      </div>
    </header>

    {view === "home" && <section className="sim-intro" aria-labelledby="intro-title">
      <p className="alt-kicker">An open-ended world simulation</p>
      <h2 id="intro-title">What if…?</h2>
      <p>Describe a situation and watch the world respond on the map. Run it again and a different, plausible future unfolds.</p>
    </section>}
    <form className="scenario-launch" onSubmit={submit}><label htmlFor="scenario-prompt">Scenario prompt</label>
      <div className="scenario-input-row"><textarea id="scenario-prompt" rows={2} maxLength={2000} required value={prompt} disabled={busy}
          placeholder="What if a volcanic eruption closed Iceland’s main airport for two days?"
          onChange={(e) => { setPrompt(e.currentTarget.value); if (launch.status !== "idle") setLaunch({ status: "idle" }); }} />
          <button className="generate-button" type="submit" disabled={busy || !prompt.trim()}>{busy ? "Preparing…" : launch.status === "failed" ? "Try again" : "Simulate"}<ArrowRight size={16} aria-hidden="true" /></button></div>
        <div className="scenario-tone-row">
          <span id="tone-label">Tone</span>
          <ToneSelector value={shownTone} onChange={chooseTone} />
          <span className="tone-hint">{shownTone === "straight" ? "Serious presentation." : "Satire is a fictional presentation layer. Facts and impact estimates stay unchanged."}</span>
        </div>
        <div className="scenario-launch-footer"><p className={launch.status === "failed" ? "launch-error" : undefined} aria-live="polite">{launchMessage}</p>
          <button className="demo-button" type="button" onClick={loadDemo}>Japan demo</button></div>
      </form>
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
