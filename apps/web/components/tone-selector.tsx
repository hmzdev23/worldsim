import { tones, type Tone } from "../lib/scenario";

export function ToneSelector({ value, onChange, disabled }: { value: Tone; onChange: (tone: Tone) => void; disabled?: boolean }) {
  return (
    <div className="tone-selector" role="radiogroup" aria-label="Presentation tone">
      {tones.map((tone) => (
        <button
          key={tone.value}
          type="button"
          role="radio"
          aria-checked={value === tone.value}
          data-tone={tone.value}
          disabled={disabled}
          onClick={() => onChange(tone.value)}
        >
          {tone.label}
        </button>
      ))}
    </div>
  );
}
