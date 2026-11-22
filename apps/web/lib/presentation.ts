// Cosmetic scheduling only. Original event minutes and canonical ordering remain intact.
export type PresentationSpeed = "cinematic" | "normal" | "fast";
/**
 * How long the clock stays paused on a headline: long enough to read it. Based on the
 * words in the headline and the first sentence or so of the dek (hovering over the card holds it longer).
 */
export function headlineDelay(speed: PresentationSpeed, item: { headline: string; dek?: string; severity: number }) {
  if (speed === "fast") return 180;
  const words = item.headline.split(/\s+/).length + Math.min(22, (item.dek ?? "").split(/\s+/).filter(Boolean).length);
  const base = 900 + words * 110 + (item.severity >= .6 ? 400 : 0);
  return speed === "cinematic" ? Math.min(9000, Math.max(5000, base * 1.4)) : Math.min(4500, Math.max(2800, base));
}
