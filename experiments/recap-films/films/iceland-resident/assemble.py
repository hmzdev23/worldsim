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

# (effect, shot index, offset into the shot, seconds, volume)
EFFECTS = [("rumble", 1, 0.0, 4.4, .34), ("alert", 1, 1.1, 1.2, .25), ("siren", 2, 0.0, 3.4, .22),
           ("alert", 2, 1.1, 1.2, .22), ("power", 3, 1.5, 2.8, .32), ("airport", 4, 0.0, 4.4, .24),
           ("crowd", 5, 0.0, 4.4, .18), ("alert", 6, 1.1, 1.2, .2)]
OUTRO = 3.5  # stats card after the last line (storyboard.js uses the same value)


def main() -> int:
    picture = Path(sys.argv[1]) if len(sys.argv) > 1 else OUT / "picture.mp4"
    timing = json.loads((HERE / "timing.json").read_text())
    lines = json.loads((AUDIO / "narration-lines.json").read_text())
    cuts, lead = timing["cuts"], timing["lead_in"]
    total = round(cuts[-1] + OUTRO, 2)
    OUT.mkdir(exist_ok=True)
    cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(picture)]
    filters, mix, n = [], [], 1
    for i in range(len(lines)):
        cmd += ["-i", str(AUDIO / f"voice-{i + 1:02}.mp3")]
        filters.append(f"[{n}:a]aresample=48000,adelay={int((cuts[i] + lead) * 1000)}:all=1[v{i}]")
        mix.append(f"[v{i}]"); n += 1
    for j, (name, shot, offset, dur, vol) in enumerate(EFFECTS):
        cmd += ["-i", str(AUDIO / f"sfx-{name}.mp3")]
        filters.append(f"[{n}:a]aresample=48000,atrim=duration={dur},afade=t=in:st=0:d=0.08,"
                       f"afade=t=out:st={max(0, dur - .4)}:d=0.4,volume={vol},adelay={int((cuts[shot] + offset) * 1000)}:all=1[e{j}]")
        mix.append(f"[e{j}]"); n += 1
    cmd += ["-stream_loop", "3", "-i", str(AUDIO / "sfx-music.mp3")]
    filters.append(f"[{n}:a]aresample=48000,atrim=duration={total},afade=t=in:st=0:d=1,afade=t=out:st={total - 3}:d=3,volume=.09[bed]")
    mix.append("[bed]")
    filters.append("".join(mix) + f"amix=inputs={len(mix)}:duration=longest:normalize=0,atrim=duration={total},"
                   "alimiter=limit=.92,loudnorm=I=-14:TP=-1.5:LRA=11[mix]")
    video = OUT / "iceland-resident.mp4"
    cmd += ["-filter_complex", ";".join(filters), "-map", "0:v:0", "-map", "[mix]", "-c:v", "copy", "-c:a", "aac",
            "-b:a", "192k", "-ar", "48000", "-ac", "2", "-t", str(total), "-movflags", "+faststart", str(video)]
    subprocess.run(cmd, check=True)

    def stamp(t: float) -> str:
        ms = round(t * 1000); h, ms = divmod(ms, 3600000); m, ms = divmod(ms, 60000); s, ms = divmod(ms, 1000)
        return f"{h:02}:{m:02}:{s:02},{ms:03}"

    subs = []
    for i, line in enumerate(lines):
        start = cuts[i] + lead
        end = min(cuts[i + 1] - .1, start + timing["voice_durations"][i] + .15)
        subs.append(f"{i + 1}\n{stamp(start)} --> {stamp(end)}\n{line}\n")
    (OUT / "iceland-resident.srt").write_text("\n".join(subs), encoding="utf-8")
    print("Video:", video)
    print("Transcript:", OUT / "iceland-resident.srt")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
