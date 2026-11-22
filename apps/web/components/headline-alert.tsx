import { Broadcast, CaretRight, Crosshair } from "@phosphor-icons/react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { focusNewsItem, type NewsItem } from "../lib/scenario";

export function HeadlineAlert({
  item,
  queuedCount,
  onAdvance,
}: {
  item: NewsItem | undefined;
  queuedCount: number;
  onAdvance: () => void;
}) {
  const hasNext = queuedCount > 0;
  const reducedMotion = useReducedMotion();

  return (
    <>
      <div className="headline-alert-announcement" aria-live="polite" aria-atomic="true">
        {item && `Headline. ${item.headline}. ${item.dek}`}
      </div>
      <AnimatePresence mode="wait">
      {item && (
        <motion.section key={item.event_id}
          initial={reducedMotion ? false : { opacity: 0, x: 28 }}
          animate={{ opacity: 1, x: 0 }}
          exit={reducedMotion ? { opacity: 0 } : { opacity: 0, x: 28, transition: { duration: 0.18 } }}
          transition={{ duration: 0.22, ease: "easeOut" }}
          data-event-id={item.event_id} data-minute={item.sim_time_minutes} className="headline-alert" data-severity={item.severity >= 0.75 ? "high" : item.severity >= 0.4 ? "moderate" : "low"} aria-labelledby="map-headline-title">
          <header className="headline-alert-bar">
            <span><Broadcast size={16} aria-hidden="true" /> WORLD//WIRE </span>
            <span>{item.severity >= .6 ? "BREAKING NEWS" : "UPDATE"}</span>
          </header>
          <div className="headline-alert-story">
            <div className="headline-alert-meta">
              <time>{item.sim_time_label}</time>
              <span>{item.event_type.replaceAll("_", " ")}</span>
              <span className="headline-alert-severity" data-level={item.severity >= 0.75 ? "high" : item.severity >= 0.4 ? "moderate" : "low"}>
                Severity {Math.round(item.severity * 100)}%
              </span>
            </div>
            <h2 id="map-headline-title">{item.headline}</h2>
            <p className="headline-alert-dek">{item.dek}</p>
          </div>
          <footer className="headline-alert-actions">
            <button className="headline-alert-focus" type="button" onClick={() => focusNewsItem(item)}>
              <Crosshair size={17} aria-hidden="true" /> Focus map
            </button>
            <div className="headline-alert-queue">
              <span>{hasNext ? `${queuedCount} queued` : "Paused"}</span>
              <button className="headline-alert-advance" type="button" onClick={onAdvance}>
                {hasNext ? "Next headline" : "Continue simulation"} <CaretRight size={14} aria-hidden="true" />
              </button>
            </div>
          </footer>
        </motion.section>
      )}
      </AnimatePresence>
    </>
  );
}
