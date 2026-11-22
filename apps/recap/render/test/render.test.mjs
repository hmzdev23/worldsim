// RECAP-004 (#70) checks. Run with `npm test` in apps/recap/render.
// Uses the stub renderer page and a three-scene storyboard, so it needs
// Playwright's Chromium and ffmpeg-static but no model, key or network.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import ffmpegPath from "ffmpeg-static";
import { buildSrt, checkStoryboard, DIST_DIR, render, RecapError } from "../render.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const STORYBOARD = join(HERE, "fixtures", "short.storyboard.json");
const board = JSON.parse(readFileSync(STORYBOARD, "utf-8"));
const scratch = () => mkdtempSync(join(tmpdir(), "recap-test-"));

/** What ffmpeg reports about a file: streams, size, fps and duration. */
function probe(file) {
  const { stderr } = spawnSync(ffmpegPath, ["-hide_banner", "-i", file], { encoding: "utf-8" });
  const video = stderr.match(/Video: (\w+).*?, (\d+)x(\d+).*?, ([\d.]+) fps/);
  const duration = stderr.match(/Duration: (\d+):(\d+):([\d.]+)/);
  return {
    codec: video?.[1], width: Number(video?.[2]), height: Number(video?.[3]), fps: Number(video?.[4]),
    seconds: duration ? Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3]) : NaN,
    audio: /Audio: aac/.test(stderr),
  };
}

function tone(file, seconds, hz) {
  const result = spawnSync(ffmpegPath, ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi",
    "-i", `sine=frequency=${hz}:duration=${seconds}`, "-c:a", "libmp3lame", file]);
  assert.equal(result.status, 0, String(result.stderr));
}

test("renders a 1080x1920, 30 fps H.264 MP4 with an .srt, captions only without narration", async () => {
  const dir = scratch();
  const result = await render({ storyboard: STORYBOARD, stub: true, out: join(dir, "recap.mp4") });
  assert.equal(result.frames, 18);  // 3 scenes × 0.2 s × 30 fps
  assert.equal(result.audio, false);
  const info = probe(result.out);
  assert.deepEqual([info.codec, info.width, info.height, info.fps, info.audio], ["h264", 1080, 1920, 30, false]);
  assert.ok(Math.abs(info.seconds - 0.6) < 0.05, `duration ${info.seconds}`);
  assert.equal(readFileSync(result.srt, "utf-8"), [
    "1\n00:00:00,000 --> 00:00:00,200\nA fissure eruption opens.\n",
    "2\n00:00:00,200 --> 00:00:00,400\nEvacuations ordered in Grindavik.\n",
  ].join("\n"));
});

test("two renders of the same input give identical frame hashes", async () => {
  const dir = scratch();
  const first = await render({ storyboard: STORYBOARD, stub: true, out: join(dir, "a.mp4"), hashes: join(dir, "a.sha256") });
  const second = await render({ storyboard: STORYBOARD, stub: true, out: join(dir, "b.mp4") });
  assert.deepEqual(second.hashes, first.hashes);
  assert.equal(new Set(first.hashes).size, first.hashes.length, "every frame differs from the others");
  assert.equal(readFileSync(join(dir, "a.sha256"), "utf-8").trim().split("\n").length, 18);
});

test("narration clips are placed at each scene's start and lengthen their scenes", async () => {
  const dir = scratch();
  tone(join(dir, "s01-hook.mp3"), 0.5, 440);
  tone(join(dir, "s02-first-hours.mp3"), 0.3, 660);
  writeFileSync(join(dir, "narration.json"), JSON.stringify({
    voice_id: "test-voice", model_id: "test-model",
    scenes: { "s01-hook": { file: "s01-hook.mp3", duration_s: 0.5 }, "s02-first-hours": { file: "s02-first-hours.mp3", duration_s: 0.3 } },
  }));
  const result = await render({ storyboard: STORYBOARD, stub: true, narration: join(dir, "narration.json"), out: join(dir, "voiced.mp4") });
  // Scene lengths are max(min_duration_s, narration): 15 + 9 + 6 frames.
  assert.deepEqual(result.timing.scenes.map((s) => [s.start_frame, s.end_frame]), [[0, 15], [15, 24], [24, 30]]);
  assert.equal(result.audio, true);
  const info = probe(result.out);
  assert.equal(info.audio, true);
  assert.ok(Math.abs(info.seconds - 1.0) < 0.1, `duration ${info.seconds}`);
  assert.match(readFileSync(result.srt, "utf-8"), /2\n00:00:00,500 --> 00:00:00,800\nEvacuations/);
});

test("missing steps fail with a clear message", async () => {
  const dir = scratch();
  const out = join(dir, "x.mp4");
  await assert.rejects(render({ storyboard: join(dir, "none.json"), stub: true, out }), /Storyboard not found/);
  await assert.rejects(render({ storyboard: STORYBOARD, dist: join(dir, "no-dist"), out }), /Renderer page not found/);
  // Without --stub or --dist it looks for apps/recap/dist (RECAP-003); skip if that has been built.
  if (!existsSync(DIST_DIR)) {
    await assert.rejects(render({ storyboard: STORYBOARD, out }),
      (error) => error instanceof RecapError && /not built/.test(error.message) && /--stub/.test(error.message));
  }
  writeFileSync(join(dir, "narration.json"), JSON.stringify({ scenes: { "s01-hook": { file: "gone.mp3", duration_s: 1 } } }));
  await assert.rejects(render({ storyboard: STORYBOARD, stub: true, narration: join(dir, "narration.json"), out }),
    /Narration clip for scene s01-hook is missing/);
});

test("the committed Japan and Iceland sample storyboards (RECAP-001) load and render reproducibly", async () => {
  for (const name of ["japan-earthquake", "iceland-eruption"]) {
    const sample = join(HERE, "..", "..", "samples", `${name}.storyboard.json`);
    if (!existsSync(sample)) continue;  // samples land with #67
    const scenes = JSON.parse(readFileSync(sample, "utf-8")).scenes;
    const dir = scratch();
    const first = await render({ storyboard: sample, stub: true, out: join(dir, "a.mp4"), maxFrames: 20 });
    const second = await render({ storyboard: sample, stub: true, out: join(dir, "b.mp4"), maxFrames: 20 });
    assert.deepEqual(second.hashes, first.hashes, name);
    assert.deepEqual(first.timing.scenes.map((s) => s.id), scenes.map((s) => s.id), name);
    const seconds = scenes.reduce((sum, s) => sum + s.min_duration_s, 0);
    assert.equal(first.timing.total_frames, Math.round(seconds * 30), name);
    assert.equal(first.frames, 20);
  }
});

test("storyboard format checks", () => {
  assert.deepEqual(checkStoryboard(board), { width: 1080, height: 1920, fps: 30 });
  assert.throws(() => checkStoryboard({ ...board, scenes: [] }), /no scenes/);
  assert.throws(() => checkStoryboard({ ...board, format: { width: 1081, height: 1920, fps: 30 } }), /even/);
  assert.throws(() => checkStoryboard({ ...board, format: { width: 1080, height: 1920 } }), /fps/);
});

test("srt skips scenes without a caption and never has zero-length cues", () => {
  const srt = buildSrt(board, { fps: 30, scenes: [
    { id: "s01-hook", start_frame: 0, end_frame: 0 },
    { id: "s03-final", start_frame: 1, end_frame: 9 },
  ] });
  assert.equal(srt, "1\n00:00:00,000 --> 00:00:00,033\nA fissure eruption opens.\n");
});
