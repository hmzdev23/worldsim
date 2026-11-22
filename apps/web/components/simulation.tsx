"use client";

import { ArrowRight, GlobeHemisphereWest } from "@phosphor-icons/react";
import { MotionConfig } from "motion/react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { japanDemo } from "../lib/earthquake";
import { controlRun, listPlayableScenarios, type PlayableScenario } from "../lib/player-api";
import { prepareScenario } from "../lib/scenario-api";
import { generationStageLabel, type ScenarioRun } from "../lib/scenario";
import { RunConsole } from "./run-console";
import { ScenarioOnboarding, type SetupStep, type GamePace } from "./scenario-onboarding";

type View = "welcome" | "setup" | "game" | "watch";
type LaunchState = {status: "idle" | "generating" | "ready"} | {status: "failed"; message: string};
export function Simulation() { return <MotionConfig reducedMotion="user"><ScenarioWorkspace/></MotionConfig>; }

function ScenarioWorkspace() {
  const [view,setView] = useState<View>("welcome");
  const [step,setStep] = useState<SetupStep>(1);
  const [prompt,setPrompt] = useState("");
  const [run,setRun] = useState<ScenarioRun>(japanDemo);
  const [launch,setLaunch] = useState<LaunchState>({status:"idle"});
  const [playable,setPlayable] = useState<PlayableScenario[]>([]);
  const [catalogueError,setCatalogueError] = useState<string>();
  const [catalogueLoading,setCatalogueLoading] = useState(true);
  const [reload,setReload] = useState(0);
  const [fixture,setFixture] = useState("");
  const [roleId,setRoleId] = useState("");
  const [pace,setPace] = useState<GamePace>("demo");
  const [runPace,setRunPace] = useState<GamePace>("demo");
  const [autoStart,setAutoStart] = useState(false);
  const [coach,setCoach] = useState(true);
  const [elapsedSeconds,setElapsedSeconds] = useState(0);
  const [stage,setStage] = useState<string>();
  const request = useRef<AbortController | null>(null);
  const preparingSince = useRef<number | undefined>(undefined);
  const busy = launch.status === "generating";
  const isDemo = run === japanDemo;
  const selected = playable.find(s=>s.fixture===fixture);
  useEffect(()=>()=>request.current?.abort(),[]);
  useEffect(()=>{
    const controller=new AbortController(); setCatalogueLoading(true); setCatalogueError(undefined);
    listPlayableScenarios(controller.signal).then(scenarios=>{
      if(controller.signal.aborted)return;
      const order=["tsunami","iceland-eruption","japan-earthquake","nuclear-war","global-pandemic","zombie-outbreak","alien-invasion","sun-disappearing","giant-insect-mutation","ai-takeover"];
      setPlayable(scenarios.sort((a,b)=>order.indexOf(a.fixture)-order.indexOf(b.fixture))); setCatalogueLoading(false);
    },()=>{if(!controller.signal.aborted){setCatalogueError("We couldn’t connect to the simulation. Check that the local server is running, then try again.");setCatalogueLoading(false);}});
    return ()=>controller.abort();
  },[reload]);
  useEffect(()=>{
    if(!busy)return;
    const timer=setInterval(()=>setElapsedSeconds(Math.floor((Date.now()-(preparingSince.current ?? Date.now()))/1000)),1000);
    return ()=>clearInterval(timer);
  },[busy]);

  function pauseCurrent() {
    if(view!=="game" && view!=="watch")return;
    if(!isDemo) void controlRun(run.id,{action:"pause"}).catch(()=>{});
  }
  function setup(target:SetupStep=1) {
    pauseCurrent(); setAutoStart(false); setLaunch({status:"idle"});
    if(run.player && target===2){setFixture(run.player.fixture);setRoleId(run.player.role);}
    setStep(target);setView("setup");window.scrollTo({top:0,behavior:"instant"});
  }
  async function start(text:string, player?:ScenarioRun["player"]) {
    if(!text || request.current)return;
    const controller=new AbortController();request.current=controller;preparingSince.current=Date.now();
    setLaunch({status:"generating"});setElapsedSeconds(0);setStage(undefined);
    try {
      const next=await prepareScenario(text,controller.signal,p=>{if(!controller.signal.aborted)setStage(p.stage);},player);
      if(controller.signal.aborted)return;
      setRun(next);setRunPace(pace);setAutoStart(!!player);setCoach(true);setView(player ? "game" : "watch");setLaunch({status:"ready"});
    } catch(error) {
      if(!controller.signal.aborted)setLaunch({status:"failed",message:error instanceof Error ? error.message : "We couldn’t prepare this world. Please try again."});
    } finally {if(request.current===controller)request.current=null;}
  }
  function playAsRole(scenario=selected, id=roleId) {
    const role=scenario?.roles.find(r=>r.id===id);if(!scenario || !role)return;
    void start(`Player mode: ${scenario.title} as ${role.title}`,{fixture:scenario.fixture,role:role.id,roleTitle:role.title,scenarioTitle:scenario.title});
  }
  function loadDemo() {
    pauseCurrent();request.current?.abort();request.current=null;
    setRun(japanDemo);setAutoStart(false);setLaunch({status:"idle"});setView("watch");
  }
  function submit(event:FormEvent<HTMLFormElement>) {event.preventDefault();void start(prompt.trim());}
  const launchMessage=launch.status==="failed" ? launch.message : busy
    ? `Preparing a scenario${stage ? ` · ${generationStageLabel(stage)}` : ""}. Elapsed: ${elapsedSeconds}s. The current run stays open.`
    : launch.status==="ready" ? "Scenario ready." : "Describe a hypothetical crisis to watch it unfold.";

  return <main className={`simulation-shell view-${view}`}>
    <header className="masthead"><h1 className="wordmark"><span className="brand-icon"><GlobeHemisphereWest size={20} weight="duotone"/></span><span>WORLD<span className="wordmark-slashes">//</span>SIM</span></h1>
      <div className="masthead-actions"><span className="mode-label">Fictional simulation</span>{view!=="welcome" && <button type="button" className="demo-button" disabled={busy} onClick={()=>{pauseCurrent();setView("welcome");}}>Home</button>}</div>
    </header>

    {view==="welcome" && <section className="game-welcome" aria-labelledby="welcome-title">
      <div className="welcome-copy"><p className="alt-kicker">An interactive crisis game</p><h2 id="welcome-title">One crisis.<br/><span>Your decisions.</span></h2>
        <p className="welcome-description">Step into a role. Follow the news.<br/>Decide what happens next.</p>
        <button type="button" className="setup-primary welcome-start" onClick={()=>setup(1)}>Start playing<ArrowRight size={20} aria-hidden="true"/></button>
        <button type="button" className="welcome-demo" disabled={!playable.some(s=>s.fixture==="alien-invasion")} onClick={()=>{setFixture("alien-invasion");setRoleId("diplomat");setPace("demo");setLaunch({status:"idle"});setStep(3);setView("setup");}}>Quick demo: first contact <ArrowRight size={15} aria-hidden="true"/></button>
        <p className="welcome-facts">10 scenarios <span>·</span> 50 roles <span>·</span> Your choices shape the story</p>
      </div>
      <div className="welcome-art" aria-hidden="true"><div className="welcome-globe"><GlobeHemisphereWest weight="thin"/></div>
        <div className="welcome-signal signal-news"><i/>BREAKING NEWS<span>An unfamiliar world unfolds.</span></div>
        <div className="welcome-signal signal-decision"><span className="signal-number">?</span>DECISION REQUIRED<span>What will you do?</span></div>
        <div className="welcome-orbit orbit-one"/><div className="welcome-orbit orbit-two"/>
      </div>
      <footer className="welcome-alternatives"><span>Prefer to explore?</span><button type="button" onClick={loadDemo}>Watch a simulation</button><button type="button" onClick={()=>{loadDemo();requestAnimationFrame(()=>document.getElementById("scenario-prompt")?.focus());}}>Create your own scenario</button></footer>
    </section>}

    {view==="setup" && <ScenarioOnboarding scenarios={playable} fixture={fixture} roleId={roleId} step={step} pace={pace}
      busy={busy} loading={catalogueLoading} error={launch.status==="failed" ? launch.message : catalogueError}
      onRetry={()=>setReload(n=>n+1)} onScenario={id=>{if(id!==fixture)setRoleId("");setFixture(id);}}
      onRole={setRoleId} onStep={next=>{setLaunch({status:"idle"});setStep(next);}} onPace={setPace} onStart={()=>playAsRole()}
      onBack={()=>{setLaunch({status:"idle"});step===1 ? setView("welcome") : setStep((step-1) as SetupStep);}}/>}

    {view==="watch" && <>
      <div className="watch-heading"><h2>Explore a simulation</h2><button type="button" className="demo-button" onClick={()=>setup(1)}>Play a role instead</button></div>
      <form className="scenario-launch" onSubmit={submit}><label htmlFor="scenario-prompt">Scenario prompt</label>
        <div className="scenario-input-row"><textarea id="scenario-prompt" rows={2} maxLength={2000} required value={prompt} disabled={busy}
          placeholder="What if a volcanic eruption closed Iceland’s main airport for two days?" onChange={e=>{setPrompt(e.currentTarget.value);if(launch.status!=="idle")setLaunch({status:"idle"});}}/>
          <button className="generate-button" type="submit" disabled={busy || !prompt.trim()}>{busy ? "Preparing…" : launch.status==="failed" ? "Try again" : "Generate scenario"}<ArrowRight size={16} aria-hidden="true"/></button></div>
        <div className="scenario-launch-footer"><p className={launch.status==="failed" ? "launch-error" : undefined} aria-live="polite">{launchMessage}</p>
          <button className="demo-button" type="button" onClick={loadDemo} disabled={isDemo && launch.status==="idle"}>Japan demo</button></div>
      </form>
    </>}

    {view==="game" && run.player && <>
      <section className="mission-strip" aria-label="Your mission"><div><span>{run.player.scenarioTitle}</span><h2>{run.player.roleTitle}</h2></div><button type="button" className="demo-button" onClick={()=>setup(1)}>New game</button></section>
      {coach && <div className="game-coach" role="status"><p><strong>You’re in charge.</strong> Follow the news. When it’s time to decide, the clock pauses for you.</p><button type="button" onClick={()=>setCoach(false)}>Got it</button></div>}
    </>}
    {(view==="game" || view==="watch") && <RunConsole key={isDemo ? "demo" : run.id} run={run} isDemo={isDemo}
      autoStart={autoStart} initialSpeed={runPace==="demo" ? 4 : 1}
      onSelectRole={()=>setup(2)} onSelectScenario={()=>setup(1)}
      onRestart={run.player ? ()=>playAsRole(playable.find(s=>s.fixture===run.player?.fixture),run.player?.role) : undefined}/>}
  </main>;
}
