"use client";

import { ArrowRight, GlobeHemisphereWest } from "@phosphor-icons/react";
import { motion, MotionConfig } from "motion/react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { japanDemo } from "../lib/earthquake";
import { listPlayableScenarios, type PlayableScenario } from "../lib/player-api";
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
  const [playable, setPlayable] = useState<PlayableScenario[]>([]);
  const [playFixture, setPlayFixture] = useState("");
  const [playRole, setPlayRole] = useState("");

  useEffect(() => () => request.current?.abort(), []);

  // Player mode (prototype): offline scenarios with a player spec, and their roles.
  useEffect(() => {
    const controller = new AbortController();
    listPlayableScenarios(controller.signal).then((scenarios) => {
      setPlayable(scenarios);
      setPlayFixture((current) => current || scenarios[0]?.fixture || "");
      setPlayRole((current) => current || scenarios[0]?.roles[0]?.id || "");
    }, () => setPlayable([]));
    return () => controller.abort();
  }, []);
  const chosenScenario = playable.find((item) => item.fixture === playFixture);

  useEffect(() => {
    if (!generating || preparingSince.current === undefined) return;
    const updateElapsed = () => setElapsedSeconds(Math.floor((Date.now() - preparingSince.current!) / 1000));
    updateElapsed();
    const timer = setInterval(updateElapsed, 1000);
    return () => clearInterval(timer);
  }, [generating]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await start(prompt.trim());
  }

  function playAsRole(scenario = chosenScenario, roleId = playRole) {
    const role = scenario?.roles.find((item) => item.id === roleId);
    if (!scenario || !role) return;
    void start(`Player mode: ${scenario.title} as ${role.title}`, {
      fixture: scenario.fixture, role: role.id, roleTitle: role.title, scenarioTitle: scenario.title,
    });
  }

  async function start(text: string, player?: ScenarioRun["player"]) {
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
      }, player);
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

      {playable.length > 0 && (
        <section className="player-launch" aria-labelledby="player-launch-title">
          <h2 id="player-launch-title">Play a role <span>Simulated · fictional roles and choices</span></h2>
          <div className="player-launch-row">
            <label>
              Scenario
              <select id="player-scenario" value={playFixture} disabled={generating} onChange={(event) => {
                const next = playable.find((item) => item.fixture === event.currentTarget.value);
                setPlayFixture(event.currentTarget.value);
                setPlayRole(next?.roles[0]?.id ?? "");
              }}>
                {playable.map((item) => <option key={item.fixture} value={item.fixture}>{item.title}</option>)}
              </select>
            </label>
            <label>
              Role
              <select id="player-role" value={playRole} disabled={generating}
                onChange={(event) => setPlayRole(event.currentTarget.value)}>
                {(chosenScenario?.roles ?? []).map((role) => <option key={role.id} value={role.id}>{role.title}</option>)}
              </select>
            </label>
            <button type="button" className="play-role-button" disabled={generating || !playRole} onClick={() => playAsRole()}>
              Play this role
            </button>
          </div>
          {chosenScenario && <p>{chosenScenario.summary} {chosenScenario.roles.find((r) => r.id === playRole)?.summary}</p>}
        </section>
      )}

      <RunConsole key={isDemo ? "demo" : run.id} run={run} isDemo={isDemo}
        onRestart={run.player ? () => {
          const scenario = playable.find((item) => item.fixture === run.player?.fixture);
          playAsRole(scenario, run.player?.role);
        } : undefined} />
    </main>
  );
}
