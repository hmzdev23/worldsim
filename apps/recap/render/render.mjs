#!/usr/bin/env node
// RECAP-004 (#70): render a recap storyboard to a 9:16 H.264 MP4 plus an .srt.
//
//   node render.mjs --storyboard storyboard.json --out recap.mp4
//                   [--narration audio/narration.json] [--dist ../dist | --stub]
//                   [--hashes frames.sha256] [--max-frames N]
//
// It serves the renderer page (apps/recap/dist from RECAP-003, or the stub in
// ./stub), opens it in headless Chromium, calls window.recap.load(storyboard,
// narration) once, then for every frame awaits window.recap.renderFrame(n),
// captures the #recap canvas as PNG and pipes it to ffmpeg (ffmpeg-static).
// Narration clips are placed at each scene's start_frame / fps. Frame hashes
// (SHA-256 of each PNG) can be written to prove two renders are identical.
//
// Every failure exits non-zero with a message that says which step is
// missing and how to fix it.

import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const STUB_DIR = join(HERE, "stub");
export const DIST_DIR = resolve(HERE, "..", "dist");

export class RecapError extends Error {}

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml",
  ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".glb": "model/gltf-binary", ".wasm": "application/wasm",
  ".mp3": "audio/mpeg",
};

function parseArgs(argv) {
  const args = { stub: false };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    const take = () => {
      if (i + 1 >= argv.length) throw new RecapError(`${key} needs a value`);
      return argv[++i];
    };
    if (key === "--storyboard") args.storyboard = take();
    else if (key === "--narration") args.narration = take();
    else if (key === "--out") args.out = take();
    else if (key === "--dist") args.dist = take();
    else if (key === "--stub") args.stub = true;
    else if (key === "--hashes") args.hashes = take();
    else if (key === "--max-frames") args.maxFrames = Number(take());
    else if (key === "--help" || key === "-h") args.help = true;
    else throw new RecapError(`Unknown option ${key}. Run with --help.`);
  }
  return args;
}

function readJson(path, what) {
  if (!path || !existsSync(path)) throw new RecapError(`${what} not found: ${path ?? "(none given)"}`);
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch (error) {
    throw new RecapError(`${what} is not valid JSON (${path}): ${error.message}`);
  }
}

/** Check the parts of storyboard.json that the export relies on. The full schema is RECAP-001's. */
export function checkStoryboard(storyboard) {
  const format = storyboard?.format ?? {};
  const problems = [];
  if (!Array.isArray(storyboard?.scenes) || storyboard.scenes.length === 0) problems.push("it has no scenes");
  for (const key of ["width", "height", "fps"]) {
    if (!Number.isInteger(format[key]) || format[key] <= 0) problems.push(`format.${key} must be a positive integer`);
  }
  if (format.width % 2 || format.height % 2) problems.push("format width and height must be even for H.264");
  if (problems.length) throw new RecapError(`Storyboard can't be rendered: ${problems.join("; ")}.`);
  return { width: format.width, height: format.height, fps: format.fps };
}

/** Read narration.json and resolve each clip next to it. Missing clips are an error. */
export function loadNarration(path) {
  if (!path) return undefined;
  const narration = readJson(path, "Narration file");
  const scenes = narration?.scenes;
  if (!scenes || typeof scenes !== "object") throw new RecapError(`Narration file has no "scenes" map: ${path}`);
  const clips = {};
  for (const [id, scene] of Object.entries(scenes)) {
    const file = resolve(dirname(path), String(scene?.file ?? ""));
    if (!scene?.file || !existsSync(file)) throw new RecapError(`Narration clip for scene ${id} is missing: ${file}`);
    if (!(scene.duration_s > 0)) throw new RecapError(`Narration for scene ${id} needs a positive duration_s`);
    clips[id] = file;
  }
  return { json: narration, clips };
}

function formatSrtTime(seconds) {
  const ms = Math.round(seconds * 1000);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const pad = (n, w = 2) => String(n).padStart(w, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms % 1000, 3)}`;
}

/** One cue per scene with a caption, timed by the renderer's frame ranges (end_frame exclusive). */
export function buildSrt(storyboard, timing) {
  const captions = new Map(storyboard.scenes.map((scene) => [scene.id, scene.caption]));
  const cues = [];
  for (const scene of timing.scenes) {
    const text = typeof captions.get(scene.id) === "string" ? captions.get(scene.id).trim() : "";
    if (!text) continue;
    const start = scene.start_frame / timing.fps;
    const end = Math.max(scene.end_frame, scene.start_frame + 1) / timing.fps;
    cues.push(`${cues.length + 1}\n${formatSrtTime(start)} --> ${formatSrtTime(end)}\n${text}\n`);
  }
  return cues.join("\n");
}

function checkTiming(timing, format) {
  const ok = timing && Number.isInteger(timing.total_frames) && timing.total_frames > 0 && Array.isArray(timing.scenes);
  if (!ok) throw new RecapError("window.recap.load() must return {fps, total_frames, scenes:[{id,start_frame,end_frame}]}.");
  if (timing.fps !== format.fps) {
    throw new RecapError(`Renderer fps (${timing.fps}) doesn't match the storyboard (${format.fps}).`);
  }
}

/** A minimal static server for the renderer page. Only files inside `root` are served. */
function serve(root) {
  const base = resolve(root);
  const server = createServer((request, response) => {
    const path = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    let file = normalize(join(base, path === "/" ? "index.html" : path));
    if (file !== base && !file.startsWith(base + sep)) {
      response.writeHead(403).end();
      return;
    }
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
    if (!existsSync(file)) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "Content-Type": MIME[extname(file)] ?? "application/octet-stream", "Cache-Control": "no-store" });
    createReadStream(file).pipe(response);
  });
  return new Promise((resolveServer) => {
    server.listen(0, "127.0.0.1", () => resolveServer({ server, url: `http://127.0.0.1:${server.address().port}/` }));
  });
}

async function importOrExplain(name, hint) {
  try {
    return await import(name);
  } catch {
    throw new RecapError(`${name} is not installed. ${hint}`);
  }
}

function ffmpegArgs({ format, totalFrames, timing, clips, out }) {
  const args = ["-hide_banner", "-loglevel", "error", "-y",
    "-f", "image2pipe", "-framerate", String(format.fps), "-c:v", "png", "-i", "-"];
  const placed = timing.scenes.filter((scene) => clips?.[scene.id]);
  for (const scene of placed) args.push("-i", clips[scene.id]);
  if (placed.length) {
    const parts = placed.map((scene, index) => {
      const ms = Math.round((scene.start_frame / format.fps) * 1000);
      return `[${index + 1}:a]adelay=${ms}:all=1[a${index}]`;
    });
    const inputs = placed.map((_, index) => `[a${index}]`).join("");
    parts.push(`${inputs}amix=inputs=${placed.length}:normalize=0:dropout_transition=0[aout]`);
    args.push("-filter_complex", parts.join(";"), "-map", "0:v", "-map", "[aout]", "-c:a", "aac", "-b:a", "160k");
  }
  args.push(
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "medium", "-crf", "18",
    "-r", String(format.fps), "-s", `${format.width}x${format.height}`,
    "-t", (totalFrames / format.fps).toFixed(3), "-movflags", "+faststart", out,
  );
  return args;
}

/** Render a storyboard. Returns {out, srt, frames, hashes, timing}. */
export async function render(options) {
  const storyboardPath = options.storyboard && resolve(options.storyboard);
  const storyboard = readJson(storyboardPath, "Storyboard");
  const format = checkStoryboard(storyboard);
  const narration = loadNarration(options.narration && resolve(options.narration));
  const page_dir = options.stub ? STUB_DIR : resolve(options.dist ?? DIST_DIR);
  if (!existsSync(join(page_dir, "index.html"))) {
    throw new RecapError(options.stub || options.dist
      ? `Renderer page not found: ${join(page_dir, "index.html")}`
      : `Recap renderer is not built (${join(page_dir, "index.html")} is missing). `
        + "Build it with `cd apps/recap && npm install && npm run build` (RECAP-003, #69), or pass --stub.");
  }
  if (!options.out) throw new RecapError("Give an output file with --out recap.mp4.");
  const out = resolve(options.out);
  mkdirSync(dirname(out), { recursive: true });

  const { chromium } = await importOrExplain("playwright", "Run `npm ci` in apps/recap/render.");
  const ffmpegPath = (await importOrExplain("ffmpeg-static", "Run `npm ci` in apps/recap/render.")).default;
  if (!ffmpegPath || !existsSync(ffmpegPath)) {
    throw new RecapError("ffmpeg-static's binary is missing. Its install script downloads it: run "
      + "`node node_modules/ffmpeg-static/install.js` in apps/recap/render (or approve install scripts and `npm ci` again).");
  }

  const { server, url } = await serve(page_dir);
  let browser;
  try {
    try {
      browser = await chromium.launch({
        headless: true,
        // Software WebGL so Three.js renders the same on any machine, GPU or not.
        args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--disable-gpu-driver-bug-workarounds",
          "--force-color-profile=srgb", "--hide-scrollbars", "--font-render-hinting=none"],
      });
    } catch (error) {
      throw new RecapError(`Chromium won't launch: ${error.message.split("\n")[0]}. Run \`npx playwright install chromium\` in apps/recap/render.`);
    }
    const page = await browser.newPage({ viewport: { width: format.width, height: format.height }, deviceScaleFactor: 1 });
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto(url, { waitUntil: "load" });
    try {
      await page.waitForFunction(() => typeof window.recap?.load === "function" && typeof window.recap?.renderFrame === "function",
        undefined, { timeout: 30_000 });
    } catch {
      throw new RecapError(`The renderer page never exposed window.recap.load/renderFrame.${pageErrors.length ? ` Page error: ${pageErrors[0]}` : ""}`);
    }
    const timing = await page.evaluate(([board, voice]) => window.recap.load(board, voice), [storyboard, narration?.json ?? null]);
    checkTiming(timing, format);
    const canvas = page.locator("canvas#recap");
    if (await canvas.count() !== 1) throw new RecapError("The renderer page must have exactly one <canvas id=\"recap\">.");
    const size = await canvas.evaluate((element) => [element.width, element.height]);
    if (size[0] !== format.width || size[1] !== format.height) {
      throw new RecapError(`Canvas is ${size[0]}×${size[1]}, expected ${format.width}×${format.height}.`);
    }

    const totalFrames = options.maxFrames > 0 ? Math.min(options.maxFrames, timing.total_frames) : timing.total_frames;
    const ffmpeg = spawn(ffmpegPath, ffmpegArgs({ format, totalFrames, timing, clips: narration?.clips, out }),
      { stdio: ["pipe", "ignore", "pipe"] });
    let ffmpegLog = "";
    let pipeError;
    ffmpeg.stderr.on("data", (chunk) => { ffmpegLog += chunk; });
    ffmpeg.stdin.on("error", (error) => { pipeError = error; });
    const finished = new Promise((resolveExit) => ffmpeg.on("close", resolveExit));
    const write = (buffer) => new Promise((resolveWrite) => {
      if (pipeError || ffmpeg.stdin.write(buffer)) resolveWrite();
      else ffmpeg.stdin.once("drain", resolveWrite);
    });

    const hashes = [];
    for (let n = 0; n < totalFrames; n++) {
      await page.evaluate((frame) => window.recap.renderFrame(frame), n);
      const png = await canvas.screenshot({ type: "png", animations: "disabled", caret: "hide" });
      hashes.push(createHash("sha256").update(png).digest("hex"));
      await write(png);
      if (options.onFrame) options.onFrame(n + 1, totalFrames);
    }
    ffmpeg.stdin.end();
    const code = await finished;
    if (code !== 0) throw new RecapError(`ffmpeg failed (exit ${code}): ${ffmpegLog.trim().split("\n").slice(-3).join(" ")}`);
    if (pageErrors.length) throw new RecapError(`The renderer page reported an error: ${pageErrors[0]}`);

    const srt = out.replace(/\.mp4$/i, "") + ".srt";
    writeFileSync(srt, buildSrt(storyboard, { ...timing, scenes: timing.scenes }), "utf-8");
    if (options.hashes) writeFileSync(resolve(options.hashes), hashes.map((h, n) => `${h}  frame-${n}`).join("\n") + "\n");
    return { out, srt, frames: totalFrames, hashes, timing, audio: Boolean(narration && Object.keys(narration.clips).length) };
  } finally {
    await browser?.close();
    server.close();
  }
}

const USAGE = `Usage: node render.mjs --storyboard FILE --out FILE.mp4 [--narration FILE] [--dist DIR | --stub]
                      [--hashes FILE] [--max-frames N]`;

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
      console.log(USAGE);
    } else {
      let last = -1;
      const result = await render({
        ...args,
        onFrame(done, total) {
          const percent = Math.floor((done / total) * 10) * 10;
          if (percent !== last) { last = percent; process.stderr.write(`  frames ${done}/${total}\n`); }
        },
      });
      console.log(`Wrote ${result.out} (${result.frames} frames, ${result.audio ? "with narration" : "captions only, no audio"})`);
      console.log(`Wrote ${result.srt}`);
    }
  } catch (error) {
    console.error(`render-recap: ${error instanceof RecapError ? error.message : error.stack}`);
    process.exit(1);
  }
}
