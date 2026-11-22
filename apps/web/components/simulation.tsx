"use client";

import { ArrowRight, GlobeHemisphereWest } from "@phosphor-icons/react";
import { motion, MotionConfig } from "motion/react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { japanDemo } from "../lib/earthquake";
import { prepareScenario } from "../lib/scenario-api";
import { generationStageLabel, tones, type ScenarioRun, type Tone } from "../lib/scenario";
import { RunConsole } from "./run-console";
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

type LaunchState = { status: "idle" | "generating" | "ready" } | { status: "failed"; message: string };

export function Simulation() {
  return <MotionConfig reducedMotion="user"><ScenarioWorkspace /></MotionConfig>;
}

function ScenarioWorkspace() {
  const [prompt, setPrompt] = useState("");
  const [run, setRun] = useState<ScenarioRun>(japanDemo);
  const [launch, setLaunch] = useState<LaunchState>({ status: "idle" });
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [stage, setStage] = useState<string | undefined>(undefined);
  // The tone for the next run, and the tone each run was watched in (persisted per run).
  const [nextTone, setNextTone] = useState<Tone>("straight");
  const [toneByRun, setToneByRun] = useState<Record<string, Tone>>({});
  const request = useRef<AbortController | null>(null);
  const preparingSince = useRef<number | undefined>(undefined);
  const generating = launch.status === "generating";
  const isDemo = run === japanDemo;

  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    const remembered = storedTone();
    if (remembered) setNextTone(remembered);
  }, []);
  const runTone: Tone = toneByRun[run.id] ?? (isDemo ? nextTone : run.tone ?? "straight");

  function chooseTone(tone: Tone) {
    setNextTone(tone);
    setToneByRun((previous) => ({ ...previous, [run.id]: tone }));
    storeTone(tone);
  }

  useEffect(() => {
    if (!generating || preparingSince.current === undefined) return;
    const updateElapsed = () => setElapsedSeconds(Math.floor((Date.now() - preparingSince.current!) / 1000));
    updateElapsed();
    const timer = setInterval(updateElapsed, 1000);
    return () => clearInterval(timer);
  }, [generating]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = prompt.trim();
    if (!text || request.current) return;

    const controller = new AbortController();
    request.current = controller;
    preparingSince.current = Date.now();
    setElapsedSeconds(0);
    setStage(undefined);
    setLaunch({ status: "generating" });
    try {
      const scenario = await prepareScenario(text, controller.signal, (progress) => {
        if (!controller.signal.aborted) setStage(progress.stage);
      }, nextTone);
      if (controller.signal.aborted) return;
      setToneByRun((previous) => ({ ...previous, [scenario.id]: scenario.tone ?? nextTone }));
      setRun(scenario);
      setElapsedSeconds(Math.floor((Date.now() - (preparingSince.current ?? Date.now())) / 1000));
      setLaunch({ status: "ready" });
    } catch (error) {
      if (!controller.signal.aborted) {
        setLaunch({
          status: "failed",
          message: error instanceof Error ? error.message : "The scenario could not be prepared. Try again.",
        });
      }
    } finally {
      if (request.current === controller) request.current = null;
    }
  }

  function loadDemo() {
    request.current?.abort();
    request.current = null;
    preparingSince.current = undefined;
    setElapsedSeconds(0);
    setRun(japanDemo);
    setLaunch({ status: "idle" });
  }

  const elapsedLabel = elapsedSeconds >= 60
    ? `${Math.floor(elapsedSeconds / 60)}m ${String(elapsedSeconds % 60).padStart(2, "0")}s`
    : `${elapsedSeconds}s`;
  const launchMessage = launch.status === "failed" ? launch.message
    : launch.status === "generating"
      ? `Preparing a scenario${stage ? ` · ${generationStageLabel(stage)}` : ""}. Elapsed: ${elapsedLabel}. The current run stays open.`
      : launch.status === "ready" ? `Scenario loaded · prepared in ${elapsedLabel}.`
        : "Describe a hypothetical event, where it happens, and what changes.";

  return (
    <main className="simulation-shell">
      <header className="masthead">
        <h1 className="wordmark">
          <span className="brand-icon"><GlobeHemisphereWest size={20} weight="duotone" /></span>
          <span>WORLD<span className="wordmark-slashes">//</span>SIM</span>
        </h1>
        <span className="mode-label">{runTone === "straight" ? "Fictional simulation" : "Fictional simulation · satire"}</span>
      </header>

      <form className="scenario-launch" onSubmit={submit}>
        <label htmlFor="scenario-prompt">Scenario prompt</label>
        <div className="scenario-input-row">
          <textarea
            id="scenario-prompt"
            rows={2}
            maxLength={2000}
            required
            value={prompt}
            disabled={generating}
            placeholder="What if a volcanic eruption closed Iceland’s main airport for two days?"
            onChange={(event) => {
              setPrompt(event.currentTarget.value);
              if (launch.status !== "idle") setLaunch({ status: "idle" });
            }}
          />
          <motion.button
            className="generate-button"
            type="submit"
            disabled={generating || !prompt.trim()}
            whileTap={{ scale: 0.97 }}
            transition={{ duration: 0.12 }}
          >
            {generating ? "Preparing…" : launch.status === "failed" ? "Try again" : "Generate scenario"}
            <ArrowRight size={16} aria-hidden="true" />
          </motion.button>
        </div>
        <div className="scenario-tone-row">
          <span id="tone-label">Tone</span>
          <ToneSelector value={runTone} onChange={chooseTone} />
          <span className="tone-hint">
            {runTone === "straight" ? "Serious presentation." : "Satire is a fictional presentation layer. Facts and impact estimates stay unchanged."}
          </span>
        </div>
        <div className="scenario-launch-footer">
          <p className={launch.status === "failed" ? "launch-error" : undefined} aria-live="polite">{launchMessage}</p>
          <button className="demo-button" type="button" onClick={loadDemo} disabled={isDemo && launch.status === "idle"}>
            Japan demo
          </button>
        </div>
      </form>

      <RunConsole key={isDemo ? "demo" : run.id} run={run} isDemo={isDemo} tone={runTone} />
    </main>
  );
}
