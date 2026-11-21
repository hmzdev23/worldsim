import { useState } from "react";
import { Broadcast } from "@phosphor-icons/react";
import { focusNewsItem, type NewsItem } from "../lib/scenario";

export function WorldWire({ items, loading }: { items: NewsItem[]; loading: boolean }) {
  const [focused, setFocused] = useState<NewsItem>();

  return (
    <section className="world-wire" aria-labelledby="world-wire-title">
      <div className="inspector-heading">
        <h2 id="world-wire-title"><Broadcast size={16} aria-hidden="true" /> WORLD//WIRE</h2>
        <span className="inspector-meta">{items.length} {items.length === 1 ? "report" : "reports"}</span>
      </div>
      {items.length === 0 ? (
        <p className="inspector-empty">{loading ? "Loading reports…" : "No reports yet. Headlines arrive as the scenario plays."}</p>
      ) : (
        <ul className="world-wire-list">
          {items.map((item) => (
            <li key={item.event_id}>
              <button type="button" className="wire-card" aria-pressed={focused === item}
                onClick={() => { setFocused(item); focusNewsItem(item); }}>
                <span className="wire-meta"><span>{item.label}</span><span>{item.sim_time_label}</span></span>
                <span className="wire-headline">{item.headline}</span>
                <span className="wire-dek">{item.dek}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
