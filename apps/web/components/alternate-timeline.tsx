// Player mode (prototype): the Alternate Timeline. Timeline A is the scenario with no intervention
// (the run's main segment, never changed); timeline B is the player's branch. Both come from the same
// run and the same starting point, so every difference shown here comes from a recorded decision.

import { forwardRef, useId, useMemo, useState } from "react";
import type { Comparison, ComparisonRow, ComparedDecision, ComparedEvent } from "../lib/player-api";

type Props = {
  comparison: Comparison;
  score?: { total: number; max: number };
  busy: boolean;
  onClose: () => void;
  onTryAgain: () => void;
  onBranch: (decisionId: string) => void;
};

const choiceText: Record<string, string> = {
  action: "Acted",
  do_nothing: "Did nothing",
  auto: "Ran out of time",
  free_text: "Own decision (not simulated offline)",
};

const statusText: Record<ComparisonRow["status"], string> = {
  same: "Same",
  changed: "Changed",
  prevented: "Prevented",
  benefit: "Benefit",
  side_effect: "Side effect",
  added: "Added",
  decision: "Decision",
};

function severity(value: number) {
  return `${Math.round(value * 100)}%`;
}

function EventCell({ event, muted }: { event: ComparedEvent; muted?: boolean }) {
  return (
    <div className="alt-event" data-muted={muted || undefined}>
      <strong>{event.type_label} · {event.place}</strong>
      <span className="alt-event-meta">{event.time_label} · severity {severity(event.severity)}</span>
      {!muted && event.description && <span className="alt-event-text">{event.description}</span>}
    </div>
  );
}

function RowCells({ row }: { row: ComparisonRow }) {
  if (row.kind === "decision") {
    return (
      <>
        <div className="alt-cell alt-cell-a">
          <span className="visually-hidden">Timeline A: </span>
          <span className="alt-quiet">No intervention</span>
        </div>
        <div className="alt-cell alt-cell-b alt-decision">
          <span className="visually-hidden">Timeline B: </span>
          <span className="alt-badge" data-status="decision">Your decision</span>
          <strong>{row.note}</strong>
          <span className="alt-event-meta">
            {choiceText[row.choice ?? "do_nothing"]}{row.simulated ? " · timeline branches here" : " · no change to the timeline"}
          </span>
        </div>
      </>
    );
  }
  return (
    <>
      <div className="alt-cell alt-cell-a">
        <span className="visually-hidden">Timeline A: </span>
        {row.a ? <EventCell event={row.a} /> : <span className="alt-quiet">Did not happen</span>}
      </div>
      <div className="alt-cell alt-cell-b">
        <span className="visually-hidden">Timeline B: </span>
        {row.status !== "same" && <span className="alt-badge" data-status={row.status}>{statusText[row.status]}</span>}
        {row.status === "prevented" && <span className="alt-quiet">{row.note}</span>}
        {row.status === "same" && row.b && <span className="alt-quiet">Same: {row.b.type_label.toLowerCase()} · {row.b.place}</span>}
        {(row.status === "changed") && row.b && (
          <>
            <EventCell event={row.b} muted />
            <span className="alt-change">{row.note}</span>
          </>
        )}
        {(row.status === "benefit" || row.status === "side_effect" || row.status === "added") && row.b && (
          <EventCell event={row.b} />
        )}
      </div>
    </>
  );
}

export const AlternateTimeline = forwardRef<HTMLHeadingElement, Props>(function AlternateTimeline(
  { comparison, score, busy, onClose, onTryAgain, onBranch }, headingRef,
) {
  const ids = useId();
  const [selected, setSelected] = useState<string>();
  const [onlySelected, setOnlySelected] = useState(false);
  const start = comparison.initial_conditions;
  const chosen: ComparedDecision | undefined = comparison.decisions.find((d) => d.id === selected);
  const rows = useMemo(
    () => (chosen && onlySelected ? comparison.rows.filter((r) => r.decisions.includes(chosen.id)) : comparison.rows),
    [chosen, comparison.rows, onlySelected],
  );
  const changedSettings = comparison.settings.filter((s) => s.final !== s.default);

  return (
    <section className="alt-timeline" aria-labelledby={`${ids}-title`}>
      <div className="alt-bar">
        <span>{comparison.label} · Run complete · {start.end_label}</span>
        <button type="button" onClick={onClose}>Back to the map</button>
      </div>

      <div className="alt-body">
        <header className="alt-head">
          <p className="alt-kicker">Alternate timeline</p>
          <h2 id={`${ids}-title`} ref={headingRef} tabIndex={-1}>What your decisions changed</h2>
          <p className="alt-headline">{comparison.headline}{score ? ` Score ${score.total} of ${score.max}.` : ""}</p>
          <p className="alt-note">{comparison.note}</p>
        </header>

        <div className="alt-start" aria-label="Starting conditions">
          <h3>Same starting point</h3>
          <dl>
            <div><dt>Scenario</dt><dd>{start.scenario}</dd></div>
            <div><dt>Your role</dt><dd>{start.role} (fictional)</dd></div>
            <div>
              <dt>First event</dt>
              <dd>{start.first_event ? `${start.first_event.type_label} · ${start.first_event.place}, ${start.start_label}` : start.start_label}</dd>
            </div>
            <div>
              <dt>Shared history</dt>
              <dd>
                {start.identical ? "Identical" : "Not identical"}: {start.shared_events} event{start.shared_events === 1 ? "" : "s"} up to {start.shared_until_label}
              </dd>
            </div>
          </dl>
          {changedSettings.length > 0 && (
            <p className="alt-settings">
              <span>Your policy settings:</span>{" "}
              {changedSettings.map((s, index) => (
                <span key={s.name}>{index > 0 ? " · " : ""}{s.label}: {String(s.default)} → <strong>{String(s.final)}</strong></span>
              ))}
            </p>
          )}
        </div>

        <table className="alt-metrics">
          <caption>Outcome measures at the end of each timeline</caption>
          <thead>
            <tr>
              <th scope="col">Measure</th>
              <th scope="col">A · No intervention</th>
              <th scope="col">B · Your timeline</th>
              <th scope="col">Difference</th>
            </tr>
          </thead>
          <tbody>
            {comparison.metrics.map((metric) => (
              <tr key={metric.name}>
                <th scope="row">{metric.label}</th>
                <td>{metric.baseline_text}</td>
                <td>{metric.final_text}</td>
                <td>
                  <span className="alt-diff" data-verdict={metric.verdict}>
                    <span aria-hidden="true">{metric.verdict === "better" ? "▲ " : metric.verdict === "worse" ? "▼ " : ""}</span>
                    {metric.difference_text}
                    {metric.verdict === "better" || metric.verdict === "worse" ? ` (${metric.verdict})` : ""}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {comparison.decisions.length > 0 && (
          <div className="alt-decisions">
            <h3 id={`${ids}-decisions`}>Your decisions <span>Select one to see what it changed</span></h3>
            <div className="alt-decision-list" role="group" aria-labelledby={`${ids}-decisions`}>
              {comparison.decisions.map((decision) => (
                <button key={decision.id} type="button" aria-pressed={selected === decision.id}
                  aria-controls={`${ids}-explain`}
                  onClick={() => setSelected((current) => (current === decision.id ? undefined : decision.id))}>
                  <span className="alt-event-meta">{decision.time_label}</span>
                  <strong>{decision.label}</strong>
                  <span className="verdict" data-verdict={decision.verdict}>{decision.verdict}</span>
                </button>
              ))}
            </div>
            <div id={`${ids}-explain`} className="alt-explain" aria-live="polite">
              {chosen ? (
                <>
                  <p>
                    <strong>{chosen.time_label} · {chosen.trigger.rule_label}.</strong>{" "}
                    {chosen.trigger.headline || chosen.trigger.place}
                  </p>
                  <p>{chosen.explanation}</p>
                  <div className="alt-explain-actions">
                    <label>
                      <input type="checkbox" checked={onlySelected}
                        onChange={(event) => setOnlySelected(event.currentTarget.checked)} />
                      Show only what this decision changed
                    </label>
                    <button type="button" disabled={busy} onClick={() => onBranch(chosen.id)}>
                      Branch from this decision
                    </button>
                  </div>
                </>
              ) : (
                <p className="alt-quiet">Choose a decision above to highlight the events it changed in timeline B.</p>
              )}
            </div>
          </div>
        )}

        <div className="alt-lanes">
          <div className="alt-lane-heads" aria-hidden="true">
            <span>{comparison.timelines.a.title}</span>
            <span>{comparison.timelines.b.title}</span>
          </div>
          <ol className="alt-rows" aria-label="Event by event: timeline A and timeline B">
            {rows.map((row) => (
              <li key={row.id} className="alt-row" data-status={row.status} data-kind={row.kind}
                data-linked={chosen ? row.decisions.includes(chosen.id) : undefined}>
                <span className="alt-time">{row.kind === "decision" ? "" : (row.b ?? row.a)?.time_label}</span>
                <RowCells row={row} />
              </li>
            ))}
          </ol>
          <p className="alt-legend">
            <span className="alt-badge" data-status="prevented">Prevented</span> did not happen in B ·{" "}
            <span className="alt-badge" data-status="changed">Changed</span> moved or changed severity ·{" "}
            <span className="alt-badge" data-status="benefit">Benefit</span>{" "}
            <span className="alt-badge" data-status="side_effect">Side effect</span> added by a decision
          </p>
        </div>

        <div className="alt-actions">
          <button type="button" className="alt-primary" disabled={busy} onClick={onTryAgain}>Try a different strategy</button>
          <button type="button" onClick={onClose}>Back to the map</button>
        </div>
      </div>
    </section>
  );
});
