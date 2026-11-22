#!/usr/bin/env node
// Local renderer for the recap film prototypes, without the external Lemo-Opuscar checkout.
// Serves a film folder, drives its deterministic window.render(t) in headless Chromium
// (Playwright from apps/web) and pipes frames into ffmpeg.
//
//   node render-local.mjs FILM_DIR --three DIR [--out FILE] [--fps 30] [--size 1080x1920]
//                        [--shot N] [--from S --to S] [--still S --out frame.png]
//
// FILM_DIR holds index.html; `assets/` is served from ../../assets when the film
// folder has none. --three is a folder whose node_modules contains three.
import {createServer} from 'node:http';
import {readFile, stat} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
const film = path.resolve(args[0] ?? '');
const threeRoot = path.resolve(opt('three', process.env.THREE_ROOT ?? ''));
const fps = Number(opt('fps', 30));
const [width, height] = opt('size', '1080x1920').split('x').map(Number);
const shot = opt('shot');
const still = opt('still');
const out = path.resolve(opt('out', path.join(film, 'output.mp4')));
const assets = path.resolve(here, 'assets');
const types = {'.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json',
  '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg', '.mp3': 'audio/mpeg'};

function resolve(urlPath) {
  const p = decodeURIComponent(urlPath.split('?')[0]);
  const map = [['/node_modules/', path.join(threeRoot, 'node_modules')], ['/@film/assets/', assets], ['/@film/', film]];
  for (const [prefix, dir] of map) if (p.startsWith(prefix)) {
    const full = path.resolve(dir, p.slice(prefix.length));
    if (full.startsWith(dir + path.sep)) return full;  // never serve outside the mapped folder
  }
  return null;
}

const server = createServer(async (req, res) => {
  const file = resolve(req.url);
  try {
    if (!file || !(await stat(file)).isFile()) throw new Error('missing');
    res.writeHead(200, {'Content-Type': types[path.extname(file)] ?? 'application/octet-stream'});
    res.end(await readFile(file));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/@film/index.html`;

const require = createRequire(path.resolve(here, '../../apps/web/package.json'));
const {chromium} = require('playwright');
const browser = await chromium.launch({args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']});
const page = await browser.newPage({viewport: {width, height}, deviceScaleFactor: 1});
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') console.error('[page]', m.text()); });
page.on('pageerror', e => { console.error('[page error]', e.message); });
await page.goto(shot === undefined ? base : `${base}?shot=${shot}`);
await page.waitForFunction(() => window.READY === true, null, {timeout: 120000});
const duration = await page.evaluate(() => window.DUR);

if (still !== undefined) {
  await page.evaluate(t => window.render(t), Number(still));
  await page.screenshot({path: out, type: out.endsWith('.png') ? 'png' : 'jpeg'});
  console.log(`still ${still}s -> ${out}`);
} else {
  const from = Number(opt('from', 0)), to = Math.min(duration, Number(opt('to', duration)));
  const frames = Math.round((to - from) * fps);
  const ff = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg',
    '-i', '-', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'medium', '-crf', '19', '-r', String(fps), out], {stdio: ['pipe', 'inherit', 'inherit']});
  const started = Date.now();
  for (let n = 0; n < frames; n++) {
    await page.evaluate(t => window.render(t), from + n / fps);
    const jpg = await page.screenshot({type: 'jpeg', quality: 92});
    if (!ff.stdin.write(jpg)) await new Promise(r => ff.stdin.once('drain', r));
    if (n % (fps * 2) === 0) process.stderr.write(`\rframe ${n}/${frames} (${((Date.now() - started) / 1000).toFixed(0)}s)`);
  }
  ff.stdin.end();
  await new Promise((r, j) => ff.on('close', c => c === 0 ? r() : j(new Error(`ffmpeg exited ${c}`))));
  console.log(`\n${frames} frames (${(to - from).toFixed(2)}s) -> ${out}`);
}
await browser.close();
server.close();
