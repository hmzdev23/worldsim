#!/usr/bin/env python3
"""Build one run's recap film in an isolated background job directory."""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TEMPLATE = ROOT / "experiments" / "recap-films" / "films" / "run"
JOBS = ROOT / ".cache" / "recap-films"


def run(args: list[str], stage: str, cwd: Path | None = None) -> None:
    print(f"STAGE:{stage}", flush=True)
    subprocess.run(args, cwd=cwd, check=True)


def main() -> int:
    if len(sys.argv) != 3:
        raise SystemExit("usage: recap-film-job.py RUN_ID TONE")
    run_id, tone = sys.argv[1:]
    if not run_id or any(char not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-" for char in run_id):
        raise SystemExit("invalid run id")
    if tone not in {"straight", "satirical"}:
        raise SystemExit("invalid tone")

    server = os.environ.get("SIMULATION_HTTP_URL", "http://127.0.0.1:8765").rstrip("/")
    request = urllib.request.Request(f"{server}/scenarios/{run_id}/result")
    with urllib.request.urlopen(request, timeout=30) as response:
        result = json.load(response)
    seed = result.get("seed")
    if not isinstance(seed, int):
        raise SystemExit("the canonical run result has no seed")

    job_dir = JOBS / run_id
    if job_dir.exists():
        shutil.rmtree(job_dir)
    shutil.copytree(TEMPLATE, job_dir, ignore=shutil.ignore_patterns("__pycache__", "output", "script.json", "timing.json"))
    result_path = job_dir / "result.json"
    result_path.write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")
    python = os.environ.get("PYTHON_EXECUTABLE", "python3")
    node = os.environ.get("NODE_EXECUTABLE", "node")
    film_tone = "satirical"

    run([python, str(job_dir / "make-script.py"), "--result", str(result_path), "--tone", film_tone], "script")
    run([python, str(job_dir / "make-audio.py")], "narration")
    picture = job_dir / "output" / "picture.mp4"
    picture.parent.mkdir(parents=True, exist_ok=True)
    run([node, str(ROOT / "experiments" / "recap-films" / "render-local.mjs"), str(job_dir),
         "--three", os.environ.get("THREE_ROOT", ""), "--out", str(picture)], "render")
    run([python, str(job_dir / "assemble.py"), str(picture)], "assemble")
    video = job_dir / "output" / f"run-{seed}.mp4"
    if not video.is_file():
        raise SystemExit("recap renderer completed without producing a video")
    (job_dir / "video.txt").write_text(video.name, encoding="utf-8")
    print("STAGE:ready", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
