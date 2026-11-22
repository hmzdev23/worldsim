"""Storyboard scenes -> ElevenLabs speech -> DIR/<scene_id>.mp3 + DIR/narration.json."""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import urllib.error
import urllib.request
from pathlib import Path
from typing import Callable, Optional, Tuple

from .mp3 import mp3_duration

API_URL = "https://api.elevenlabs.io/v1/text-to-speech/{voice_id}?output_format={output_format}"
DEFAULT_VOICE_ID = "JBFqnCBsd6RMkjVDRZzb"  # "George", a premade ElevenLabs voice
DEFAULT_MODEL_ID = "eleven_multilingual_v2"
OUTPUT_FORMAT = "mp3_44100_128"
MAX_TEXT_CHARS = 5000
REPO_ROOT = Path(__file__).resolve().parents[3]
_SCENE_ID = re.compile(r"^s[0-9]{2}-[a-z0-9-]+$")
_SAFE_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")

# post(url, headers, body_bytes, timeout_s) -> (status, response_bytes)
Post = Callable[[str, dict, bytes, float], Tuple[int, bytes]]


class NarrationError(Exception):
    pass


def http_post(url: str, headers: dict, body: bytes, timeout_s: float) -> Tuple[int, bytes]:
    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout_s) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as err:
        return err.code, err.read()


def read_env_file(path: Path) -> dict:
    out = {}
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return out
    for line in lines:
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip().removeprefix("export ").strip()
        out[key] = value.strip().strip("'\"")
    return out


def load_settings(env: Optional[dict] = None, env_files: Optional[list] = None) -> dict:
    """ELEVENLABS_* from the environment, falling back to untracked .env.local files."""
    env = os.environ if env is None else env
    files = env_files if env_files is not None else [Path.cwd() / ".env.local", REPO_ROOT / ".env.local"]
    merged: dict = {}
    for path in reversed(files):  # earlier files win
        merged.update(read_env_file(Path(path)))
    merged.update({k: v for k, v in env.items() if k.startswith("ELEVENLABS_")})
    return merged


def _redact(text: str, key: str) -> str:
    return text.replace(key, "[redacted]") if key else text


def cache_key(text: str, voice_id: str, model_id: str, output_format: str = OUTPUT_FORMAT) -> str:
    blob = json.dumps([text, voice_id, model_id, output_format], ensure_ascii=False).encode("utf-8")
    return hashlib.sha256(blob).hexdigest()


def load_storyboard(path: Path) -> dict:
    try:
        board = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise NarrationError(f"could not read storyboard {path}: {exc}") from None
    scenes = board.get("scenes") if isinstance(board, dict) else None
    if not isinstance(scenes, list) or not scenes:
        raise NarrationError("storyboard has no scenes")
    seen = set()
    for i, scene in enumerate(scenes):
        sid = scene.get("id") if isinstance(scene, dict) else None
        if not isinstance(sid, str) or not _SCENE_ID.match(sid):
            raise NarrationError(f"scenes[{i}].id must match {_SCENE_ID.pattern}")
        if sid in seen:
            raise NarrationError(f"duplicate scene id {sid}")
        seen.add(sid)
        text = scene.get("narration")
        if not isinstance(text, str) or not text.strip():
            raise NarrationError(f"scene {sid} has no narration text")
        if len(text) > MAX_TEXT_CHARS:
            raise NarrationError(f"scene {sid} narration is longer than {MAX_TEXT_CHARS} characters")
    return board


def synthesize(text: str, *, api_key: str, voice_id: str, model_id: str, post: Post, timeout_s: float) -> bytes:
    url = API_URL.format(voice_id=voice_id, output_format=OUTPUT_FORMAT)
    headers = {"xi-api-key": api_key, "Content-Type": "application/json", "Accept": "audio/mpeg"}
    body = json.dumps({"text": text, "model_id": model_id}).encode("utf-8")
    try:
        status, data = post(url, headers, body, timeout_s)
    except OSError as exc:  # URLError, timeouts, DNS
        raise NarrationError(_redact(f"could not reach ElevenLabs: {exc}", api_key)) from None
    if status != 200:
        detail = data[:300].decode("utf-8", "replace")
        raise NarrationError(_redact(f"ElevenLabs returned HTTP {status}: {detail}", api_key))
    if not data:
        raise NarrationError("ElevenLabs returned empty audio")
    return data


def narrate(
    storyboard_path: Path,
    out_dir: Path,
    *,
    api_key: str,
    voice_id: str = DEFAULT_VOICE_ID,
    model_id: str = DEFAULT_MODEL_ID,
    cache_dir: Optional[Path] = None,
    post: Post = http_post,
    timeout_s: float = 60.0,
    log: Callable[[str], None] = lambda _msg: None,
) -> dict:
    """Speak every scene and write narration.json. Returns it. Raises NarrationError."""
    if not api_key:
        raise NarrationError("ELEVENLABS_API_KEY is not set")
    for name, value in (("voice", voice_id), ("model", model_id)):
        if not _SAFE_ID.match(value or ""):
            raise NarrationError(f"invalid {name} id {value!r}")
    board = load_storyboard(storyboard_path)
    out_dir = Path(out_dir)
    cache_dir = Path(cache_dir) if cache_dir else out_dir / ".cache"
    out_dir.mkdir(parents=True, exist_ok=True)
    cache_dir.mkdir(parents=True, exist_ok=True)

    scenes = {}
    for scene in board["scenes"]:
        sid, text = scene["id"], scene["narration"].strip()
        cached = cache_dir / f"{cache_key(text, voice_id, model_id)}.mp3"
        if cached.is_file() and cached.stat().st_size:
            log(f"{sid}: cached")
            audio = cached.read_bytes()
        else:
            log(f"{sid}: speaking {len(text)} characters")
            audio = synthesize(text, api_key=api_key, voice_id=voice_id, model_id=model_id, post=post, timeout_s=timeout_s)
            tmp = cached.with_suffix(".tmp")
            tmp.write_bytes(audio)
            tmp.replace(cached)
        try:
            duration = mp3_duration(audio)
        except ValueError:
            cached.unlink(missing_ok=True)  # never reuse a bad cache entry
            raise NarrationError(f"scene {sid}: ElevenLabs did not return MP3 audio") from None
        shutil.copyfile(cached, out_dir / f"{sid}.mp3")
        scenes[sid] = {"file": f"{sid}.mp3", "duration_s": round(duration, 3)}

    manifest = {"voice_id": voice_id, "model_id": model_id, "scenes": scenes}
    tmp = out_dir / "narration.json.tmp"
    tmp.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    tmp.replace(out_dir / "narration.json")
    return manifest
