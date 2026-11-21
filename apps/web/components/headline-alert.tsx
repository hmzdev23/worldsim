import { Broadcast, CaretRight, Crosshair, X } from "@phosphor-icons/react";
import fixture from "../../../contracts/fixtures/japan-earthquake.json";
import feed from "../../../services/newsroom/feeds/japan-earthquake.json";
import type { ScenarioEvent } from "../lib/earthquake";
import { focusNewsItem } from "./world-wire";

type FeedItem = (typeof feed)[number];
export type HeadlineItem = Pick<FeedItem,
  "event_id" | "event_type" | "severity" | "label" | "headline" | "dek" | "sim_time_label" | "focus"
>;

export function headlineForEvent(
  event: ScenarioEvent,
  { simulation_id, branch_id }: { simulation_id: string; branch_id: string },
  timeLabel: string,
): HeadlineItem {
  // Event IDs are only unique within a simulation. The bundled feed belongs to this fixture.
  if (simulation_id === fixture.simulation_id && branch_id === fixture.branch_id) {
    const item = feed.find((report) => report.event_id === event.id);
    if (item) return item;
  }

  const place = event.location.name || event.location.country;
  const { description, label } = event.payload;
  const subject = typeof label === "string" && label.trim()
    ? label
    : event.type.replaceAll("_", " ");
  return {
    event_id: event.id,
    event_type: event.type,
    severity: event.severity,
    label: "SIMULATED",
    headline: `${subject.charAt(0).toUpperCase()}${subject.slice(1)} reported near ${place}`,
    dek: typeof description === "string" && description.trim()
      ? description
      : "A simulated event has been applied to the world state.",
    sim_time_label: timeLabel,
    focus: { event_id: event.id, lat: event.location.lat, lon: event.location.lon, zoom: 5.5 },
  };
}

export function HeadlineAlert({
  item,
  queuedCount,
  onAdvance,
}: {
  item: HeadlineItem | undefined;
  queuedCount: number;
  onAdvance: () => void;
}) {
  const hasNext = queuedCount > 0;

  return (
    <>
      <div className="headline-alert-announcement" aria-live="polite" aria-atomic="true">
        {item && `Simulated headline. ${item.headline}. ${item.dek}`}
      </div>
      {item && (
        <section className="headline-alert" aria-labelledby="map-headline-title">
          <header className="headline-alert-bar">
            <span><Broadcast size={16} aria-hidden="true" /> WORLD//WIRE</span>
            <span>{item.label}</span>
          </header>
          <div className="headline-alert-story" key={item.event_id}>
            <p className="headline-alert-meta">
              <span>{item.sim_time_label}</span>
              <span>{item.event_type.replaceAll("_", " ")}</span>
              <span>Severity {Math.round(item.severity * 100)}%</span>
            </p>
            <h2 id="map-headline-title">{item.headline}</h2>
            <p className="headline-alert-dek">{item.dek}</p>
          </div>
          <footer className="headline-alert-actions">
            <button className="headline-alert-focus" type="button" onClick={() => focusNewsItem(item)}>
              <Crosshair size={17} aria-hidden="true" /> Focus map
            </button>
            <div className="headline-alert-queue">
              {hasNext && <span>{queuedCount} queued</span>}
              <button className="headline-alert-advance" type="button" onClick={onAdvance}>
                {hasNext ? "Next headline" : "Dismiss"}
                {hasNext ? <CaretRight size={14} aria-hidden="true" /> : <X size={14} aria-hidden="true" />}
              </button>
            </div>
          </footer>
        </section>
      )}
    </>
  );
}
