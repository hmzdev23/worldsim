import { ArrowLeft, ArrowRight, Check } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import countries from "../lib/countries.json";
import type { PlayableScenario } from "../lib/player-api";

export type SetupStep = 1 | 2 | 3;
export type GamePace = "demo" | "full";
export function ScenarioOnboarding({scenarios, fixture, roleId, step, pace, busy, error, loading, onRetry,
  onScenario, onRole, onStep, onBack, onPace, onStart, onWatch}: {
  scenarios: PlayableScenario[]; fixture: string; roleId: string; step: SetupStep; pace: GamePace;
  busy: boolean; error?: string; loading: boolean; onRetry: () => void;
  onScenario: (id: string) => void; onRole: (id: string) => void; onStep: (step: SetupStep) => void;
  onBack: () => void; onPace: (pace: GamePace) => void; onStart: () => void;
  onWatch: (prompt: string, fixture?: string) => void;
}) {
  const selected = scenarios.find(s => s.fixture === fixture);
  const [countryA, setCountryA] = useState("");
  const [countryB, setCountryB] = useState("");
  const [custom, setCustom] = useState(false);
  const [changeA, setChangeA] = useState("");
  const [changeB, setChangeB] = useState("");
  const nuclear = fixture === "nuclear-war";
  const countriesValid = !nuclear || (!!countryA.trim() && !!countryB.trim() && countryA.trim().toLocaleLowerCase() !== countryB.trim().toLocaleLowerCase());
  const changes = [changeA.trim(), changeB.trim()].filter(Boolean);
  const canWatch = !!selected && countriesValid && (!custom || changes.length > 0);
  function watch() {
    if (!selected || !canWatch) return;
    const base = nuclear
      ? `A hypothetical nuclear war between ${countryA.trim()} and ${countryB.trim()}. Show the crisis and its consequences over time.`
      : selected.title;
    const prompt = custom ? `${base}\nChanges to the scenario: ${changes.join("; ")}.` : base;
    onWatch(prompt, nuclear || custom ? undefined : selected.fixture);
  }
  const role = selected?.roles.find(r => r.id === roleId);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); window.scrollTo({top: 0, behavior: "instant"}); }, [step]);
  const titles = ["Choose your crisis.", "Who will you be?", "Your mission starts here."];
  return <section className="onboarding" aria-label="Game setup">
    <nav className="setup-progress" aria-label="Setup progress"><ol>
      {["Scenario", "Role", "Briefing"].map((title,i) => <li key={title} aria-current={step === i+1 ? "step" : undefined} data-complete={step > i+1}>
        <span>{step > i+1 ? <Check size={14} aria-hidden="true"/> : i+1}</span>{title}
      </li>)}
    </ol><span>Step {step} of 3</span></nav>
    <header className="setup-heading"><p className="alt-kicker">{step === 1 ? "Pick a world to step into" : selected?.display_title || selected?.title}</p>
      <h2 ref={heading} tabIndex={-1}>{titles[step-1]}</h2>
      <p>{step === 1 ? "Every story is fictional. Your choices change what happens next." : step === 2 ? "Your role changes the decisions you can make." : "You’ll watch the story unfold, then take the lead at critical moments."}</p>
    </header>
    {step === 1 && <div className="setup-scenarios" role="group" aria-label="Scenarios">
      {scenarios.map(s => <button type="button" key={s.fixture} disabled={busy} aria-pressed={fixture === s.fixture}
        className="setup-scenario" onClick={() => onScenario(s.fixture)}>
        <span className="setup-scenario-icon" aria-hidden="true">{s.icon}</span>
        <span className="setup-category">{s.category}</span><strong>{s.display_title || s.title}</strong>
        <span className="setup-selection" aria-hidden="true">{fixture === s.fixture && <Check size={14}/>}</span>
      </button>)}
    </div>}
    {step === 1 && selected && <p className="setup-context" aria-live="polite"><strong>{selected.display_title || selected.title}.</strong> {selected.summary}</p>}
    {step === 1 && selected && <section className="watch-setup" aria-label="Watch this scenario">
      <div><p className="alt-kicker">Watch it unfold</p><h3>Start with a default simulation</h3>
        <p>Watch the scenario play out, or change up to two details to explore a variation.</p></div>
      {nuclear && <div className="watch-inputs">
        <label>First country<select value={countryA} disabled={busy} onChange={e=>setCountryA(e.currentTarget.value)}><option value="">Choose a country</option>{countries.map(country=><option key={country} value={country}>{country}</option>)}</select></label>
        <label>Second country<select value={countryB} disabled={busy} onChange={e=>setCountryB(e.currentTarget.value)}><option value="">Choose a country</option>{countries.map(country=><option key={country} value={country}>{country}</option>)}</select></label>
        {countryA.trim() && countryB.trim() && !countriesValid && <p className="watch-input-note">Choose two different countries.</p>}
      </div>}
      <fieldset className="watch-mode"><legend>Simulation type</legend>
        <label><input type="radio" name="watch-mode" checked={!custom} disabled={busy} onChange={()=>setCustom(false)}/> Default</label>
        <label><input type="radio" name="watch-mode" checked={custom} disabled={busy} onChange={()=>setCustom(true)}/> Make a variation</label>
      </fieldset>
      {custom && <div className="watch-inputs">
        <label>Change one detail<input value={changeA} maxLength={400} disabled={busy} onChange={e=>setChangeA(e.currentTarget.value)} placeholder="Describe what changes" /></label>
        <label>Change another detail <span>(optional)</span><input value={changeB} maxLength={400} disabled={busy} onChange={e=>setChangeB(e.currentTarget.value)} placeholder="Add a second change" /></label>
      </div>}
      {(nuclear || custom) && <p className="watch-input-note">This run is generated for your choices. Runs can vary, so differences may not come only from your changes.</p>}
      <button type="button" className="setup-primary watch-start" disabled={busy || !canWatch} onClick={watch}>{busy ? "Preparing your world…" : custom ? "Watch variation" : "Watch default simulation"}<ArrowRight size={18} aria-hidden="true"/></button>
    </section>}
    {step === 2 && selected && <div className="setup-roles" role="group" aria-label="Playable roles">
      {selected.roles.map(r => <button type="button" key={r.id} disabled={busy} aria-pressed={roleId === r.id} onClick={() => onRole(r.id)}>
        <span className="setup-role-mark" aria-hidden="true">{roleId === r.id ? <Check size={18}/> : r.title.split(" ").map(w=>w[0]).slice(0,2).join("").toUpperCase()}</span>
        <span><strong>{r.title}</strong><span>{r.responsibilities || r.summary}</span></span>
      </button>)}
    </div>}
    {step === 3 && selected && role && <>
      <section className="setup-briefing" aria-label="Mission briefing">
        <div className="briefing-emblem" aria-hidden="true">{selected.icon}</div>
        <div><p className="alt-kicker">{selected.display_title || selected.title}</p><h3>You are the {role.title.toLowerCase()}.</h3>
          <p>{selected.briefing || selected.summary}</p>
          <p className="briefing-mandate"><strong>Your responsibility</strong> {role.responsibilities || role.summary}</p>
        </div>
      </section>
      <ol className="how-to-play" aria-label="How to play">
        <li><span>01</span><strong>Follow the story</strong><p>The news and map show what’s happening.</p></li>
        <li><span>02</span><strong>Make the call</strong><p>The clock pauses so you can read and choose.</p></li>
        <li><span>03</span><strong>See your impact</strong><p>Compare your ending with doing nothing.</p></li>
      </ol>
      <fieldset className="setup-pace"><legend>How much time do you have?</legend>
        <label data-selected={pace === "demo"}><input type="radio" name="pace" value="demo" checked={pace === "demo"} disabled={busy} onChange={() => onPace("demo")}/><span><strong>Quick presentation</strong><small>A shorter run. Readable news. Every decision.</small></span></label>
        <label data-selected={pace === "full"}><input type="radio" name="pace" value="full" checked={pace === "full"} disabled={busy} onChange={() => onPace("full")}/><span><strong>Take your time</strong><small>The full story at a slower pace.</small></span></label>
      </fieldset>
    </>}
    {loading && <p role="status" className="setup-context">Loading the available scenarios…</p>}
    {error && <div className="setup-error" role="alert"><p>{error}</p>{!scenarios.length && <button type="button" onClick={onRetry}>Retry connection</button>}</div>}
    <footer className="setup-footer"><button type="button" className="setup-back" disabled={busy} onClick={onBack}><ArrowLeft size={16} aria-hidden="true"/>Back</button>
      <span>{step === 1 ? (selected ? `${selected.roles.length} roles available` : "Choose a scenario to continue") : step === 2 ? (role ? role.title : "Choose a role to continue") : "Fictional scenario · You can pause at any time"}</span>
      <button type="button" className="setup-primary" disabled={busy || !selected || (step > 1 && !role)} onClick={() => step === 3 ? onStart() : onStep((step+1) as SetupStep)}>
        {busy ? "Preparing your world…" : step === 1 ? "Choose your role" : step === 2 ? "See mission briefing" : "Begin simulation"}<ArrowRight size={18} aria-hidden="true"/>
      </button>
    </footer>
  </section>;
}
