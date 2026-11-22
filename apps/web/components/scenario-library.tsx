import type { PlayableScenario } from "../lib/player-api";

export function ScenarioLibrary({scenarios, fixture, roleId, busy, expanded, onExpanded, onScenario, onRole, onStart}: {
  expanded: boolean; onExpanded: (value: boolean) => void;
  scenarios: PlayableScenario[]; fixture: string; roleId: string; busy: boolean;
  onScenario: (fixture: string) => void; onRole: (role: string) => void; onStart: () => void;
}) {
  const chosen = scenarios.find(s => s.fixture === fixture);
  const role = chosen?.roles.find(r => r.id === roleId);
  return <section id="scenario-library" className="player-launch scenario-library" aria-labelledby="player-launch-title">
    <header><p className="alt-kicker">Player mode · 10 fictional worlds</p><h2 id="player-launch-title">Play a role</h2>
      <p>Choose a crisis. Take responsibility. Discover what your choices change.</p></header>
    <details open={expanded} onToggle={e => onExpanded(e.currentTarget.open)}><summary>Choose scenario and role · {chosen?.display_title || chosen?.title}</summary>
    <div className="scenario-grid" role="group" aria-label="Crisis library">
      {scenarios.map(s => <button type="button" key={s.fixture} disabled={busy} aria-pressed={s.fixture === fixture}
        className="scenario-choice" onClick={() => onScenario(s.fixture)}>
        <span className="scenario-icon" aria-hidden="true">{s.icon}</span><span className="alt-event-meta">{s.category} · {s.roles.length} roles</span>
        <strong>{s.display_title || s.title}</strong><span>{s.summary}</span></button>)}
    </div>
    <div className="player-launch-row">
      <label>Scenario<select aria-label="Scenario" value={fixture} disabled={busy} onChange={e => onScenario(e.currentTarget.value)}>
        {scenarios.map(s => <option key={s.fixture} value={s.fixture}>{s.title}</option>)}
      </select></label>
      <label>Role<select aria-label="Role" value={roleId} disabled={busy} onChange={e => onRole(e.currentTarget.value)}>
        {chosen?.roles.map(r => <option key={r.id} value={r.id}>{r.title}</option>)}
      </select></label>
    </div>
    <div className="role-grid" role="group" aria-label="Mandates">
      {chosen?.roles.map(r => <button key={r.id} type="button" disabled={busy} aria-pressed={r.id === roleId}
        onClick={() => onRole(r.id)}><strong>{r.title}</strong><span>{r.responsibilities || r.summary}</span></button>)}
    </div>
    {chosen && role && <section className="mission-briefing" aria-label="Mission briefing">
      <p className="alt-kicker">SIMULATED · {chosen.display_title || chosen.title} · approximately 5–10 minutes</p>
      <h3>Your mission as {role.title}</h3><p>{chosen.briefing || chosen.summary}</p>
      <p>{role.perspective || role.summary} You may pause to read. No card expires while you consider your answer.</p>
      <p>Watch: {role.emphasis?.map(name => chosen.outcomes?.find(o => o.name === name)?.label || name).join(", ")}. All roles use the same scenario scoring rules.</p>
      <button className="play-role-button" type="button" disabled={busy || !roleId} onClick={onStart}>Play this role</button>
    </section>}
    </details>
  </section>;
}
