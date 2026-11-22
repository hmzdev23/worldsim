// Satirical Iceland recap: eight deterministic Three.js shots driven by script.json
// (text from worldwire.satire) and timing.json (cuts fitted to the narration).
// window.render(t) draws time t; nothing reads the wall clock or unseeded randomness.
import * as T from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';

const W = innerWidth, H = innerHeight;
const renderer = new T.WebGLRenderer({antialias: true, preserveDrawingBuffer: true});
renderer.setPixelRatio(1); renderer.setSize(W, H); renderer.outputColorSpace = T.SRGBColorSpace;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap;
document.body.prepend(renderer.domElement);

const base = '/@film/';
const script = await (await fetch(`${base}script.json`)).json();
const timing = await (await fetch(`${base}timing.json`)).json();
const coast = await (await fetch(`${base}map-north-atlantic.json`)).json();
const loader = new GLTFLoader(), pool = {};
const wanted = [['city-kit-commercial', 'building-a'], ['city-kit-commercial', 'building-d'], ['city-kit-commercial', 'building-f'],
  ['city-kit-suburban', 'building-type-e'], ['city-kit-suburban', 'tree-small'], ['city-kit-roads', 'light-curved'],
  ['city-kit-roads', 'traffic-light'], ['car-kit', 'sedan'], ['car-kit', 'delivery'], ['car-kit', 'ambulance']];
await Promise.all(wanted.map(async ([pack, name]) => {
  try { pool[name] = (await loader.loadAsync(`${base}assets/${pack}/Models/GLB format/${name}.glb`)).scene; }
  catch (e) { console.warn('asset unavailable', name, String(e)); }
}));

// ---- helpers ---------------------------------------------------------------
const rand = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };  // seeded
const mat = (c, extra = {}) => new T.MeshStandardMaterial({color: c, roughness: .85, ...extra});
const glow = (c, i = 1.4) => new T.MeshStandardMaterial({color: c, emissive: c, emissiveIntensity: i});
function block(parent, x, y, z, w, h, d, m) {
  const mesh = new T.Mesh(new T.BoxGeometry(w, h, d), typeof m === 'number' ? mat(m) : m);
  mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh;
}
function model(name, height, x, z, rot = 0) {
  const src = pool[name]; if (!src) return new T.Group();
  const m = src.clone(true), size = new T.Vector3(); new T.Box3().setFromObject(m).getSize(size);
  m.scale.setScalar(height / (size.y || 1)); m.position.set(x, 0, z); m.rotation.y = rot;
  m.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } }); return m;
}
function textTexture(lines, {w = 1024, h = 256, bg = '#0f1a33', fg = '#ffffff', font = 900, size = 92, accent} = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  if (accent) { g.fillStyle = accent; g.fillRect(0, h - 18, w, 18); }
  g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
  lines.forEach((line, i) => { g.font = `${font} ${i ? size * .6 : size}px Arial`; g.fillText(line, w / 2, h / 2 + (i - (lines.length - 1) / 2) * size * 1.05); });
  const tex = new T.CanvasTexture(c); tex.colorSpace = T.SRGBColorSpace; return tex;
}
function sign(parent, lines, x, y, z, w, h, opts = {}, rotY = 0) {
  const m = new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({map: textTexture(lines, opts), toneMapped: false}));
  m.position.set(x, y, z); m.rotation.y = rotY; parent.add(m); return m;
}
function sky(scene, top, horizon) {
  const s = new T.Mesh(new T.SphereGeometry(120, 32, 16), new T.ShaderMaterial({
    uniforms: {top: {value: new T.Color(top)}, horizon: {value: new T.Color(horizon)}},
    vertexShader: 'varying vec3 vW; void main(){vec4 p=modelMatrix*vec4(position,1.0); vW=p.xyz; gl_Position=projectionMatrix*viewMatrix*p;}',
    fragmentShader: 'uniform vec3 top; uniform vec3 horizon; varying vec3 vW; void main(){float h=normalize(vW-cameraPosition).y; gl_FragColor=vec4(mix(horizon,top,smoothstep(-0.1,0.5,h)),1.0);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}',
    side: T.BackSide, depthWrite: false}));
  s.frustumCulled = false; s.renderOrder = -1; scene.add(s);
}
function lights(scene, {sun = 0xffe2b3, power = 2.4, ambient = 1.8} = {}) {
  scene.add(new T.HemisphereLight(0xffe7c8, 0x5e6260, ambient));
  const d = new T.DirectionalLight(sun, power); d.position.set(-10, 18, 10); d.castShadow = true;
  d.shadow.mapSize.set(1024, 1024); Object.assign(d.shadow.camera, {left: -26, right: 26, top: 26, bottom: -26}); scene.add(d);
}
function aircraft(g, x, y, z, rot = 0, livery = 0xf1ede2) {
  const p = new T.Group(); p.position.set(x, y, z); p.rotation.y = rot; g.add(p);
  const body = new T.Mesh(new T.CylinderGeometry(.5, .7, 9, 14), mat(livery)); body.rotation.z = Math.PI / 2; body.castShadow = true; p.add(body);
  block(p, 0, 0, 0, 2.1, .16, 8.2, 0xc9c9bf); block(p, 3.7, .35, 0, 1.8, .12, 2.8, 0xc9c9bf); block(p, 3.7, .95, 0, 1.1, 1.6, .12, 0xd7262e);
  for (let i = -3; i < 3; i += .8) block(p, i, .18, .62, .26, .22, .04, 0x415c68); return p;
}
const ground = (scene, c, size = 60) => block(scene, 0, -.15, 0, size, .3, size, c);

// ---- scenes ----------------------------------------------------------------
function mapScene(pullOut) {
  const s = new T.Scene(); s.background = new T.Color(0x9ec3c9);
  s.add(new T.HemisphereLight(0xffffff, 0x61706b, 2.4)); const sun = new T.DirectionalLight(0xfff0d0, 1.6); sun.position.set(-6, 12, 7); s.add(sun);
  const k = 1.1, lon0 = -12, lat0 = 60, cos = Math.cos(lat0 * Math.PI / 180);
  const xy = (lon, lat) => [(lon - lon0) * k * cos, (lat - lat0) * k];
  for (const [iso, rings] of Object.entries(coast)) for (const ring of rings) {
    const shape = new T.Shape(); ring.forEach(([lon, lat], i) => { const [x, y] = xy(lon, lat); i ? shape.lineTo(x, y) : shape.moveTo(x, y); });
    const m = new T.Mesh(new T.ExtrudeGeometry(shape, {depth: iso === 'ISL' ? .5 : .25, bevelEnabled: false}), mat(iso === 'ISL' ? 0xf2e3c4 : 0xd7d2bd));
    m.rotation.x = -Math.PI / 2; s.add(m);
  }
  const [vx, vy] = xy(-22.27, 63.88);
  const pin = new T.Mesh(new T.SphereGeometry(.32, 16, 10), glow(0xff4b1f, 1.2)); pin.position.set(vx, .7, -vy); s.add(pin);
  const ring = new T.Mesh(new T.RingGeometry(.5, .62, 40), new T.MeshBasicMaterial({color: 0xff4b1f, transparent: true, side: T.DoubleSide}));
  ring.rotation.x = -Math.PI / 2; ring.position.set(vx, .55, -vy); s.add(ring);
  // The ash cloud drifts toward the UK, exactly where the satirical airline would rather it didn't.
  const ash = new T.Group(); for (let i = 0; i < 26; i++) {
    const puff = new T.Mesh(new T.IcosahedronGeometry(.55 + rand(i) * .5, 1), new T.MeshStandardMaterial({color: 0x6d6a66, transparent: true, opacity: .55, depthWrite: false}));
    puff.userData.t = rand(i + 50); puff.userData.off = [(rand(i + 9) - .5) * 1.6, (rand(i + 19) - .5) * 1.6]; ash.add(puff);
  }
  s.add(ash); const [ux, uy] = xy(-1.5, 54);
  s.userData.tick = (t) => {
    ring.scale.setScalar(1 + (t * .9 % 1) * 2.2); ring.material.opacity = 1 - (t * .9 % 1);
    ash.children.forEach(p => { const f = Math.min(1, (p.userData.t * .6 + t * .09)); p.position.set(vx + (ux - vx) * f + p.userData.off[0], 1.2 + f * .4, -(vy + (uy - vy) * f) + p.userData.off[1]); });
  };
  s.userData.camera = pullOut
    ? {from: [vx + 2, 18, -vy + 16], to: [vx + 4, 32, -vy + 30], look: [vx + 4, 0, -vy + 9]}
    : {from: [vx + 4, 24, -vy + 24], to: [vx + 1, 12, -vy + 13], look: [vx + 1, 0, -vy + 5]};
  return s;
}

function eruptionScene() {
  const s = new T.Scene(); sky(s, 0x37394a, 0xd9774a); lights(s, {sun: 0xffb27a, power: 1.6, ambient: 1.3}); s.fog = new T.Fog(0x8a6a5c, 25, 80);
  ground(s, 0x3b3532, 90);
  for (let i = 0; i < 30; i++) block(s, (rand(i) - .5) * 60, .2, -10 - rand(i + 3) * 30, 2 + rand(i + 5) * 4, .4 + rand(i + 7), 2 + rand(i + 8) * 3, 0x4a423c);
  const ridge = block(s, 0, .7, -14, 22, 1.4, 2.2, 0x2e2a28);
  const fissure = block(s, 0, 1.45, -14, 21, .14, .7, glow(0xff5a1a, 2.2));
  const fountains = []; for (let i = 0; i < 9; i++) { const f = new T.Mesh(new T.ConeGeometry(.45, 2.4, 10), glow(0xff7a22, 2)); f.position.set(-9 + i * 2.25, 2.4, -14); s.add(f); fountains.push(f); }
  const flows = []; for (let i = 0; i < 3; i++) { const fl = block(s, -6 + i * 6, .04, -10, 1.6, .12, 1, glow(0xff4a12, 1.6)); flows.push(fl); }
  const ash = []; for (let i = 0; i < 60; i++) { const p = new T.Mesh(new T.IcosahedronGeometry(1, 1), new T.MeshStandardMaterial({color: 0x57524e, transparent: true, opacity: .8, depthWrite: false})); p.userData.seed = i; s.add(p); ash.push(p); }
  const light = new T.PointLight(0xff6a2a, 60, 40, 1.6); light.position.set(0, 4, -12); s.add(light);
  for (let i = 0; i < 5; i++) s.add(model('building-type-e', 2.6, 12 + i * 3.2, 4 - i * 1.5, -Math.PI / 3));
  // The joke: a permit sign standing politely next to an active fissure.
  block(s, -1.4, 1.6, -1, .14, 3.2, .14, 0x6b5b45);
  sign(s, ['PERMIT REQUIRED', 'FOR ALL LAVA'], -1.4, 3.7, -.92, 3.4, 1.2, {bg: '#f6f1e3', fg: '#10131b', accent: '#d7262e', size: 104});
  s.userData.tick = (t) => {
    fountains.forEach((f, i) => { const k = .7 + .5 * Math.abs(Math.sin(t * 3 + i * 1.7)); f.scale.set(1, k, 1); f.position.y = 1.45 + 1.2 * k; });
    fissure.material.emissiveIntensity = 1.8 + .6 * Math.sin(t * 7);
    flows.forEach((fl, i) => { const len = 1 + Math.min(t * 1.6, 9) * (1 - i * .15); fl.scale.z = len; fl.position.z = -12.5 + len * .5; });
    ash.forEach(p => { const n = p.userData.seed, age = (t * .35 + rand(n)) % 1; p.position.set(-8 + rand(n + 1) * 16 + age * 6, 3 + age * 18, -14 - rand(n + 2) * 3 + age * 2); p.scale.setScalar(.8 + age * 2.6); p.material.opacity = .85 * (1 - age); });
    light.intensity = 50 + 15 * Math.sin(t * 9);
  };
  s.userData.camera = {from: [6, 3.2, 17], to: [1.5, 3.6, 14], look: [-1, 2.6, -8]};
  return s;
}

function streetScene(lightsOn = true) {
  const s = new T.Scene(); sky(s, 0x6f8fae, 0xe7c9b0); lights(s, {power: lightsOn ? 2.4 : 1.2});
  block(s, 0, -.14, -5, 24, .25, 44, 0x484945); block(s, -5, .03, -5, 3.2, .18, 44, 0xb9ac98); block(s, 5, .03, -5, 3.2, .18, 44, 0xb9ac98);
  for (let z = -24; z < 14; z += 4) block(s, 0, .015, z, .1, .02, 1.8, 0xe9d1a1);
  const types = ['building-a', 'building-d', 'building-f', 'building-type-e'];
  for (const side of [-1, 1]) for (let i = 0; i < 8; i++) s.add(model(types[(i + (side > 0)) % 4], 4 + (i % 3) * 1.6, side * 8.3, -22 + i * 4.6, side === 1 ? -Math.PI / 2 : Math.PI / 2));
  for (let z = -18; z < 12; z += 8) { s.add(model('light-curved', 4, -3.1, z)); s.add(model('tree-small', 2.3, 3.8, z)); }
  return s;
}

function evacuationScene() {
  const s = streetScene();
  // An orderly queue of cars leaves town; the brochure insists this is how it went.
  const cars = []; for (let i = 0; i < 9; i++) { const c = model(i % 4 === 3 ? 'delivery' : 'sedan', 1.4, -1.6, 6 - i * 3.1, Math.PI); s.add(c); cars.push(c); }
  block(s, 2.6, 3, -8, .16, 6, .16, 0x555555); block(s, 5.4, 3, -8, .16, 6, .16, 0x555555);
  sign(s, ['EVACUATE IN AN', 'ORDERLY QUEUE :)', 'OFFICIAL BROCHURE · PAGE 1 OF 48'], 4, 5.6, -7.9, 4.6, 2.5, {bg: '#ffd23f', fg: '#0f1a33', size: 86, h: 420, w: 768});
  s.userData.tick = (t) => cars.forEach((c, i) => { c.position.z = 6 - i * 3.1 - t * 2.2; });
  s.userData.camera = {from: [-1, 4.2, 16], to: [1, 3.6, 12], look: [1.5, 1.4, -6]};
  return s;
}

function powerScene(restored) {
  const s = new T.Scene(); sky(s, restored ? 0x5d7fa6 : 0x1d2436, restored ? 0xf0c8a0 : 0x48506a); lights(s, {power: restored ? 2.2 : .7, ambient: restored ? 1.8 : .8});
  ground(s, 0x5a5a52, 80);
  const windows = [];
  const hall = (x, z, w, h) => { block(s, x, h / 2, z, w, h, 5, 0xcfd3d4); for (let i = 0; i < Math.floor(w / 1.3); i++) for (let j = 0; j < Math.floor(h / 1.6); j++) { const win = block(s, x - w / 2 + .9 + i * 1.3, 1 + j * 1.6, z + 2.52, .7, .7, .05, glow(0xffe08a, 1.6)); windows.push(win); } };
  hall(-5, -8, 8, 5); hall(5, -10, 7, 7);
  for (let i = 0; i < 4; i++) { const pipe = new T.Mesh(new T.CylinderGeometry(.32, .32, 26, 12), mat(0x9aa3a8, {metalness: .4})); pipe.rotation.z = Math.PI / 2; pipe.position.set(4, .9 + i * .8, 2 - i * 1.4); pipe.castShadow = true; s.add(pipe); }
  const steam = []; for (let i = 0; i < 24; i++) { const p = new T.Mesh(new T.IcosahedronGeometry(1, 1), new T.MeshStandardMaterial({color: 0xf4f4f0, transparent: true, opacity: .7, depthWrite: false})); p.userData.seed = i; s.add(p); steam.push(p); }
  const feature = sign(s, restored ? ['RECOVERY: BASICALLY', 'FINISHED'] : ["IT'S A FEATURE", 'NOT A BUG'], 0, 7.8, -7.4, 8, 2, {bg: '#0f1a33', fg: '#ffd23f', accent: '#d7262e', size: 110});
  s.userData.tick = (t) => {
    const on = restored || t < 1.4;
    windows.forEach((w, i) => { w.material.emissiveIntensity = on ? 1.6 : (i % 11 === 0 ? .15 : 0); w.material.color.setHex(on ? 0xffe08a : 0x2b2e36); });
    feature.visible = restored || t > 1.9;
    steam.forEach(p => { const n = p.userData.seed, age = (t * .3 + rand(n)) % 1; p.position.set(5 + rand(n + 1) * 3 - 1.5 + age * 2, 7 + age * 9, -10 + rand(n + 2) * 2); p.scale.setScalar(.6 + age * 2.2); p.material.opacity = .65 * (1 - age); });
  };
  s.userData.camera = restored ? {from: [-2, 4, 16], to: [-4, 8, 22], look: [0, 4, -8]} : {from: [9, 3.5, 12], to: [3, 4.4, 10], look: [0, 4.5, -8]};
  return s;
}

function airportScene() {
  const s = new T.Scene(); sky(s, 0x8d8a86, 0xc8b9a6); lights(s, {power: 1.4}); s.fog = new T.Fog(0xa29a90, 14, 55);
  ground(s, 0x6f6e68, 90); for (let n = -4; n <= 4; n++) block(s, 0, .02, n * 5, .25, .02, 2.6, 0xf2e1bc);
  block(s, -2, 3, -16, 30, 6, 6, 0xc9c2b4); for (let j = 0; j < 10; j++) block(s, -15 + j * 3, 3.2, -12.95, 2.2, 2.2, .1, 0x5d7682);
  aircraft(s, -7, 2, -4, .25); aircraft(s, 4, 2, -6, -.2, 0xe8eef4); aircraft(s, 11, 2, 3, -.6);
  const board = sign(s, ['DEPARTURES', 'REYKJAVIK   CANCELLED', 'NEW YORK    CANCELLED'], -3, 7.6, -12.9, 9, 3.4, {bg: '#111', fg: '#ffd23f', size: 92, h: 384});
  const ash = []; for (let i = 0; i < 40; i++) { const p = new T.Mesh(new T.IcosahedronGeometry(1, 1), new T.MeshStandardMaterial({color: 0x7d7770, transparent: true, opacity: .35, depthWrite: false})); p.position.set((rand(i) - .5) * 50, 10 + rand(i + 4) * 8, -30 + rand(i + 6) * 30); p.scale.setScalar(2 + rand(i + 2) * 3); s.add(p); ash.push(p); }
  s.userData.tick = (t) => { board.material.opacity = 1; board.scale.y = 1; ash.forEach((p, i) => { p.position.x = ((rand(i) - .5) * 50 + t * 1.3 + 25) % 50 - 25; }); };
  s.userData.camera = {from: [14, 3.4, 13], to: [8, 3.8, 11], look: [-2, 3, -8]};
  return s;
}

function briefingScene() {
  const s = new T.Scene(); s.background = new T.Color(0x1c2436); lights(s, {power: 1.2, ambient: 1.4});
  block(s, 0, -.1, 0, 30, .2, 30, 0x2c3550); block(s, 0, 5, -8, 30, 10, .3, 0x24304c);
  sign(s, ['THE SITUATION', 'REMAINS FLUID'], 0, 4.4, -7.8, 7.5, 2.4, {bg: '#0f1a33', fg: '#ffffff', accent: '#ffd23f', size: 112, h: 320});
  block(s, 0, 1.3, -4, 2.6, 2.6, 1.2, 0x7a5a3a);
  sign(s, ['DEPT. OF', 'SITUATIONAL AWARENESS'], 0, 1.7, -3.38, 2.4, .9, {bg: '#f6f1e3', fg: '#0f1a33', size: 96, w: 1024});
  for (let i = -2; i <= 2; i++) { const mic = new T.Mesh(new T.CylinderGeometry(.04, .04, .9, 8), mat(0x222222)); mic.position.set(i * .3, 3, -3.6); mic.rotation.x = -.5; s.add(mic); block(s, i * .3, 3.42, -3.38, .14, .2, .14, i % 2 ? 0xd7262e : 0x333333); }
  for (let r = 0; r < 3; r++) for (let c = 0; c < 7; c++) { block(s, -4.5 + c * 1.5, .45, 1 + r * 1.8, .9, .1, .9, 0x3b4766); block(s, -4.5 + c * 1.5, .9, 1.45 + r * 1.8, .9, .9, .1, 0x3b4766); }
  const flashes = []; for (let i = 0; i < 4; i++) { const f = new T.PointLight(0xffffff, 0, 14, 1.5); f.position.set(-4 + i * 2.7, 2.6, 4); s.add(f); flashes.push(f); }
  s.userData.tick = (t) => flashes.forEach((f, i) => { const phase = (t * 1.7 + rand(i) * 3) % 1; f.intensity = phase < .06 ? 140 : 0; });
  s.userData.camera = {from: [2.5, 2.6, 13], to: [0, 2.8, 10.5], look: [0, 2.2, -5]};
  return s;
}

function aidScene() {
  const s = new T.Scene(); sky(s, 0x6d92b8, 0xf0d3b0); lights(s);
  ground(s, 0x7a776d, 80); aircraft(s, -3, 2, -6, .15);
  for (let j = 0; j < 8; j++) block(s, -3 + (j % 4) * 1.2, .5 + Math.floor(j / 4), 1, 1, .9, 1, 0x9c7b56);
  s.add(model('delivery', 2.1, -9, 3, -Math.PI / 2));
  // The 600-page customs form, growing one page at a time.
  const stack = block(s, 3.5, .5, 1, 2.2, 1, 2.8, 0xf7f4ea); const stamp = block(s, 3.5, 1, 1, .8, .1, .8, 0xd7262e);
  const label = sign(s, ['CUSTOMS FORM', 'PAGE 1 OF 600'], 3.5, .6, 2.42, 2.1, .66, {bg: '#ffffff', fg: '#10131b', size: 110, w: 768});
  s.userData.tick = (t) => { const h = 1 + Math.min(t, 6) * 1.1; stack.scale.y = h; stack.position.y = h / 2; label.position.y = Math.min(h - .4, 1.2); stamp.position.y = h + .1 + Math.max(0, .6 - (t * 2 % 1.4)); };
  s.userData.camera = {from: [11, 3, 13], to: [9, 3.8, 11], look: [2, 2.6, -1]};
  return s;
}

const builders = {map: () => mapScene(false), eruption: eruptionScene, evacuation: evacuationScene, power: () => powerScene(false),
  airport: airportScene, briefing: briefingScene, aid: aidScene, summary: () => mapScene(true)};
const scenes = script.shots.map(shot => builders[shot.scene]());

// ---- overlays ----------------------------------------------------------------
const $ = (q) => document.querySelector(q);
const ticker = 'FICTIONAL SIMULATION  ·  NO REAL COMPANIES, OFFICIALS OR VOLCANOES WERE CONSULTED  ·  ' +
  script.stats.map(m => `${m.label.toUpperCase()}: ${m.value}`).join('  ·  ') + '  ·  ';
$('#ticker div').textContent = ticker.repeat(4);
const stats = script.stats.filter(m => m.value > 0);
$('#stats .rows').innerHTML = stats.map(m => `<div class="row"><span>${m.label}</span><b data-v="${m.value}">0</b></div>`).join('');
$('#stats p').textContent = script.disclaimer;
const tickerWidth = () => $('#ticker div').scrollWidth / 4;

const camera = new T.PerspectiveCamera(46, W / H, .1, 260);
const cuts = timing.cuts, total = cuts[cuts.length - 1];
const shotParam = new URLSearchParams(location.search).get('shot');
const selected = shotParam === null ? -1 : Number(shotParam);
if (selected !== -1 && !(Number.isInteger(selected) && selected >= 0 && selected < scenes.length)) throw new Error('Invalid shot');
window.DUR = selected < 0 ? total : cuts[selected + 1] - cuts[selected];
const ease = (x) => x < .5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2;

window.render = (localTime) => {
  const time = selected < 0 ? localTime : cuts[selected] + localTime;
  let i = scenes.length - 1;
  for (let k = 0; k < scenes.length; k++) if (time < cuts[k + 1]) { i = k; break; }
  const local = Math.max(0, time - cuts[i]), len = cuts[i + 1] - cuts[i];
  const scene = scenes[i], cam = scene.userData.camera, f = ease(Math.min(local / len, 1));
  camera.position.set(...cam.from.map((v, k) => v + (cam.to[k] - v) * f)); camera.lookAt(...cam.look);
  scene.userData.tick?.(local);
  const data = script.shots[i];
  $('#date').textContent = data.date;
  $('#chyron .headline').textContent = data.headline;
  $('#chyron').style.transform = `translateX(${Math.max(0, 1 - local / .35) * -110}%)`;
  const post = $('#post');
  if (data.post) {
    post.querySelector('.avatar').textContent = data.post.author[0];
    post.querySelector('.name').textContent = data.post.author;
    post.querySelector('.handle').textContent = data.post.handle;
    post.querySelector('.text').textContent = data.post.text;
    const k = Math.min(1, Math.max(0, (local - .8) / .35)); post.style.opacity = k; post.style.transform = `translateY(${(1 - k) * 40}px) scale(${.96 + k * .04})`;
  } else post.style.opacity = 0;
  const card = $('#stats'), last = i === scenes.length - 1;
  card.style.opacity = last ? Math.min(1, Math.max(0, (local - .5) / .4)) : 0;
  if (last) card.querySelectorAll('b').forEach(b => { b.textContent = Math.round(Number(b.dataset.v) * Math.min(1, Math.max(0, (local - .8) / 2))); });
  $('#ticker div').style.transform = `translateX(${-((time * 140) % tickerWidth())}px)`;
  renderer.render(scene, camera);
};
window.READY = true; window.render(0);
