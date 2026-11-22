import type { PresentationSpeed } from "../lib/presentation";
export function PresentationControls({speed, onSpeed, held, onHold, onSkip, autoFollow, onFollow, suspended}: {
 speed: PresentationSpeed; onSpeed: (s: PresentationSpeed) => void; held: boolean; onHold: () => void;
 onSkip: () => void; autoFollow: boolean; onFollow: () => void; suspended: boolean;
}) {
 return <section className="presentation-controls" aria-label="Story presentation">
  <div><strong>Story presentation</strong><span>Reading pace · separate from simulation speed</span></div>
  <div role="group" aria-label="Presentation speed">{(["cinematic","normal","fast"] as const).map(s =>
    <button type="button" key={s} aria-pressed={speed === s} onClick={() => onSpeed(s)}>{s[0].toUpperCase()+s.slice(1)}</button>)}</div>
  <button type="button" aria-pressed={held} onClick={onHold}>{held ? "Continue presentation" : "Hold to read"}</button>
  <button type="button" onClick={onSkip}>Advance story</button>
  <button type="button" aria-pressed={autoFollow && !suspended} onClick={onFollow}>Auto-follow: {autoFollow && !suspended ? "on" : suspended ? "suspended" : "off"}</button>
 </section>;
}
