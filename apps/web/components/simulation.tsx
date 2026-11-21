"use client";

import { ArrowRight, GlobeHemisphereWest } from "@phosphor-icons/react";
import { motion, MotionConfig } from "motion/react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { japanDemo } from "../lib/earthquake";
import { prepareScenario } from "../lib/scenario-api";
import { generationStageLabel, type ScenarioRun } from "../lib/scenario";
import { RunConsole } from "./run-console";

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
  const request = useRef<AbortController | null>(null);
  const preparingSince = useRef<number | undefined>(undefined);
  const generating = launch.status === "generating";
  const isDemo = run === japanDemo;

  useEffect(() => () => request.current?.abort(), []);

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
      });
      if (controller.signal.aborted) return;
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
        <span className="mode-label">Fictional simulation</span>
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
        <div className="scenario-launch-footer">
          <p className={launch.status === "failed" ? "launch-error" : undefined} aria-live="polite">{launchMessage}</p>
          <button className="demo-button" type="button" onClick={loadDemo} disabled={isDemo && launch.status === "idle"}>
            Japan demo
          </button>
        </div>
      </form>

      <RunConsole key={isDemo ? "demo" : run.id} run={run} isDemo={isDemo} />
    </main>
  );
}
