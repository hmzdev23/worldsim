"""CLI: python3 -m narration STORYBOARD --out DIR [--voice ID] [--model ID]

Exit 0 on success, or when no ELEVENLABS_API_KEY is set (narration is
optional; the recap then renders captions only). Exit 1 on any failure.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Optional, Sequence

from .narrate import DEFAULT_MODEL_ID, DEFAULT_VOICE_ID, NarrationError, load_settings, narrate


def main(argv: Optional[Sequence[str]] = None, *, env: Optional[dict] = None, env_files: Optional[list] = None, post=None) -> int:
    p = argparse.ArgumentParser(prog="narration", description="Speak each storyboard scene with ElevenLabs.")
    p.add_argument("storyboard", type=Path, help="storyboard.json (apps/recap/storyboard.schema.json)")
    p.add_argument("--out", type=Path, required=True, help="directory for <scene_id>.mp3 and narration.json")
    p.add_argument("--voice", help=f"ElevenLabs voice ID (env ELEVENLABS_VOICE_ID, default {DEFAULT_VOICE_ID})")
    p.add_argument("--model", help=f"ElevenLabs model ID (env ELEVENLABS_MODEL_ID, default {DEFAULT_MODEL_ID})")
    p.add_argument("--cache-dir", type=Path, help="audio cache (default OUT/.cache)")
    p.add_argument("--timeout", type=float, default=60.0, help="seconds per request")
    args = p.parse_args(argv)

    settings = load_settings(env, env_files)
    api_key = settings.get("ELEVENLABS_API_KEY", "").strip()
    if not api_key:
        print("narration skipped: ELEVENLABS_API_KEY not set", file=sys.stderr)
        return 0
    kwargs = {"post": post} if post else {}
    try:
        manifest = narrate(
            args.storyboard,
            args.out,
            api_key=api_key,
            voice_id=args.voice or settings.get("ELEVENLABS_VOICE_ID") or DEFAULT_VOICE_ID,
            model_id=args.model or settings.get("ELEVENLABS_MODEL_ID") or DEFAULT_MODEL_ID,
            cache_dir=args.cache_dir,
            timeout_s=args.timeout,
            log=lambda msg: print(msg, file=sys.stderr),
            **kwargs,
        )
    except NarrationError as err:
        print(f"narration failed: {err}", file=sys.stderr)
        return 1
    total = sum(s["duration_s"] for s in manifest["scenes"].values())
    print(f"narration: {len(manifest['scenes'])} scenes, {total:.1f}s -> {args.out / 'narration.json'}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
