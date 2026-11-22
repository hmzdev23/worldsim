// Desktop integration check: npm run test (requires npx playwright install chromium).
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const server = spawn('npm', ['run', 'dev', '--', '--port', '4174', '--strictPort'], { stdio: 'pipe' });
let browser;
try {
  let ready = false;
  for (let i = 0; i < 100 && !ready; i++) {
    if (server.exitCode !== null) throw new Error('Vite failed to start');
    try { ready = (await fetch('http://127.0.0.1:4174/')).ok; } catch { /* starting */ }
    if (!ready) await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert(ready, 'Vite did not start');
  browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 540, height: 960 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:4174/');
  await page.waitForFunction(() => !!window.recap);
  let example;
  for (const name of ['japan-earthquake', 'iceland-eruption']) {
    const storyboard = JSON.parse(await readFile(new URL(`../samples/${name}.storyboard.json`, import.meta.url), 'utf8'));
    example = storyboard;
    const result = await page.evaluate(async story => {
      const narration = { scenes: { [story.scenes[0].id]: { duration_s: 7.41 } } };
      const timeline = await window.recap.load(story, narration);
      const canvas = document.querySelector('#recap');
      const identical = [];
      for (const range of timeline.scenes) {
        const n = Math.floor((range.start_frame + range.end_frame - 1) / 2);
        await window.recap.renderFrame(n); const first = canvas.toDataURL();
        await window.recap.renderFrame(range.start_frame);
        await window.recap.renderFrame(n); identical.push(first === canvas.toDataURL());
      }
      return { timeline, identical };
    }, storyboard);
    assert(result.identical.every(Boolean), `${name}: frame depends on previous frame`);
    assert.equal(result.timeline.scenes[0].end_frame, Math.ceil(7.41 * storyboard.format.fps));
    assert.equal(result.timeline.scenes.at(-1).end_frame, result.timeline.total_frames);
    for (let i = 1; i < result.timeline.scenes.length; i++) assert.equal(result.timeline.scenes[i].start_frame, result.timeline.scenes[i - 1].end_frame);
    console.log(`${name}: ${result.identical.length} deterministic scenes and narration ranges`);
  }
  for (const vignette of ['power_out', 'water_out', 'evacuation', 'tsunami_siren', 'flooding', 'contamination', 'economic', 'aftershock', 'government', 'generic']) {
    const shot = structuredClone(example.scenes.find(s => s.kind === 'vignette'));
    shot.data.vignette = vignette;
    await page.evaluate(async story => { await window.recap.load(story); await window.recap.renderFrame(50); }, { ...example, scenes: [shot] });
  }
  assert.deepEqual(errors, []);
  console.log('All ten vignette variants rendered without browser errors.');
} finally {
  await browser?.close(); server.kill('SIGTERM');
}
