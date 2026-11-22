// "Sigrún's three days": the Iceland eruption fixture followed through one invented resident.
// Seven deterministic Three.js shots plus an outro card. Text comes from script.json
// (fixture facts + worldwire.satire notifications); cuts come from timing.json.
// window.render(t) depends only on t: no wall clock, no unseeded randomness.
import * as T from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {clone as cloneSkeleton} from 'three/addons/utils/SkeletonUtils.js';

const W = innerWidth, H = innerHeight;
const renderer = new T.WebGLRenderer({antialias: true, preserveDrawingBuffer: true});
renderer.setPixelRatio(1); renderer.setSize(W, H); renderer.outputColorSpace = T.SRGBColorSpace;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap;
document.body.prepend(renderer.domElement);

const base = '/@film/';
const script = await (await fetch(`${base}script.json`)).json();
const timing = await (await fetch(`${base}timing.json`)).json();
const loader = new GLTFLoader(), pool = {}, people = {};
const wanted = [['city-kit-commercial', 'building-a'], ['city-kit-commercial', 'building-d'], ['city-kit-commercial', 'building-f'],
  ['city-kit-suburban', 'building-type-e'], ['city-kit-suburban', 'tree-small'], ['city-kit-roads', 'light-curved'],
  ['car-kit', 'sedan'], ['train-kit', 'train-electric-city-a']];
await Promise.all([
  ...wanted.map(async ([pack, name]) => { try { pool[name] = (await loader.loadAsync(`${base}assets/${pack}/Models/GLB format/${name}.glb`)).scene; } catch (e) { console.warn('asset unavailable', name, String(e)); } }),
  ...['man', 'woman'].map(async (k) => { people[k] = await loader.loadAsync(`${base}assets/${k}.glb`); }),
]);

// ---- helpers ---------------------------------------------------------------
const rand = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
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
function textTexture(lines, {w = 1024, h = 256, bg = '#0f1a33', fg = '#ffffff', size = 92, accent} = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, w, h); if (accent) { g.fillStyle = accent; g.fillRect(0, h - 18, w, 18); }
  g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
  lines.forEach((line, i) => { g.font = `900 ${i ? size * .6 : size}px Arial`; g.fillText(line, w / 2, h / 2 + (i - (lines.length - 1) / 2) * size * 1.05); });
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
function lights(scene, {sun = 0xffe2b3, power = 2.2, ambient = 1.8, from = [-10, 18, 10]} = {}) {
  scene.add(new T.HemisphereLight(0xffe7c8, 0x5e6260, ambient));
  const d = new T.DirectionalLight(sun, power); d.position.set(...from); d.castShadow = true;
  d.shadow.mapSize.set(1024, 1024); Object.assign(d.shadow.camera, {left: -20, right: 20, top: 20, bottom: -20}); scene.add(d); return d;
}

// People: Quaternius CC0 characters. Every clip is played with weight 0 or 1 and
// mixer.setTime(t) poses them, so any frame renders the same in any order.
const HERO = 0xffc53d;  // the protagonist always wears yellow
const CLIP = (kind, base) => `HumanArmature|${kind === 'man' ? 'Man' : 'Female'}_${base}`;
// Plausible locals for Grindavík: fair skin tones, blond, light brown and red hair.
const LOCALS = {skin: [0xf5d9c4, 0xf0cdb5, 0xeac2a6, 0xf2d2bd, 0xe8bfa0], hair: [0xd8b575, 0xc29a5b, 0x8a6034, 0xa2552c, 0x5a3d24, 0xe0c48a]};
const HERO_LOOK = {skin: 0xf3d4bf, hair: 0xd9b46c};
let lookSeed = 0;
function person(parent, kind, x, z, rot, shirt, clip = 'Idle', phase = 0, look = null) {
  const asset = people[kind], p = cloneSkeleton(asset.scene);
  p.scale.setScalar(.29); p.position.set(x, 0, z); p.rotation.y = rot; parent.add(p);
  // Shirt, skin and hair are recoloured per person: the protagonist has a fixed look and
  // everyone else is drawn from the setting's palette (seeded, so every frame matches).
  const n = ++lookSeed, pick = (list, k) => list[Math.floor(rand(n * 7.3 + k) * list.length)];
  look = look ?? (shirt === HERO ? HERO_LOOK : {skin: pick(LOCALS.skin, 1), hair: pick(LOCALS.hair, 2)});
  const colours = {Shirt: shirt, Skin: look.skin, Hair: look.hair, HairBase: look.hair};
  p.traverse(o => { if (!o.isMesh) return; o.castShadow = true; o.receiveShadow = true;
    const fix = (m) => { if (!(m.name in colours)) return m; const c = m.clone(); c.color.setHex(colours[m.name]); return c; };
    o.material = Array.isArray(o.material) ? o.material.map(fix) : fix(o.material); });
  const mixer = new T.AnimationMixer(p), actions = {};
  for (const name of ['Idle', 'Walk', 'Run', 'Sitting', 'Standing']) {
    const c = asset.animations.find(a => a.name === CLIP(kind, name)); if (!c) continue;
    const a = mixer.clipAction(c);
    if (name === 'Sitting') { a.setLoop(T.LoopOnce, 1); a.clampWhenFinished = true; }  // hold the seated pose
    a.play(); a.setEffectiveWeight(0); actions[name] = a;
  }
  p.userData.pose = (name, t) => {
    // reset(): a finished play-once clip pauses itself, which would freeze it on frame 0 next time.
    for (const [n, a] of Object.entries(actions)) { a.reset(); a.setEffectiveWeight(n === name ? 1 : 0); }
    mixer.setTime(name === 'Sitting' ? 60 : t + phase);  // seated people stay seated
  };
  p.userData.pose(clip, 0); p.userData.clip = clip; return p;
}
// Every model here (people, Kenney cars, train cabs) faces local +Z. Anything that moves
// is placed with go(): heading always follows velocity, so nothing travels backwards.
// Speeds match the clips (about 1 unit/s walking, 2.4 running) so feet don't slide.
const WALK = 1.0, RUN = 2.4;
function go(obj, x0, z0, dx, dz, dist) {
  const len = Math.hypot(dx, dz) || 1;
  obj.position.x = x0 + dx / len * dist; obj.position.z = z0 + dz / len * dist;
  obj.rotation.y = Math.atan2(dx, dz);
}
const crowdShirts = [0x5b7aa6, 0x8c5a4a, 0x4f7a5a, 0x6c6c78, 0x9a7b4f, 0x7a4f6c];

// ---- sets ------------------------------------------------------------------
function apartment(s, {morning = true} = {}) {
  const room = new T.Group(); s.add(room);
  // A closed room (floor, four walls, ceiling) so no edge of the set is ever in frame.
  block(room, 0, -.05, 2, 9, .1, 12, 0xb48a60);
  block(room, 0, 1.6, -3, 9, 3.2, .15, 0xe9ddc7); block(room, -4.4, 1.6, 2, .15, 3.2, 12, 0xdfd0b5);
  block(room, 4.4, 1.6, 2, .15, 3.2, 12, 0xdfd0b5).castShadow = false; block(room, 0, 1.6, 8, 9, 3.2, .15, 0xe9ddc7).castShadow = false;
  block(room, 0, 3.25, 2, 9, .1, 12, 0xf3ede0).castShadow = false;
  const fill = new T.PointLight(0xfff0d8, 10, 14); fill.position.set(1, 2.8, 3); room.add(fill);
  const win = block(room, 1.6, 1.9, -2.9, 2.2, 1.3, .05, glow(morning ? 0xffd9a8 : 0x9fc9e8, morning ? .9 : .7));
  block(room, 1.6, 1.9, -2.88, .06, 1.3, .06, 0xffffff); block(room, 1.6, 1.9, -2.88, 2.2, .06, .06, 0xffffff);
  block(room, -1.6, .45, -2.55, 3, .9, .7, 0xc8b79c); block(room, -1.6, .92, -2.55, 3.05, .05, .75, 0x8a7b67);   // counter
  const toaster = block(room, -1.1, 1.08, -2.5, .42, .28, .26, mat(0xc6c9cc, {metalness: .6, roughness: .3}));
  const toast = [block(room, -1.17, 1.12, -2.5, .03, .22, .18, 0xd9a35c), block(room, -1.03, 1.12, -2.5, .03, .22, .18, 0xd9a35c)];
  block(room, -2.3, 1.2, -2.5, .25, .35, .25, 0x4f7a8a); // kettle
  block(room, 1.2, .38, .3, 1.8, .06, 1.1, 0x7a5a3a); for (const [x, z] of [[.4, -.1], [2, -.1], [.4, .7], [2, .7]]) block(room, x, .18, z, .07, .36, .07, 0x6a4c30); // table
  const shelfY = [1.5, 2.1], items = [];
  for (const y of shelfY) block(room, -4.2, y, -.5, .3, .05, 2.6, 0x8a6a4a);
  for (let i = 0; i < 8; i++) { const it = block(room, -4.15, shelfY[i % 2] + .14, -1.6 + i * .32, .16, .22 + rand(i) * .15, .16, [0xd7262e, 0x4f7a8a, 0xf2e6c8, 0x6a8a4f][i % 4]); it.userData.y0 = it.position.y; items.push(it); }
  const lamp = new T.Group(); lamp.position.set(1.2, 3.1, .3); room.add(lamp);
  block(lamp, 0, -.35, 0, .02, .7, .02, 0x333333); const shade = new T.Mesh(new T.ConeGeometry(.28, .3, 16, 1, true), mat(0xf0e2c0, {side: T.DoubleSide})); shade.position.y = -.8; lamp.add(shade);
  const bulb = new T.PointLight(0xffd9a0, 6, 6); bulb.position.y = -.85; lamp.add(bulb);
  return {room, toaster, toast, items, lamp};
}

function street(s, {cars = true, fog = 0xd9cbb6} = {}) {
  // The road and two rows of buildings run 120 units into fog, over a ground plane
  // that reaches the horizon, so the set never ends inside the frame.
  s.fog = new T.Fog(fog, 30, 95);
  block(s, 0, -.3, -30, 400, .2, 400, 0x7d7a6c);
  block(s, 0, -.14, -40, 24, .25, 130, 0x484945); block(s, -5, .03, -40, 3.2, .18, 130, 0xb9ac98); block(s, 5, .03, -40, 3.2, .18, 130, 0xb9ac98);
  for (let z = -100; z < 22; z += 4) block(s, 0, .015, z, .1, .02, 1.8, 0xe9d1a1);
  const types = ['building-a', 'building-d', 'building-f', 'building-type-e'];
  for (const side of [-1, 1]) for (let i = 0; i < 26; i++) {
    s.add(model(types[(i + (side > 0)) % 4], 4 + (i % 3) * 1.6, side * 8.3, -100 + i * 4.6, side === 1 ? -Math.PI / 2 : Math.PI / 2));
    s.add(model(types[(i + 2) % 4], 6 + (i % 4) * 1.8, side * 14, -98 + i * 4.6, side === 1 ? -Math.PI / 2 : Math.PI / 2));
  }
  for (let z = -90; z < 20; z += 8) { s.add(model('light-curved', 4, -3.1, z)); s.add(model('tree-small', 2.3, 3.8, z)); }
  if (cars) for (let j = 0; j < 3; j++) s.add(model('sedan', 1.4, j % 2 ? 1.6 : -1.6, -14 + j * 6, j % 2 ? 0 : Math.PI));  // parked
}

function gym(s, {lit = true} = {}) {
  block(s, 0, -.05, 0, 16, .1, 14, 0xc9a57a);
  for (const x of [-7.9, 7.9]) block(s, x, 2.6, 0, .2, 5.2, 14, 0xd8d2c4); block(s, 0, 2.6, -6.9, 16, 5.2, .2, 0xd8d2c4);
  block(s, 0, 2.6, 6.9, 16, 5.2, .2, 0xd8d2c4).castShadow = false; block(s, 0, 5.3, 0, 16, .1, 14, 0xbfb8a8).castShadow = false;  // closed hall
  block(s, 0, .012, -1, 8, .02, .08, 0xffffff); const circle = new T.Mesh(new T.RingGeometry(1.4, 1.5, 40), new T.MeshBasicMaterial({color: 0xffffff})); circle.rotation.x = -Math.PI / 2; circle.position.set(0, .02, -1); s.add(circle);
  block(s, 0, 3.6, -6.75, 1.8, 1.2, .1, 0xffffff); block(s, 0, 3.6, -6.7, .9, .6, .1, 0xd7262e); // hoop board
  const panels = []; for (let i = 0; i < 6; i++) panels.push(block(s, -5 + (i % 3) * 5, 5.1, -4 + Math.floor(i / 3) * 6, 1.6, .1, .6, glow(0xfff2d6, lit ? 1.6 : 0)));
  const mats = []; for (let i = 0; i < 12; i++) mats.push(block(s, -5.6 + (i % 4) * 3.4, .05, -4.5 + Math.floor(i / 4) * 3.2, 1.8, .1, 2.4, 0x3f6ea8));
  // Cardboard-box seats, as in real evacuation centres; the seated pose needs something to sit on.
  const seat = (x, z) => block(s, x, .21, z, .42, .32, .42, 0xb08a5c);
  const crowd = []; for (let i = 0; i < 11; i++) { if (i === 5) continue; const m = mats[i]; const x = m.position.x + (rand(i) - .5) * .6, z = m.position.z + (rand(i + 3) - .5) * .8; seat(x, z); const p = person(s, i % 2 ? 'man' : 'woman', x, z, rand(i + 7) * 6.28, crowdShirts[i % 6], 'Sitting', rand(i) * 2); p.position.y = .02; crowd.push(p); }
  seat(mats[5].position.x, mats[5].position.z);
  const lamp = new T.PointLight(0xfff2d6, lit ? 40 : 0, 30); lamp.position.set(0, 4.8, 0); s.add(lamp);
  return {panels, mats, crowd, lamp, spot: mats[5]};
}

// ---- shots -----------------------------------------------------------------
const shots = {};
const NAME = script.person.name;

shots.shelter = () => {
  const s = new T.Scene(); s.background = new T.Color(0x151924); lights(s, {power: .5, ambient: .7, from: [8, 10, 6]});
  const g = gym(s), spot = g.spot;
  const mika = person(s, 'woman', spot.position.x, spot.position.z, Math.PI * .1, HERO, 'Sitting');
  const screen = block(s, spot.position.x + .05, .72, spot.position.z + .3, .12, .2, .02, glow(0x9fd3ff, 0));
  const phoneLight = new T.PointLight(0x9fd3ff, 0, 2.5); phoneLight.position.set(spot.position.x + .1, .7, spot.position.z + .5); s.add(phoneLight);
  s.userData.tick = (t) => {
    const on = t < 1.6;
    g.panels.forEach(p => { p.material.emissiveIntensity = on ? 1.6 : 0; }); g.lamp.intensity = on ? 40 : 0;
    screen.material.emissiveIntensity = on ? 0 : 2; phoneLight.intensity = on ? 0 : 3;
    g.crowd.forEach(p => p.userData.pose('Sitting', 1.2)); mika.userData.pose('Sitting', 1.2);
  };
  s.userData.camera = {from: [spot.position.x + 2.4, 1.6, spot.position.z + 3.4], to: [spot.position.x + 1.4, 1.2, spot.position.z + 2.2], look: () => [spot.position.x, .5, spot.position.z]};
  return s;
};

function shelterDay(paperStart, paperEnd, night, page) {
  const s = new T.Scene(); s.background = new T.Color(night ? 0x151924 : 0x2a3140);
  lights(s, {power: night ? .6 : 1.3, ambient: night ? .9 : 1.5, from: [8, 10, 6]});
  const g = gym(s, {lit: true}), spot = g.spot;
  if (night) { g.panels.forEach(p => { p.material.emissiveIntensity = .7; }); g.lamp.intensity = 14; }
  const mika = person(s, 'woman', spot.position.x, spot.position.z, Math.PI * .1, HERO, 'Sitting');
  block(s, spot.position.x + .05, .56, spot.position.z + .22, .26, .02, .34, 0xffffff); // clipboard on her lap
  // Pages done on her left, pages still to do on her right.
  const left = block(s, spot.position.x - .75, .05, spot.position.z + .1, .42, .1, .56, 0xf7f4ea);
  const right = block(s, spot.position.x + .8, .05, spot.position.z - .2, .42, .1, .56, 0xf7f4ea);
  const label = sign(s, ['CUSTOMS FORM', `PAGE ${page} OF 600`], spot.position.x + .8, 1, spot.position.z + .09, .6, .2, {bg: '#ffffff', fg: '#10131b', size: 110, w: 768});
  const crates = []; if (!night) for (let j = 0; j < 6; j++) crates.push(block(s, 5 + (j % 3) * .9, .4 + Math.floor(j / 3) * .8, -5.5, .8, .75, .8, 0x9c7b56));
  s.userData.tick = (t) => {
    const done = paperStart + (paperEnd - paperStart) * Math.min(1, t / 5);
    left.scale.y = 1 + done * 12; left.position.y = .05 * left.scale.y;
    right.scale.y = 1 + (1 - done) * 12; right.position.y = .05 * right.scale.y; label.position.y = .1 * right.scale.y + .14;
    g.crowd.forEach(p => p.userData.pose('Sitting', 1.2)); mika.userData.pose('Sitting', 1.2);
    if (night) { const k = Math.max(0, 1 - t / 4) * (t > .6 ? 1 : 0); s.position.set(Math.sin(t * 29) * .05 * k, 0, Math.cos(t * 23) * .04 * k); }  // aftershock
  };
  s.userData.camera = {from: [spot.position.x + 1.2, 1.5, spot.position.z + 3.6], to: [spot.position.x + .9, 1.2, spot.position.z + 2.7], look: () => [spot.position.x + .3, .45, spot.position.z]};
  return s;
}
shots.aid = () => shelterDay(0, .01, false, 1);

function suitcase(parent) {
  const c = new T.Group(); parent.add(c);
  block(c, 0, .26, 0, .22, .4, .34, 0x2f6f8f); block(c, 0, .5, -.12, .03, .14, .03, 0x333333);
  for (const z of [-.12, .12]) block(c, .08, .03, z, .05, .05, .05, 0x111111);
  return c;
}
function volcano(s, z = -60) {
  // A fissure on the horizon: glowing ridge, lava fountains and an ash column, lit orange.
  block(s, 0, 1.5, z, 40, 3, 4, 0x2e2a28);
  const fissure = block(s, 0, 3.05, z + .5, 36, .2, .8, glow(0xff5a1a, 2.4));
  const fountains = []; for (let i = 0; i < 12; i++) { const f = new T.Mesh(new T.ConeGeometry(.7, 4, 10), glow(0xff7a22, 2.2)); f.position.set(-15 + i * 2.7, 4, z + .5); s.add(f); fountains.push(f); }
  const ash = []; for (let i = 0; i < 40; i++) { const p = new T.Mesh(new T.IcosahedronGeometry(1, 1), new T.MeshStandardMaterial({color: 0x4f4a46, transparent: true, opacity: .8, depthWrite: false})); p.userData.seed = i; s.add(p); ash.push(p); }
  const light = new T.PointLight(0xff6a2a, 900, 120, 1.6); light.position.set(0, 8, z + 8); s.add(light);
  return (t) => {
    fountains.forEach((f, i) => { const k = .7 + .5 * Math.abs(Math.sin(t * 3 + i * 1.7)); f.scale.set(1, k, 1); f.position.y = 3 + 2 * k; });
    fissure.material.emissiveIntensity = 2 + .6 * Math.sin(t * 7); light.intensity = 800 + 200 * Math.sin(t * 9);
    ash.forEach(p => { const n = p.userData.seed, age = (t * .25 + rand(n)) % 1; p.position.set(-14 + rand(n + 1) * 28 + age * 8, 6 + age * 30, z - 2 + age * 4); p.scale.setScalar(2 + age * 5); p.material.opacity = .8 * (1 - age); });
  };
}

shots.home = () => {
  const s = new T.Scene(); s.background = new T.Color(0x1d212b); lights(s, {power: .9, ambient: 1.2, from: [6, 9, 8]});
  const a = apartment(s, {morning: false}); a.toast.forEach(t => { t.visible = false; });
  const bag = suitcase(a.room); bag.position.set(1.4, .41, .3); bag.rotation.y = .3;
  sign(a.room, ['FLIGHT FI 204', 'DEPARTS 07:40'], .6, .46, .5, .5, .16, {bg: '#ffffff', fg: '#10131b', size: 104, w: 768}).rotation.x = -1.2;
  const her = person(a.room, 'woman', .9, 1.1, Math.PI, HERO, 'Idle');
  s.userData.tick = (t) => her.userData.pose('Idle', t);
  s.userData.camera = {from: [3, 1.7, 3.9], to: [2.3, 1.5, 3.1], look: () => [1, .7, .3]};
  return s;
};

shots.eruption = () => {
  const s = new T.Scene(); sky(s, 0x1a1420, 0xb2502a); lights(s, {sun: 0xff9a6a, power: .6, ambient: .7}); street(s, {fog: 0x5a3326});
  const tick = volcano(s, -70);
  // She steps out and stands facing the glow (-Z), seen from behind.
  const her = person(s, 'woman', -.4, 4, Math.PI, HERO, 'Walk');
  s.userData.tick = (t) => { tick(t); const d = Math.min(2.2, t * WALK); go(her, -.4, 4, 0, -1, d); her.userData.pose(d < 2.2 ? 'Walk' : 'Idle', t); };
  s.userData.camera = {from: [.2, 1.6, 6.8], to: [0, 1.8, 5.6], look: () => [-.3, 2.2, -40]};
  return s;
};

shots.evacuation = () => {
  const s = new T.Scene(); sky(s, 0x3a3346, 0xc0683f); lights(s, {sun: 0xffb27a, power: 1.4, ambient: 1.5}); street(s, {cars: false, fog: 0x7a4a36});
  volcano(s, -110)(1);
  // Cars leave town in an orderly queue (Kenney cars face +Z, so they turn to face -Z as they drive).
  const cars = []; for (let i = 0; i < 9; i++) { const c = model(i % 4 === 3 ? 'delivery' : 'sedan', 1.4, -1.6, 6 - i * 3.4, Math.PI); s.add(c); cars.push(c); }
  block(s, 2.6, 2, -10, .16, 4, .16, 0x555555); block(s, 5.4, 2, -10, .16, 4, .16, 0x555555);
  sign(s, ['EVACUATE IN AN', 'ORDERLY QUEUE :)', 'OFFICIAL BROCHURE · PAGE 1 OF 48'], 4, 3.6, -9.9, 4.6, 2.5, {bg: '#ffd23f', fg: '#0f1a33', size: 86, h: 420, w: 768});
  const her = person(s, 'woman', 4.3, 3, Math.PI, HERO, 'Walk'); const bag = suitcase(s);  // on the pavement, beside the cars
  s.userData.tick = (t) => {
    cars.forEach((c, i) => go(c, -1.6, 6 - i * 3.4, 0, -1, t * 2.2));
    go(her, 4.3, 3, 0, -1, t * WALK); her.userData.pose('Walk', t);
    bag.position.set(her.position.x + .3, 0, her.position.z + .45); bag.rotation.x = -.35;
  };
  s.userData.camera = {from: [3.2, 2.1, 8.2], to: [3, 2.1, 6], look: () => [her.position.x - 1.4, 1.2, her.position.z - 6]};
  return s;
};

function aircraft(g, x, y, z, rot = 0) {
  // Nose at local +Z, like every other model here.
  const p = new T.Group(); p.position.set(x, y, z); p.rotation.y = rot; g.add(p);
  const body = new T.Mesh(new T.CylinderGeometry(.5, .7, 9, 14), mat(0xf1ede2)); body.rotation.x = Math.PI / 2; body.castShadow = true; p.add(body);
  block(p, 0, 0, 0, 8.2, .16, 2.1, 0xc9c9bf); block(p, 0, .35, -3.7, 2.8, .12, 1.8, 0xc9c9bf); block(p, 0, .95, -3.7, .12, 1.6, 1.1, 0x2f6f8f);
  return p;
}

shots.airport = () => {
  const s = new T.Scene(); sky(s, 0x8d8a86, 0xc8b9a6); lights(s, {power: 1.3}); s.fog = new T.Fog(0xa29a90, 20, 80);
  block(s, 0, -.15, 0, 400, .3, 400, 0x6f6e68); for (let n = -6; n <= 6; n++) block(s, 0, .02, n * 5, .25, .02, 2.6, 0xf2e1bc);
  block(s, -2, 3, -16, 40, 6, 6, 0xc9c2b4); for (let j = 0; j < 14; j++) block(s, -21 + j * 3, 3.2, -12.95, 2.2, 2.2, .1, 0x5d7682);
  aircraft(s, -7, 2, -6, .4); aircraft(s, 6, 2, -7, -.3); aircraft(s, 15, 2, 2, -.9);
  sign(s, ['DEPARTURES', 'FI 204  LONDON   CANCELLED', 'ALL OTHER FLIGHTS  CANCELLED'], 0, 7.6, -12.9, 10, 3.4, {bg: '#111', fg: '#ffd23f', size: 80, h: 384});
  const ash = []; for (let i = 0; i < 40; i++) { const p = new T.Mesh(new T.IcosahedronGeometry(1, 1), new T.MeshStandardMaterial({color: 0x7d7770, transparent: true, opacity: .35, depthWrite: false})); p.position.set((rand(i) - .5) * 60, 11 + rand(i + 4) * 8, -40 + rand(i + 6) * 30); p.scale.setScalar(2 + rand(i + 2) * 3); s.add(p); ash.push(p); }
  // She sits on her suitcase, facing the departures board.
  const bag = suitcase(s); bag.position.set(1.9, 0, 4.2); bag.scale.setScalar(1.4);
  const her = person(s, 'woman', 1.9, 4.2, Math.PI, HERO, 'Sitting'); her.position.y = .12;
  s.userData.tick = (t) => { ash.forEach((p, i) => { p.position.x = ((rand(i) - .5) * 60 + t * 1.3 + 30) % 60 - 30; }); her.userData.pose('Sitting', 0); };
  s.userData.camera = {from: [3.6, 1.9, 10.5], to: [3.2, 1.9, 9.5], look: () => [.5, 2.2, -12]};
  return s;
};

shots['home-again'] = () => {
  // Two beats: she walks back up her street in daylight, then she is home with the unopened suitcase.
  const out = new T.Scene(); sky(out, 0x8ec2e6, 0xfbe3c2); lights(out); street(out);
  const walker = person(out, 'woman', .6, -10, 0, HERO, 'Walk'); const outBag = suitcase(out);
  const home = new T.Scene(); home.background = new T.Color(0x2a2f3a); lights(home, {power: 1.6, from: [6, 9, 8]});
  const a = apartment(home); a.toast.forEach(t => { t.visible = false; });
  const bag = suitcase(a.room); bag.position.set(1.4, .41, .3); bag.rotation.y = .3;
  sign(a.room, ['FLIGHT FI 204', 'DELAYED'], .6, .46, .5, .5, .16, {bg: '#ffd23f', fg: '#10131b', size: 104, w: 768}).rotation.x = -1.2;
  const her = person(a.room, 'woman', 3.2, 1.6, 0, HERO, 'Walk');
  const split = 2.6, to = [.9, 1.1], walkLen = Math.hypot(to[0] - 3.2, to[1] - 1.6);
  const tick = (t) => {
    if (t < split) { go(walker, .6, -10, 0, 1, t * WALK); walker.userData.pose('Walk', t); outBag.position.set(walker.position.x + .3, 0, walker.position.z - .45); return out; }
    const u = t - split, d = Math.min(walkLen, u * WALK);
    if (d < walkLen) { go(her, 3.2, 1.6, to[0] - 3.2, to[1] - 1.6, d); her.userData.pose('Walk', u); }
    else { her.position.set(to[0], 0, to[1]); her.rotation.y = Math.PI; her.userData.pose('Idle', u); }
    return home;
  };
  return {split, tick,
    camera: (t) => t < split ? {from: [1.8, 1.7, -2], to: [1.6, 1.7, -.5], look: [walker.position.x, 1, walker.position.z]} : {from: [3.2, 1.6, 4.4], to: [2.6, 1.5, 3.7], look: [1, .7, .4]}};
};

const scenes = script.shots.map(shot => shots[shot.scene]());

// ---- overlays ----------------------------------------------------------------
const $ = (q) => document.querySelector(q);
$('#lower .name').textContent = NAME.toUpperCase();
$('#stats h2').textContent = script.stats_title;
$('#stats .rows').innerHTML = script.stats.filter(m => !/notification|fictional|absurdity/i.test(m.label)).map(m => `<div class="row"><span>${m.label}</span><b data-v="${m.value}">0</b></div>`).join('');

const camera = new T.PerspectiveCamera(50, W / H, .05, 300);
const OUTRO = script.outro_seconds;
const cuts = timing.cuts, total = cuts[cuts.length - 1] + OUTRO;
const shotParam = new URLSearchParams(location.search).get('shot');
const selected = shotParam === null ? -1 : Number(shotParam);
if (selected !== -1 && !(Number.isInteger(selected) && selected >= 0 && selected < scenes.length)) throw new Error('Invalid shot');
window.DUR = selected < 0 ? total : (selected === scenes.length - 1 ? cuts[selected + 1] + OUTRO : cuts[selected + 1]) - cuts[selected];
const ease = (x) => x < .5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2;
const fade = (x) => Math.min(1, Math.max(0, x));

window.render = (localTime) => {
  const time = selected < 0 ? localTime : cuts[selected] + localTime;
  let i = scenes.length - 1;
  for (let k = 0; k < scenes.length; k++) if (time < cuts[k + 1]) { i = k; break; }
  const local = Math.max(0, time - cuts[i]), len = cuts[i + 1] - cuts[i] + (i === scenes.length - 1 ? OUTRO : 0);
  const shot = scenes[i], data = script.shots[i];
  window.FLASH = 0;
  let scene, cam;
  if (shot.split !== undefined) { scene = shot.tick(local); cam = shot.camera(local); }
  else { scene = shot; shot.userData.tick?.(local); cam = shot.userData.camera; }
  const part = shot.split !== undefined && local >= shot.split;
  const span = shot.split !== undefined ? (part ? len - shot.split : shot.split) : len;
  const f = ease(Math.min((part ? local - shot.split : local) / span, 1));
  camera.position.set(...cam.from.map((v, k) => v + (cam.to[k] - v) * f));
  camera.lookAt(...(typeof cam.look === 'function' ? cam.look() : cam.look));

  $('#date').textContent = data.date;
  $('#caption').textContent = local < (timing.voice_durations[i] + timing.lead_in + .6) ? data.narration : '';
  $('#lower').style.opacity = data.lower_third ? fade((local - .4) / .3) * fade((len - 1 - local) / .3) : 0;
  $('#flash').style.opacity = window.FLASH;
  const last = i === scenes.length - 1, outro = last ? time - cuts[cuts.length - 1] : -1;
  $('#stats').style.opacity = last ? fade(outro / .4) : 0;
  if (last) document.querySelectorAll('#stats b').forEach(b => { b.textContent = Math.round(Number(b.dataset.v) * fade((outro - .3) / 2)); });
  renderer.render(scene, camera);
};
window.READY = true; window.render(0);
