// Player mode (prototype): the decision card shown when the clock stops on a trigger.

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { formatSimTime } from "../lib/scenario";
import type { PendingDecision, PlayerState } from "../lib/player-api";

type Props = {
  state: PlayerState;
  pending: PendingDecision;
  busy: boolean;
  error?: string;
  onChoose: (optionId: string) => void;
  onFreeText: (text: string) => void;
};

export function DecisionCard({ state, pending, busy, error, onChoose, onFreeText }: Props) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [expanded, setExpanded] = useState(pending.waiting);
  const [text, setText] = useState("");
  const ids = useId();
  const titleId = `${ids}-title`;
  const situationId = `${ids}-situation`;
  const open = pending.waiting || expanded;

  // Move focus to a new card so keyboard and screen-reader users land on it.
  useEffect(() => {
    if (pending.waiting) {
      setExpanded(true);
      headingRef.current?.focus();
    }
  }, [pending.id, pending.waiting]);

  if (!open) {
    return (
      <section className="decision-card decision-card-deferred" aria-label="Deferred decision">
        <p>
          <strong>Decision deferred.</strong> You will be asked again at{" "}
          {pending.deadline_minutes === null ? "the next stop" : formatSimTime(pending.deadline_minutes)}.
        </p>
        <button type="button" onClick={() => setExpanded(true)}>Decide now</button>
      </section>
    );
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (text.trim()) onFreeText(text.trim());
  }

  const choices = [...pending.options, pending.do_nothing];
  const later = pending.decide_later;
  return (
    <section className="decision-card" role="dialog" aria-modal="false" aria-labelledby={titleId}
      aria-describedby={situationId}>
      <div className="decision-card-bar">
        <span>{state.label} · decision as {state.role.title.toLowerCase()}</span>
        <span>{pending.trigger.sim_time_label}</span>
      </div>
      <div className="decision-card-body">
        <p className="decision-rule">{pending.trigger.rule_label}</p>
        <h2 id={titleId} ref={headingRef} tabIndex={-1}>
          {pending.trigger.headline || `${pending.trigger.type.replaceAll("_", " ")} in ${pending.trigger.place}`}
        </h2>
        <p id={situationId} className="decision-situation">{pending.situation}</p>
        <ul className="decision-options" aria-label="Your options">
          {choices.map((option) => (
            <li key={option.id}>
              <button type="button" disabled={busy} onClick={() => onChoose(option.id)}>
                <strong>{option.label}</strong>
                <span>{option.tradeoff}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="decision-secondary">
          <button type="button" disabled={busy || later.remaining === 0} onClick={() => onChoose(later.id)}>
            Decide later ({later.remaining} left, +{later.defer_label} of simulated time)
          </button>
          {later.remaining === 0 && <span>If you wait again, this resolves to “Do nothing”.</span>}
        </div>
        <details className="decision-free-text">
          <summary>Write your own decision</summary>
          <form onSubmit={submit}>
            <label htmlFor={`${ids}-text`}>A high-level policy decision, in your own words</label>
            <textarea id={`${ids}-text`} rows={2} maxLength={pending.free_text.max_chars} value={text}
              onChange={(event) => setText(event.currentTarget.value)} />
            {pending.free_text.note && <p className="decision-note">{pending.free_text.note}</p>}
            <button type="submit" disabled={busy || !text.trim()}>Submit decision</button>
          </form>
        </details>
        {error && <p className="decision-error" role="alert">{error}</p>}
      </div>
    </section>
  );
}
