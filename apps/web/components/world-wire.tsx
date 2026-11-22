import { useState } from "react";
import { Broadcast } from "@phosphor-icons/react";
import { focusNewsItem, type NewsItem } from "../lib/scenario";

export function WorldWire({ items, loading, satire = false, selectedId, onSelect }: {
  items: (NewsItem & { original_headline?: string })[]; loading: boolean; satire?: boolean;
  selectedId?: string; onSelect?: (item: NewsItem) => void;
}) {
  const [focused, setFocused] = useState<NewsItem>();

  return (
    <section className="world-wire" aria-labelledby="world-wire-title">
      <div className="inspector-heading">
        <h2 id="world-wire-title"><Broadcast size={16} aria-hidden="true" /> WORLD//WIRE</h2>
        <span className={satire ? "inspector-meta satire-stamp" : "inspector-meta"}>
          {satire ? "Satire · " : ""}{items.length} {items.length === 1 ? "report" : "reports"}
        </span>
      </div>
      {items.length === 0 ? (
        <p className="inspector-empty">{loading ? "Loading reports…" : "No reports yet. Headlines arrive as the scenario plays."}</p>
      ) : (
        <ul className="world-wire-list">
          {items.map((item) => (
            <li key={item.event_id}>
              <button type="button" className="wire-card" aria-pressed={selectedId ? selectedId === item.event_id : focused === item}
                onClick={() => { setFocused(item); if (onSelect) onSelect(item); else focusNewsItem(item); }}>
                <span className="wire-meta"><span>{item.label}</span><span>{item.sim_time_label}</span></span>
                <span className="wire-importance">{item.severity >= .6 ? "Major development" : "Update"}</span><span className="wire-headline">{item.headline}</span>
                <span className="wire-dek">{item.dek}</span>
                {item.original_headline && <span className="wire-original">Original report: {item.original_headline}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
