#!/usr/bin/env python3
"""Narrate script.json with ElevenLabs and write timing.json (shot cuts fitted to the voice).

    python3 make-audio.py             # voice every line (cached), then fit the cuts
    python3 make-audio.py --estimate  # no API call: estimated cuts, for previews and stills

The key comes from ELEVENLABS_API_KEY or the repo's untracked .env.local. Clips
are cached by a hash of text, voice and model, so re-runs cost nothing. Sound
effects and music are reused from the team's other films (no generation calls).
"""
from __future__ import annotations

import hashlib
import json
import os
import ssl
import subprocess
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = next(p for p in HERE.parents if (p / "services").is_dir())
AUDIO = HERE / "audio"
VOICE = "XA3P1cj7XJexe6Zq0ATX"  # the team's chosen narrator voice for every recap film
MODEL = "eleven_multilingual_v2"
LEAD_IN, TAIL, MIN_SHOT = 0.25, 0.55, 3.5
MAX_SECONDS = 50.0  # hard cap for the whole film, outro included


def tls_context() -> ssl.SSLContext:
    """Trusted certificates for HTTPS, wherever python3 came from.

    The python.org build on macOS has no trusted certificates until its
    "Install Certificates" step is run, so HTTPS fails with
    CERTIFICATE_VERIFY_FAILED. Use certifi when installed, else the system bundle.
    """
    try:
        import certifi
        return ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        pass
    for bundle in ("/etc/ssl/cert.pem", "/etc/ssl/certs/ca-certificates.crt"):
        if os.path.exists(bundle):
            return ssl.create_default_context(cafile=bundle)
    return ssl.create_default_context()


def api_key() -> str:
    key = os.environ.get("ELEVENLABS_API_KEY", "")
    env = ROOT / ".env.local"
    if not key and env.is_file():
        for line in env.read_text(encoding="utf-8").splitlines():
            name, _, value = line.partition("=")
            if name.strip().removeprefix("export ").strip() == "ELEVENLABS_API_KEY":
                key = value.strip().strip("'\"")
    if not key:
        raise SystemExit("ELEVENLABS_API_KEY not set (environment or .env.local)")
    return key


def duration(path: Path) -> float:
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
                         capture_output=True, text=True, check=True)
    return float(out.stdout.strip())


def speak(text: str, key: str) -> bytes:
    body = {"text": text, "model_id": MODEL,
            "voice_settings": {"stability": 0.6, "similarity_boost": 0.75, "speed": 1.08}}
    req = urllib.request.Request(
        f"https://api.elevenlabs.io/v1/text-to-speech/{VOICE}?output_format=mp3_44100_128",
        data=json.dumps(body).encode(), method="POST",
        headers={"xi-api-key": key, "Content-Type": "application/json", "Accept": "audio/mpeg"})
    try:
        with urllib.request.urlopen(req, timeout=90, context=tls_context()) as resp:
            data = resp.read()
    except urllib.error.HTTPError as err:
        raise SystemExit(f"ElevenLabs HTTP {err.code}: {err.read()[:200].decode('utf-8', 'replace')}".replace(key, "[redacted]"))
    if len(data) < 1000:
        raise SystemExit("ElevenLabs returned too little audio")
    return data


def main() -> int:
    import sys
    estimate = "--estimate" in sys.argv[1:]
    script = json.loads((HERE / "script.json").read_text(encoding="utf-8"))
    AUDIO.mkdir(exist_ok=True)
    key = None
    cuts, voices = [0.0], []
    for i, shot in enumerate(script["shots"], 1):
        if estimate:  # about 0.36 s per word at the narrator's pace
            length = len(shot["narration"].split()) * 0.36
            voices.append(round(length, 3))
            cuts.append(round(cuts[-1] + max(MIN_SHOT, LEAD_IN + length + TAIL), 2))
            continue
        digest = hashlib.sha256(f"{shot['narration']}|{VOICE}|{MODEL}".encode()).hexdigest()[:16]
        clip, stamp = AUDIO / f"voice-{i:02}.mp3", AUDIO / f"voice-{i:02}.txt"
        if not (clip.is_file() and stamp.is_file() and stamp.read_text() == digest):
            key = key or api_key()
            clip.write_bytes(speak(shot["narration"], key))
            stamp.write_text(digest)
            print(f"voice-{i:02}: generated ({len(shot['narration'])} characters)")
        else:
            print(f"voice-{i:02}: cached")
        length = duration(clip)
        voices.append(round(length, 3))
        cuts.append(round(cuts[-1] + max(MIN_SHOT, LEAD_IN + length + TAIL), 2))
    outro = float(script.get("outro_seconds", 0))
    if cuts[-1] + outro > MAX_SECONDS:
        raise SystemExit(f"film would run {cuts[-1] + outro:.1f}s (limit {MAX_SECONDS:.0f}s): shorten the narration in make-script.py")
    timing = {"estimated": estimate, "cuts": cuts, "outro": outro, "voice_durations": voices, "lead_in": LEAD_IN, "voice_id": VOICE, "model_id": MODEL}
    (HERE / "timing.json").write_text(json.dumps(timing, indent=2) + "\n", encoding="utf-8")
    (AUDIO / "narration-lines.json").write_text(
        json.dumps([s["narration"] for s in script["shots"]], indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"total {cuts[-1] + outro:.1f}s (outro {outro}s), cuts {cuts}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
