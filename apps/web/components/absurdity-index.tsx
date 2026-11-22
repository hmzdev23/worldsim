import type { AbsurdityMetric } from "../lib/scenario";

/** Satirical counters derived from released events and fictional posts. Kept apart from impact estimates. */
export function AbsurdityIndex({ metrics }: { metrics: AbsurdityMetric[] }) {
  return (
    <section className="absurdity-index" aria-labelledby="absurdity-title">
      <div className="inspector-heading">
        <h2 id="absurdity-title">Absurdity index</h2>
        <span className="inspector-meta satire-stamp">Satire · not impact data</span>
      </div>
      {metrics.length === 0 ? (
        <p className="inspector-empty">Nothing absurd has happened yet.</p>
      ) : (
        <dl className="absurdity-grid">
          {metrics.map((metric) => (
            <div key={metric.key} data-zero={metric.value === 0}>
              <dt>{metric.label}</dt>
              <dd>{metric.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
