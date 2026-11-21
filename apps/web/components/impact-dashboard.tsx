import type { ImpactSnapshot, ScenarioEvent } from "../lib/scenario";

const cards = [
  { key: "deaths", label: "Deaths", format: integer },
  { key: "injuries", label: "Injured", format: integer },
  { key: "missing", label: "Missing", format: integer },
  { key: "displaced", label: "Displaced", format: integer },
  { key: "sheltered", label: "In shelters", format: integer },
  { key: "households_without_power", label: "No power", format: integer, suffix: " households" },
  { key: "households_without_water", label: "No water", format: integer, suffix: " households" },
  { key: "economic_loss_usd", label: "Economic loss", format: money },
] as const;
function integer(value: number) { return new Intl.NumberFormat("en", { notation: value > 99999 ? "compact" : "standard", maximumFractionDigits: 1 }).format(value); }
function money(value: number) { return `$${new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value)}`; }
function numeric(value: unknown): number | undefined { return typeof value === "number" && Number.isFinite(value) ? value : undefined; }
function latestImpact(events: ScenarioEvent[]): ImpactSnapshot | undefined {
  return [...events].reverse().find((event) => event.status === "applied" && event.payload.impacts)?.payload.impacts;
}
function Sparkline({ values }: { values: number[] }) {
  const max = Math.max(1, ...values);
  const points = values.map((value, index) => `${(index / (values.length - 1)) * 100},${30 - (value / max) * 26}`).join(" ");
  return <svg className="impact-sparkline" viewBox="0 0 100 32" aria-hidden="true"><polyline points={points} /></svg>;
}
export function ImpactDashboard({ events }: { events: ScenarioEvent[] }) {
  const impact = latestImpact(events);
  const environmental = [
    impact?.flooded_area_km2 == null ? null : `${integer(impact.flooded_area_km2)} km² flooded`,
    impact?.contaminated_area_km2 == null ? null : `${integer(impact.contaminated_area_km2)} km² contaminated`,
    impact?.debris_tonnes == null ? null : `${integer(impact.debris_tonnes)} t debris`,
  ].filter(Boolean).join(" · ");
  const contributors = impact?.aid_contributors ?? [];
  const total = (key: "personnel" | "cargo_tonnes") => contributors.some((c) => c[key] != null)
    ? integer(contributors.reduce((sum, c) => sum + (c[key] ?? 0), 0))
    : null;
  const personnel = total("personnel");
  const cargo = total("cargo_tonnes");
  const relief = [
    contributors.map((c) => c.country).join(", "),
    personnel && `${personnel} personnel`,
    cargo && `${cargo} t cargo`,
  ].filter(Boolean).join(" · ");
  const reportedCards = cards.flatMap((card) => {
    const value = numeric(impact?.[card.key]);
    return value === undefined ? [] : [{ card, value }];
  });

  return (
    <section className="impact-dashboard" aria-labelledby="impact-title">
      <div className="inspector-heading"><h2 id="impact-title">Impact estimates</h2><span className="inspector-meta">Simulated</span></div>
      {reportedCards.length > 0 && (
        <dl className="impact-grid">
          {reportedCards.map(({ card, value }) => {
            const history = events.flatMap((event) => {
              const entry = numeric(event.payload.impacts?.[card.key]);
              return entry === undefined ? [] : [entry];
            });
            return (
              <div className="impact-card" key={card.key}>
                <dt>{card.label}</dt>
                <dd>
                  {card.format(value)}{"suffix" in card ? card.suffix : ""}
                  {history.length > 1 && <Sparkline values={history} />}
                </dd>
              </div>
            );
          })}
        </dl>
      )}
      {(environmental || relief) && (
        <dl className="impact-secondary">
          {environmental && <div><dt>Environment</dt><dd>{environmental}</dd></div>}
          {relief && <div><dt>International relief</dt><dd>{relief}</dd></div>}
        </dl>
      )}
      {!reportedCards.length && !environmental && !relief && <p className="inspector-empty">No impact estimates yet.</p>}
    </section>
  );
}
