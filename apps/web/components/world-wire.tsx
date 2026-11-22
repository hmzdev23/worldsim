import { useState } from "react";
import { Broadcast } from "@phosphor-icons/react";
import { focusNewsItem, type NewsItem } from "../lib/scenario";

// Prefer the newsroom wording when it fits. Longer stories get a complete title.
const compactTitles: Record<string, string> = {
  earthquake: "Earthquake strikes", aftershock: "Aftershock hits", tsunami_warning: "Tsunami warning issued",
  infrastructure_failure: "Infrastructure outage reported", government_response: "Government mobilizes emergency response",
  international_aid: "International aid dispatched", volcanic_eruption: "Volcano erupts",
  meteor_impact: "Meteor strikes", extreme_weather: "Extreme weather hits", flooding: "Flooding reported",
  disease_outbreak: "Disease outbreak reported", military_strike: "Military strike reported",
  nuclear_detonation: "Nuclear detonation reported", cyber_attack: "Cyberattack reported",
  alien_contact: "Unidentified craft sighted", other_hazard: "New hazard reported",
  evacuation: "Evacuations ordered", contamination: "Contamination reported", economic_shock: "Economic shock reported",
  civil_unrest: "Civil unrest reported", conflict_escalation: "Conflict escalates", ceasefire: "Ceasefire announced",
  recovery: "Recovery underway",
};

function reportTitle(item: NewsItem) {
  const title = item.headline.split(",")[0].trim();
  if (title && title.split(/\s+/).length <= 5) return title;
  const action = title.split(/ (?:across|around|in|near|over|for) /i)[0];
  if (action !== title && action.split(/\s+/).length <= 5) return action;
  return compactTitles[item.event_type] ?? "New development reported";
}

export function WorldWire({ items, loading, selectedId, onSelect }: {
  items: NewsItem[]; loading: boolean;
  selectedId?: string; onSelect?: (item: NewsItem) => void;
}) {
  const [focused, setFocused] = useState<NewsItem>();

  return (
    <section className="world-wire" aria-labelledby="world-wire-title">
      <div className="inspector-heading">
        <h2 id="world-wire-title"><Broadcast size={16} aria-hidden="true" /> Reports</h2>
        <span className="inspector-meta">
          {items.length} {items.length === 1 ? "report" : "reports"}
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
                <strong className="wire-headline">{reportTitle(item)}</strong>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
