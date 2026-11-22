"use client";

import {
  Alien, ArrowRight, Biohazard, Bug, Fire, GlobeHemisphereWest, Pulse, Radioactive, Robot, SunDim, Virus, Waves,
} from "@phosphor-icons/react";
import { motion, MotionConfig } from "motion/react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { japanDemo } from "../lib/earthquake";
import { listPlayableScenarios, type PlayableScenario } from "../lib/player-api";
import { sampleScenarios, type SampleScenario } from "../lib/samples";
import { prepareScenario } from "../lib/scenario-api";
import { generationStageLabel, type ScenarioRun } from "../lib/scenario";
import { RunConsole } from "./run-console";

type LaunchState = { status: "idle" | "generating" | "ready" } | { status: "failed"; message: string };
type Mode = "default" | "decide";

const hazardIcons = {
  earthquake: Pulse, tsunami: Waves, eruption: Fire, pandemic: Virus, nuclear: Radioactive,
  zombie: Biohazard, alien: Alien, sun: SunDim, insect: Bug, ai: Robot,
} as const;

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

  // The scenario chooser: a hazard plays its default timeline; "You decide"
  // replays it in player mode, where your decisions change what happens next.
  const [selected, setSelected] = useState(sampleScenarios[0].fixture);
  const [mode, setMode] = useState<Mode>("default");
  const [playable, setPlayable] = useState<PlayableScenario[]>([]);
  const [role, setRole] = useState("");
  const [rolesOpen, setRolesOpen] = useState(true);  // collapses while you play a role
  const sample = sampleScenarios.find((item) => item.fixture === selected) ?? sampleScenarios[0];
  // "You decide" plays the scenario's playable chain (#82), not its default timeline.
  const playableScenario = playable.find((item) => item.fixture === sample.playerFixture);
  const roles = playableScenario?.roles ?? [];
  const chosenRole = roles.find((item) => item.id === role) ?? roles[0];
  const prompted = !isDemo && !run.fixture;

  useEffect(() => () => request.current?.abort(), []);

  useEffect(() => {
    const controller = new AbortController();
    listPlayableScenarios(controller.signal).then(setPlayable, () => setPlayable([]));
    return () => controller.abort();
  }, []);

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
    if (!text) return;
    await launchRun(text);
  }

  function playDefault(item: SampleScenario) {
    setSelected(item.fixture);
    setMode("default");
    void launchRun(item.title, { fixture: item.fixture });
  }

  function playAsRole(item = sample, roleId = chosenRole?.id) {
    const scenario = playable.find((entry) => entry.fixture === item.playerFixture);
    const picked = scenario?.roles.find((entry) => entry.id === roleId);
    if (!scenario || !picked) return;
    setSelected(item.fixture);
    setMode("decide");
    setRole(picked.id);
    void launchRun(`${scenario.display_title || scenario.title} · you decide as ${picked.title}`, {
      player: { fixture: scenario.fixture, role: picked.id, roleTitle: picked.title, scenarioTitle: scenario.title },
    });
  }

  function chooseHazard(item: SampleScenario) {
    // A new scenario always opens on its default timeline; in "You decide" the
    // role cards for it appear, ready to start.
    playDefault(item);
    if (mode === "decide" && playable.some((entry) => entry.fixture === item.playerFixture)) setMode("decide");
  }

  async function launchRun(text: string, options: { fixture?: string; player?: ScenarioRun["player"] } = {}) {
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
      }, options.player, options.fixture);
      if (controller.signal.aborted) return;
      setRun(scenario);
      setRolesOpen(!scenario.player);
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
    setSelected(sampleScenarios[0].fixture);
    setMode("default");
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
  const playingDefault = !prompted && !run.player;

  return (
    <main className="simulation-shell">
      <header className="masthead">
        <h1 className="wordmark">
          <span className="brand-icon"><GlobeHemisphereWest size={20} weight="duotone" /></span>
          <span>WORLD<span className="wordmark-slashes">//</span>SIM</span>
        </h1>
        <span className="mode-label">Fictional simulation</span>
      </header>

      <section className="scenario-chooser" aria-labelledby="chooser-title">
        <h2 id="chooser-title" className="visually-hidden">Scenario chooser</h2>
        <div className="chooser-row">
          <span className="chooser-label" id="chooser-scenario">Scenario</span>
          <nav className="sample-scenarios" aria-label="Sample scenarios">
            {sampleScenarios.map((item) => {
              const Icon = hazardIcons[item.hazard];
              return (
                <button key={item.fixture} type="button" className="sample-button" data-hazard={item.hazard}
                  aria-pressed={!prompted && selected === item.fixture} disabled={generating} title={item.title}
                  onClick={() => chooseHazard(item)}>
                  <Icon size={16} weight="duotone" aria-hidden="true" />
                  {item.label}
                </button>
              );
            })}
          </nav>
        </div>

        <div className="chooser-row">
          <span className="chooser-label" id="chooser-mode">How it plays</span>
          <div className="mode-switch" role="radiogroup" aria-labelledby="chooser-mode">
            <button type="button" role="radio" aria-checked={mode === "default"} disabled={generating}
              onClick={() => {
                setMode("default");
                if (run.player || prompted) playDefault(sample);
              }}>
              Default timeline
            </button>
            <button type="button" role="radio" aria-checked={mode === "decide"} disabled={generating || roles.length === 0}
              title={roles.length === 0 ? "No decisions are written for this scenario yet" : undefined}
              onClick={() => { setMode("decide"); setRolesOpen(true); }}>
              You decide
            </button>
          </div>
        </div>
        {mode === "decide" && run.player && !rolesOpen && (
          <div className="chooser-row">
            <span className="chooser-label">Your role</span>
            <strong className="current-role">{run.player.roleTitle}</strong>
            <button type="button" className="demo-button" onClick={() => setRolesOpen(true)}>Change role</button>
          </div>
        )}
        {mode === "decide" && playableScenario && chosenRole && (!run.player || rolesOpen) && (
          <div className="decide-panel" id="scenario-roles">
            <div className="role-grid" role="radiogroup" aria-label="Your role">
              {roles.map((item) => (
                <button key={item.id} type="button" role="radio" aria-checked={item.id === chosenRole.id} disabled={generating}
                  onClick={() => setRole(item.id)}>
                  <strong>{item.title}</strong><span>{item.responsibilities || item.summary}</span>
                </button>
              ))}
            </div>
            <section className="mission-briefing" aria-label="Mission briefing">
              <p className="alt-kicker">SIMULATED · {playableScenario.display_title || playableScenario.title} · your decisions</p>
              <h3>Your mission as {chosenRole.title}</h3>
              <p>{playableScenario.briefing || playableScenario.summary}</p>
              <p>{chosenRole.perspective || chosenRole.summary} The run stops when something big happens; your choices
                rewrite what comes next, and at the end you see your timeline next to the one where nobody intervenes.</p>
              {chosenRole.emphasis && chosenRole.emphasis.length > 0 && (
                <p>Watch: {chosenRole.emphasis.map((name) => playableScenario.outcomes?.find((o) => o.name === name)?.label || name).join(", ")}.</p>
              )}
              <button type="button" className="play-role-button" disabled={generating} onClick={() => playAsRole()}>
                {run.player?.fixture === playableScenario.fixture && run.player.role === chosenRole.id ? "Restart with my decisions" : "Start with my decisions"}
              </button>
            </section>
          </div>
        )}
        <p className="chooser-note">
          {mode === "decide" && chosenRole
            ? <>Choose a role, read the briefing, then start. You can switch back to the default timeline at any time.</>
            : playingDefault
              ? <>Playing the default timeline: no one intervenes. Choose <strong>You decide</strong> to change how it plays out.</>
              : <>Pick a scenario to play its default timeline.</>}
        </p>
      </section>

      <form className="scenario-launch" onSubmit={submit}>
        <label htmlFor="scenario-prompt">Or describe your own scenario</label>
        <div className="scenario-input-row">
          <textarea
            id="scenario-prompt"
            aria-label="Scenario prompt"
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

      <RunConsole key={isDemo ? "demo" : run.id} run={run} isDemo={isDemo}
        onSelectRole={() => {
          const item = sampleScenarios.find((entry) => entry.playerFixture === run.player?.fixture);
          if (item) setSelected(item.fixture);
          setMode("decide");
          setRolesOpen(true);
          requestAnimationFrame(() => {
            document.querySelector(".scenario-chooser")?.scrollIntoView({ behavior: "auto", block: "start" });
            document.querySelector<HTMLButtonElement>('#scenario-roles [role="radio"][aria-checked="true"]')?.focus();
          });
        }}
        onRestart={run.player ? () => {
          const item = sampleScenarios.find((entry) => entry.playerFixture === run.player?.fixture);
          if (item) playAsRole(item, run.player?.role);
        } : undefined} />
    </main>
  );
}
