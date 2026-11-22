#!/usr/bin/env python3
"""Mix narration, effects and music under picture.mp4 and write the SRT transcript.

    python3 assemble.py [picture.mp4]

Shot boundaries come from timing.json, so picture, voice and captions share one clock.
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
AUDIO, OUT = HERE / "audio", HERE / "output"

# Scene -> effects (name, offset into the shot, seconds, volume), reused from the team's films.
SCENE_EFFECTS = {
    "quake": [("quake", 0.2, 4.0, .36)], "eruption": [("rumble", 0.0, 4.4, .34)], "warning": [("siren", 0.0, 3.6, .22)],
    "sky": [("rumble", 0.0, 4.0, .2)], "storm": [("rumble", 0.0, 4.0, .18)], "flood": [("crowd", 0.0, 4.0, .12)],
    "outbreak": [("crowd", 0.0, 4.0, .12)], "outage": [("power", 1.5, 2.8, .32)], "committee": [("crowd", 0.0, 4.0, .14)],
    "tv": [("crowd", 0.0, 4.4, .22)], "aid": [("aid", 0.0, 4.0, .2)], "evacuation": [("siren", 0.0, 3.4, .2)],
    "market": [("crowd", 0.0, 4.0, .14)], "street": [("crowd", 0.0, 4.0, .14)],
    "departures": [("airport", 0.0, 4.0, .14)],
}


def main() -> int:
    picture = Path(sys.argv[1]) if len(sys.argv) > 1 else OUT / "picture.mp4"
    timing = json.loads((HERE / "timing.json").read_text())
    if timing.get("estimated"):
        raise SystemExit("timing.json is an estimate: run make-audio.py (without --estimate) first")
    script = json.loads((HERE / "script.json").read_text(encoding="utf-8"))
    OUTRO = float(script.get("outro_seconds", 3.5))
    cuts, lead = timing["cuts"], timing["lead_in"]
    effects = []
    for i, shot in enumerate(script["shots"]):
        cues = SCENE_EFFECTS.get(shot["scene"], [])
        if shot.get("event_type") == "nuclear_detonation":
            cues = [("rumble", .8, 3.6, .3)]
        for name, offset, dur, vol in cues:
            remaining = cuts[i + 1] - cuts[i] - offset
            if remaining > 0:
                effects.append((name, i, offset, min(dur, remaining), vol))
    lines = json.loads((AUDIO / "narration-lines.json").read_text())
    total = round(cuts[-1] + OUTRO, 2)
    OUT.mkdir(exist_ok=True)
    cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(picture)]
    filters, mix, n = [], [], 1
    for i in range(len(lines)):
        cmd += ["-i", str(AUDIO / f"voice-{i + 1:02}.mp3")]
        filters.append(f"[{n}:a]aresample=48000,adelay={int((cuts[i] + lead) * 1000)}:all=1[v{i}]")
        mix.append(f"[v{i}]"); n += 1
    for j, (name, shot, offset, dur, vol) in enumerate(effects):
        cmd += ["-i", str(AUDIO / f"sfx-{name}.mp3")]
        filters.append(f"[{n}:a]aresample=48000,atrim=duration={dur},afade=t=in:st=0:d=0.08,"
                       f"afade=t=out:st={max(0, dur - .4)}:d={min(dur, .4)},volume={vol},adelay={int((cuts[shot] + offset) * 1000)}:all=1[e{j}]")
        mix.append(f"[e{j}]"); n += 1
    cmd += ["-stream_loop", "3", "-i", str(AUDIO / "sfx-music.mp3")]
    filters.append(f"[{n}:a]aresample=48000,atrim=duration={total},afade=t=in:st=0:d=1,afade=t=out:st={total - 3}:d=3,volume=.09[bed]")
    mix.append("[bed]")
    filters.append("".join(mix) + f"amix=inputs={len(mix)}:duration=longest:normalize=0,atrim=duration={total},"
                   "alimiter=limit=.92,loudnorm=I=-14:TP=-1.5:LRA=11[mix]")
    stem = f"run-{script['source'].get('seed') or 'recap'}"
    video = OUT / f"{stem}.mp4"
    cmd += ["-filter_complex", ";".join(filters), "-map", "0:v:0", "-map", "[mix]", "-c:v", "copy", "-c:a", "aac",
            "-b:a", "192k", "-ar", "48000", "-ac", "2", "-t", str(total), "-movflags", "+faststart", str(video)]
    subprocess.run(cmd, check=True)

    def stamp(t: float) -> str:
        ms = round(t * 1000); h, ms = divmod(ms, 3600000); m, ms = divmod(ms, 60000); s, ms = divmod(ms, 1000)
        return f"{h:02}:{m:02}:{s:02},{ms:03}"

    subs = []
    for i, line in enumerate(lines):
        start = cuts[i] + lead
        end = min(cuts[i + 1] - .1, start + timing["voice_durations"][i])
        chunks = script["shots"][i].get("captions") or [line]
        total_words = sum(len(chunk.split()) for chunk in chunks)
        spoken_words = 0
        for chunk in chunks:
            cue_start = start + (end - start) * spoken_words / total_words
            spoken_words += len(chunk.split())
            cue_end = start + (end - start) * spoken_words / total_words
            subs.append(f"{len(subs) + 1}\n{stamp(cue_start)} --> {stamp(cue_end)}\n{chunk}\n")
    (OUT / f"{stem}.srt").write_text("\n".join(subs), encoding="utf-8")
    print("Video:", video)
    print("Transcript:", OUT / f"{stem}.srt")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
