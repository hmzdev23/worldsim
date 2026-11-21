import type { ImpactSnapshot, ScenarioEvent } from "../lib/earthquake";

const cards = [
  { key: "fatalities_estimate", label: "Deaths", format: integer },
  { key: "injuries_estimate", label: "Injured", format: integer },
  { key: "missing_estimate", label: "Missing", format: integer },
  { key: "displaced_people", label: "Displaced", format: integer },
  { key: "people_in_shelters", label: "In shelters", format: integer },
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
  if (values.length < 2) return <span className="sparkline-empty">Awaiting more events</span>;
  const max = Math.max(1, ...values);
  const points = values.map((value, index) => `${(index / (values.length - 1)) * 100},${30 - (value / max) * 26}`).join(" ");
  return <svg className="impact-sparkline" viewBox="0 0 100 32" aria-hidden="true"><polyline points={points} /></svg>;
}
export function ImpactDashboard({ events }: { events: ScenarioEvent[] }) {
  const impact = latestImpact(events);
  const environmental = impact && `${impact.flooded_area_km2 ?? "—"} km² flooded · ${impact.contaminated_sites ?? "—"} sites · ${impact.debris_tonnes == null ? "—" : integer(impact.debris_tonnes)} t debris`;
  const relief = impact && `${impact.aid_countries?.length ? impact.aid_countries.join(", ") : "No contributors reported"} · ${impact.aid_personnel == null ? "—" : integer(impact.aid_personnel)} personnel · ${impact.aid_cargo_tonnes == null ? "—" : integer(impact.aid_cargo_tonnes)} t cargo`;
  return <section className="impact-dashboard" aria-labelledby="impact-title">
    <div className="impact-heading"><div><span className="section-label">Live situation</span><h2 id="impact-title">Cumulative impact estimates</h2></div><span className="estimate-tag">SIMULATED · ESTIMATES</span></div>
    <div className="impact-grid">{cards.map((card) => {
      const value = numeric(impact?.[card.key]);
      const history = events.flatMap((event) => { const n = numeric(event.payload.impacts?.[card.key]); return n === undefined ? [] : [n]; });
      return <article className="impact-card" key={card.key}><span>{card.label}</span><strong>{value === undefined ? "—" : `${card.format(value)}${"suffix" in card ? card.suffix : ""}`}</strong><Sparkline values={history} /></article>;
    })}</div>
    <div className="impact-secondary"><div><span>Environment</span><strong>{environmental || "Awaiting applied impact report"}</strong></div><div><span>International relief</span><strong>{relief || "Awaiting aid event"}</strong></div></div>
  </section>;
}
