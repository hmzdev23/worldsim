"""RECAP-002 narration: offline, with a fake ElevenLabs HTTP client (no network, no credits)."""

import contextlib
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "services" / "narration"))

from narration import NarrationError, cache_key, load_settings, mp3_duration, narrate  # noqa: E402
from narration.__main__ import main  # noqa: E402

SAMPLES = ROOT / "apps" / "recap" / "samples"
JAPAN = SAMPLES / "japan-earthquake.storyboard.json"
ICELAND = SAMPLES / "iceland-eruption.storyboard.json"
KEY = "sk_test_0123456789abcdef"


def fake_mp3(seconds: float, *, id3: bool = True) -> bytes:
    """Valid MPEG-1 Layer III frames (128 kbps, 44.1 kHz), optional ID3v2 tag."""
    frames = round(seconds * 44100 / 1152)
    frame = b"\xff\xfb\x90\x00" + b"\x00" * 413  # 417-byte frame, no padding
    tag = b"ID3\x04\x00\x00\x00\x00\x00\x0a" + b"\x00" * 10 if id3 else b""
    return tag + frame * frames


class FakeElevenLabs:
    def __init__(self, status=200, body=None, seconds_per_char=0.05):
        self.calls = []
        self.status, self.body, self.spc = status, body, seconds_per_char

    def __call__(self, url, headers, body, timeout_s):
        self.calls.append({"url": url, "headers": headers, "json": json.loads(body), "timeout": timeout_s})
        if self.body is not None:
            return self.status, self.body
        return self.status, fake_mp3(len(json.loads(body)["text"]) * self.spc)


class Mp3DurationTest(unittest.TestCase):
    def test_counts_frames(self):
        for secs in (0.5, 3.0, 12.25):
            self.assertAlmostEqual(mp3_duration(fake_mp3(secs)), secs, delta=0.03)
        self.assertAlmostEqual(mp3_duration(fake_mp3(2.0, id3=False) + b"TAG" + b"\x00" * 125), 2.0, delta=0.03)

    def test_rejects_non_audio(self):
        for junk in (b"", b'{"detail": "nope"}', b"\x00" * 1000):
            with self.assertRaises(ValueError):
                mp3_duration(junk)


class NarrateTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(lambda: __import__("shutil").rmtree(self.tmp, ignore_errors=True))

    def run_narrate(self, board=JAPAN, fake=None, **kw):
        fake = fake or FakeElevenLabs()
        out = narrate(board, self.tmp / "out", api_key=KEY, post=fake, **kw)
        return out, fake

    def test_request_shape(self):
        _, fake = self.run_narrate(voice_id="voice123", model_id="eleven_turbo_v2_5")
        board = json.loads(JAPAN.read_text(encoding="utf-8"))
        self.assertEqual(len(fake.calls), len(board["scenes"]))
        call = fake.calls[0]
        self.assertEqual(call["url"], "https://api.elevenlabs.io/v1/text-to-speech/voice123?output_format=mp3_44100_128")
        self.assertEqual(call["headers"]["xi-api-key"], KEY)
        self.assertEqual(call["headers"]["Accept"], "audio/mpeg")
        self.assertEqual(call["json"], {"text": board["scenes"][0]["narration"], "model_id": "eleven_turbo_v2_5"})

    def test_writes_mp3s_and_manifest_in_the_agreed_shape(self):
        manifest, _ = self.run_narrate(board=ICELAND)
        on_disk = json.loads((self.tmp / "out" / "narration.json").read_text(encoding="utf-8"))
        self.assertEqual(on_disk, manifest)
        self.assertEqual(set(on_disk), {"voice_id", "model_id", "scenes"})
        board = json.loads(ICELAND.read_text(encoding="utf-8"))
        self.assertEqual(list(on_disk["scenes"]), [s["id"] for s in board["scenes"]])
        for scene in board["scenes"]:
            entry = on_disk["scenes"][scene["id"]]
            self.assertEqual(set(entry), {"file", "duration_s"})
            self.assertEqual(entry["file"], f"{scene['id']}.mp3")
            self.assertTrue((self.tmp / "out" / entry["file"]).is_file())
            self.assertAlmostEqual(entry["duration_s"], len(scene["narration"].strip()) * 0.05, delta=0.05)
        self.assertNotIn(KEY, json.dumps(on_disk))

    def test_cache_hit_makes_no_second_call(self):
        cache = self.tmp / "cache"
        self.run_narrate(cache_dir=cache)
        manifest, fake = self.run_narrate(cache_dir=cache)
        self.assertEqual(fake.calls, [])
        self.assertTrue(manifest["scenes"])
        _, fake = self.run_narrate(cache_dir=cache, voice_id="othervoice")  # new voice -> new audio
        self.assertTrue(fake.calls)
        self.assertNotEqual(cache_key("a", "v", "m"), cache_key("a", "v", "m2"))
        self.assertNotEqual(cache_key("a", "v", "m"), cache_key("b", "v", "m"))

    def test_http_error_redacts_key_and_writes_no_manifest(self):
        fake = FakeElevenLabs(status=401, body=json.dumps({"detail": f"invalid key {KEY}"}).encode())
        with self.assertRaises(NarrationError) as ctx:
            self.run_narrate(fake=fake)
        self.assertIn("HTTP 401", str(ctx.exception))
        self.assertNotIn(KEY, str(ctx.exception))
        self.assertIn("[redacted]", str(ctx.exception))
        self.assertFalse((self.tmp / "out" / "narration.json").exists())

    def test_network_error_and_non_audio_reply(self):
        def offline(*_):
            raise OSError(f"connection refused for {KEY}")

        with self.assertRaises(NarrationError) as ctx:
            self.run_narrate(fake=offline)
        self.assertNotIn(KEY, str(ctx.exception))
        cache = self.tmp / "c"
        with self.assertRaises(NarrationError):
            self.run_narrate(fake=FakeElevenLabs(body=b"<html>oops</html>"), cache_dir=cache)
        self.assertEqual(list(cache.glob("*.mp3")), [])  # bad audio is not cached

    def test_bad_storyboards_and_ids(self):
        bad = self.tmp / "bad.json"
        for board in ({}, {"scenes": []}, {"scenes": [{"id": "../x", "narration": "hi"}]},
                      {"scenes": [{"id": "s01-a", "narration": " "}]},
                      {"scenes": [{"id": "s01-a", "narration": "hi"}, {"id": "s01-a", "narration": "yo"}]}):
            bad.write_text(json.dumps(board))
            with self.assertRaises(NarrationError):
                self.run_narrate(board=bad)
        with self.assertRaises(NarrationError):
            self.run_narrate(voice_id="../../v1/user")


class CliTest(unittest.TestCase):
    def cli(self, *args, env=None, env_files=(), post=None):
        err = io.StringIO()
        with contextlib.redirect_stderr(err):
            code = main(list(args), env=env or {}, env_files=list(env_files), post=post)
        return code, err.getvalue()

    def test_no_key_skips_and_exits_zero(self):
        with tempfile.TemporaryDirectory() as tmp:
            code, err = self.cli(str(JAPAN), "--out", tmp)
            self.assertEqual(code, 0)
            self.assertIn("narration skipped: ELEVENLABS_API_KEY not set", err)
            self.assertFalse((Path(tmp) / "narration.json").exists())

    def test_key_from_env_local_and_settings_from_env(self):
        with tempfile.TemporaryDirectory() as tmp:
            env_file = Path(tmp) / ".env.local"
            env_file.write_text(f"# local only\nexport ELEVENLABS_API_KEY='{KEY}'\nELEVENLABS_VOICE_ID=fromfile\n")
            fake = FakeElevenLabs()
            code, err = self.cli(str(ICELAND), "--out", str(Path(tmp) / "out"),
                                 env={"ELEVENLABS_VOICE_ID": "fromenv"}, env_files=[env_file], post=fake)
            self.assertEqual(code, 0, err)
            self.assertIn("/text-to-speech/fromenv?", fake.calls[0]["url"])  # environment beats the file
            self.assertEqual(fake.calls[0]["headers"]["xi-api-key"], KEY)
            self.assertNotIn(KEY, err)
            self.assertTrue((Path(tmp) / "out" / "narration.json").is_file())

    def test_failure_exits_one_without_leaking_the_key(self):
        with tempfile.TemporaryDirectory() as tmp:
            fake = FakeElevenLabs(status=500, body=KEY.encode())
            code, err = self.cli(str(JAPAN), "--out", tmp, env={"ELEVENLABS_API_KEY": KEY}, post=fake)
            self.assertEqual(code, 1)
            self.assertIn("narration failed", err)
            self.assertNotIn(KEY, err)

    def test_settings_precedence(self):
        with tempfile.TemporaryDirectory() as tmp:
            a, b = Path(tmp) / "a", Path(tmp) / "b"
            a.write_text("ELEVENLABS_API_KEY=first\n")
            b.write_text("ELEVENLABS_API_KEY=second\nELEVENLABS_MODEL_ID=m\nOTHER=x\n")
            self.assertEqual(load_settings({}, [a, b])["ELEVENLABS_API_KEY"], "first")
            self.assertEqual(load_settings({"ELEVENLABS_API_KEY": "env"}, [a, b])["ELEVENLABS_API_KEY"], "env")
            self.assertEqual(load_settings({}, [a, b])["ELEVENLABS_MODEL_ID"], "m")
            self.assertNotIn("PATH", load_settings({"PATH": "/bin"}, []))


if __name__ == "__main__":
    unittest.main()
