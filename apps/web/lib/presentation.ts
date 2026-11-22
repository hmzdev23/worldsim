// Cosmetic scheduling only. Original event minutes and canonical ordering remain intact.
export type PresentationSpeed = "cinematic" | "normal" | "fast";
export function beatDelay(speed: PresentationSpeed) { return {cinematic: 6000, normal: 4000, fast: 0}[speed]; }
export function headlineDelay(speed: PresentationSpeed, severity: number) {
  return speed === "fast" ? 180 : speed === "cinematic" ? (severity >= .6 ? 7000 : 5000) : (severity >= .6 ? 5500 : 3500);
}
