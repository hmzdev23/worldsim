import { ArrowRight, Check } from "@phosphor-icons/react";
import { useState } from "react";
import countries from "../lib/countries.json";
import type { Starter } from "../lib/scenario";

export type StarterLaunch = { prompt: string; fixture?: string };

/**
 * Starter scenarios. A starter is a starting point, not a script: each run of
 * it rolls a new seed. Optional starting conditions (and, for the nuclear
 * starter, the two countries) turn it into a freshly generated scenario.
 */
export function ScenarioStarters({ starters, loading, error, busy, onRetry, onLaunch }: {
  starters: Starter[]; loading: boolean; error?: string; busy: boolean;
  onRetry: () => void; onLaunch: (launch: StarterLaunch) => void;
}) {
  const [fixture, setFixture] = useState("");
  const [countryA, setCountryA] = useState("");
  const [countryB, setCountryB] = useState("");
  const [changeA, setChangeA] = useState("");
  const [changeB, setChangeB] = useState("");
  const selected = starters.find((s) => s.fixture === fixture);
  const nuclear = fixture === "nuclear-war";
  const pickedCountries = Boolean(countryA && countryB);
  const countriesValid = !pickedCountries || countryA.toLocaleLowerCase() !== countryB.toLocaleLowerCase();
  const changes = [changeA.trim(), changeB.trim()].filter(Boolean);
  const generated = (nuclear && pickedCountries) || changes.length > 0;

  function launch() {
    if (!selected || !countriesValid) return;
    const base = nuclear && pickedCountries
      ? `A hypothetical nuclear confrontation between ${countryA} and ${countryB}. Show the crisis and its consequences over time.`
      : selected.prompt;
    const prompt = changes.length ? `${base}\nStarting conditions: ${changes.join("; ")}.` : base;
    onLaunch(generated ? { prompt } : { prompt, fixture: selected.fixture });
  }

  return <section className="starters" aria-labelledby="starters-title">
    <div className="starters-heading">
      <h2 id="starters-title">Or start from a scenario</h2>
      <p>Each one plays out differently every time you run it.</p>
    </div>
    {loading && <p role="status" className="setup-context">Loading starter scenarios…</p>}
    {error && <div className="setup-error" role="alert"><p>{error}</p><button type="button" onClick={onRetry}>Retry connection</button></div>}
    <div className="setup-scenarios" role="group" aria-label="Starter scenarios">
      {starters.map((s) => <button type="button" key={s.fixture} disabled={busy} aria-pressed={fixture === s.fixture}
        className="setup-scenario" onClick={() => setFixture(fixture === s.fixture ? "" : s.fixture)}>
        <span className="setup-scenario-icon" aria-hidden="true">{s.icon}</span>
        <span className="setup-category">{s.category}</span><strong>{s.title}</strong>
        <span className="setup-selection" aria-hidden="true">{fixture === s.fixture && <Check size={14} />}</span>
      </button>)}
    </div>
    {selected && <section className="watch-setup" aria-label={`Run ${selected.title}`}>
      <div><p className="alt-kicker">{selected.category}</p><h3>{selected.title}</h3><p>{selected.summary}</p></div>
      {nuclear && <div className="watch-inputs">
        <label>First country <span>(optional)</span><select value={countryA} disabled={busy} onChange={(e) => setCountryA(e.currentTarget.value)}><option value="">Any</option>{countries.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
        <label>Second country <span>(optional)</span><select value={countryB} disabled={busy} onChange={(e) => setCountryB(e.currentTarget.value)}><option value="">Any</option>{countries.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
        {!countriesValid && <p className="watch-input-note">Choose two different countries.</p>}
      </div>}
      <details className="starting-conditions">
        <summary>Change the starting conditions</summary>
        <div className="watch-inputs">
          <label>Change one detail<input value={changeA} maxLength={400} disabled={busy} onChange={(e) => setChangeA(e.currentTarget.value)} placeholder="e.g. it happens in winter" /></label>
          <label>Change another detail <span>(optional)</span><input value={changeB} maxLength={400} disabled={busy} onChange={(e) => setChangeB(e.currentTarget.value)} placeholder="e.g. the airport is already closed" /></label>
        </div>
      </details>
      {generated && <p className="watch-input-note">A new scenario is generated for these conditions, which takes a little longer.</p>}
      <button type="button" className="setup-primary watch-start" disabled={busy || !countriesValid} onClick={launch}>
        {busy ? "Preparing your world…" : "Simulate"}<ArrowRight size={18} aria-hidden="true" />
      </button>
    </section>}
  </section>;
}
