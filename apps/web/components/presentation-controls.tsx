export function PresentationControls({autoFollow, onFollow, suspended}: {
 autoFollow: boolean; onFollow: () => void; suspended: boolean;
}) {
 return <section className="presentation-controls" aria-label="Story presentation">
  <div><strong>Story presentation</strong><span>Headlines wait for you to continue.</span></div>
  <button type="button" aria-pressed={autoFollow && !suspended} onClick={onFollow}>Auto-follow: {autoFollow && !suspended ? "on" : suspended ? "suspended" : "off"}</button>
 </section>;
}
