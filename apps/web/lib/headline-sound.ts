let context: AudioContext | undefined;

// Browsers allow sound only after a gesture. Unlock it when the viewer starts or resumes a run.
export function enableHeadlineSound() {
  try {
    context ??= new AudioContext();
    if (context.state === "suspended") void context.resume().catch(() => {});
  } catch { /* Playback also works without audio. */ }
}

export function soundHeadline() {
  if (context?.state !== "running") return;
  const tone = context.createOscillator();
  const gain = context.createGain();
  const now = context.currentTime;
  tone.frequency.setValueAtTime(660, now);
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.035, now + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
  tone.connect(gain).connect(context.destination);
  tone.onended = () => { tone.disconnect(); gain.disconnect(); };
  tone.start(now);
  tone.stop(now + 0.19);
}
