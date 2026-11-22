// Player mode (prototype): the end-of-run summary. It answers three questions in order:
// how well did I do, which decisions helped or hurt, and what would doing nothing have given.

import { useEffect, useRef } from "react";
import { formatSimTime } from "../lib/scenario";
import type { PlayerSummary } from "../lib/player-api";

type Props = {
  summary: PlayerSummary;
  busy: boolean;
  onTryAgain: () => void;
  onBranch: (decisionId: string) => void;
  onCompare: () => void;
};

const choiceText: Record<string, string> = {
  action: "Acted",
  do_nothing: "Did nothing",
  auto: "Ran out of time",
  free_text: "Own decision (not simulated offline)",
};

export function PlayerSummaryPanel({ summary, busy, onTryAgain, onBranch, onCompare }: Props) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => headingRef.current?.focus(), []);
  const { score } = summary;

  return (
    <section className="player-summary" aria-labelledby="player-summary-title">
      <p className="player-summary-label">{summary.label} · Run complete · {summary.role.title}</p>
      <h2 id="player-summary-title" ref={headingRef} tabIndex={-1}>
        Score {score.total} <span>of {score.max}</span>
      </h2>

      <h3>How well did I do?</h3>
      {/* The table is the chart's text alternative: every bar is also a number. */}
      <table className="score-table">
        <caption>Score components</caption>
        <thead><tr><th scope="col">Component</th><th scope="col">Points</th><th scope="col">Why</th></tr></thead>
        <tbody>
          {score.components.map((part) => (
            <tr key={part.id}>
              <th scope="row">{part.label}</th>
              <td>
                <span className="score-value">{part.points} / {part.max}</span>
                <span className="score-bar" aria-hidden="true">
                  <span style={{ width: `${Math.max(0, Math.min(100, (part.points / part.max) * 100))}%` }} />
                </span>
              </td>
              <td>
                {part.why}
                <span className="score-rule">{part.explanation}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="player-summary-paragraph">{summary.paragraph}</p>

      <h3>Which decisions helped or hurt?</h3>
      {summary.decisions.length === 0 ? <p className="player-summary-note">No decision points were reached.</p> : (
        <>
          <p className="player-summary-note">
            Each decision is judged on its own, inside this fictional model: its branch against the branch just before it.
          </p>
          <ol className="decision-timeline">
            {summary.decisions.map((decision) => (
              <li key={decision.id}>
                <div className="decision-timeline-head">
                  <span>{formatSimTime(decision.at_minutes ?? decision.trigger.minute)}</span>
                  <span className="verdict" data-verdict={decision.verdict}>{decision.verdict}</span>
                </div>
                <p>
                  <strong>{decision.trigger.headline || decision.trigger.place}</strong>
                  {" · "}{choiceText[decision.choice ?? "do_nothing"]}: {decision.label}
                </p>
                {decision.caused.length > 0 && (
                  <ul className="decision-caused">
                    {decision.caused.map((line) => <li key={line}>{line}</li>)}
                  </ul>
                )}
                <button type="button" disabled={busy} onClick={() => onBranch(decision.id)}>
                  Branch from this decision
                </button>
              </li>
            ))}
          </ol>
        </>
      )}
      {summary.voided.length > 0 && (
        <p className="player-summary-note">{summary.voided.length} earlier decision{summary.voided.length === 1 ? " was" : "s were"} voided by seeking back.</p>
      )}

      <h3>What if I had done nothing?</h3>
      <table className="baseline-table">
        <caption>Compared with doing nothing</caption>
        <thead><tr><th scope="col">Outcome</th><th scope="col">Doing nothing</th><th scope="col">Your run</th><th scope="col">Difference</th></tr></thead>
        <tbody>
          {summary.baseline.map((row) => (
            <tr key={row.name}>
              <th scope="row">{row.label}</th>
              <td>{row.baseline_text}</td>
              <td>{row.final_text}</td>
              <td><span className="verdict" data-verdict={row.verdict}>{row.difference_text}</span></td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="player-summary-actions">
        <button type="button" onClick={onCompare}>Open the alternate timeline</button>
        <button type="button" disabled={busy} onClick={onTryAgain}>Try again</button>
      </div>
    </section>
  );
}
