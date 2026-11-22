// "Mika's four days": the Japan earthquake fixture followed through one invented resident.
// Eight deterministic Three.js shots plus an outro card. Text comes from script.json
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
const MIKA = 0xffc53d;
const CLIP = (kind, base) => `HumanArmature|${kind === 'man' ? 'Man' : 'Female'}_${base}`;
function person(parent, kind, x, z, rot, shirt, clip = 'Idle', phase = 0) {
  const asset = people[kind], p = cloneSkeleton(asset.scene);
  p.scale.setScalar(.29); p.position.set(x, 0, z); p.rotation.y = rot; parent.add(p);
  p.traverse(o => { if (!o.isMesh) return; o.castShadow = true; o.receiveShadow = true;
    const fix = (m) => { if (m.name !== 'Shirt') return m; const c = m.clone(); c.color.setHex(shirt); return c; };
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

shots.home = () => {
  const s = new T.Scene(); s.background = new T.Color(0x2a2f3a); lights(s, {power: 1.4, from: [6, 9, 8]});
  const a = apartment(s); const mika = person(a.room, 'woman', -1.2, -1.75, Math.PI * .92, MIKA, 'Idle');
  s.userData.tick = (t) => { mika.userData.pose('Idle', t); a.toaster.material.emissive.setHex(0xff5522); a.toaster.material.emissiveIntensity = .15 + .1 * Math.sin(t * 4); };
  s.userData.camera = {from: [2.6, 1.6, 4.2], to: [1.4, 1.45, 3.1], look: () => [-1.2, 1, -2]};
  return s;
};

shots.quake = () => {
  const s = new T.Scene(); s.background = new T.Color(0x2a2f3a); lights(s, {power: 1.4, from: [6, 9, 8]});
  const a = apartment(s); const mika = person(a.room, 'woman', -1.2, -1.75, Math.PI * .92, MIKA, 'Idle');
  s.userData.tick = (t) => {
    const k = Math.max(0, 1 - t / 6) * (t > .3 ? 1 : 0);
    a.room.position.set(Math.sin(t * 31) * .06 * k, Math.abs(Math.sin(t * 23)) * .03 * k, Math.cos(t * 27) * .05 * k);
    a.lamp.rotation.z = Math.sin(t * 5) * .35 * Math.max(0, 1 - t / 7);
    a.items.forEach((it, i) => { const t0 = .5 + rand(i) * 1.5; if (t > t0) { it.position.y = Math.max(.1, it.userData.y0 - 4.9 * (t - t0) ** 2); it.position.x = -4.15 + Math.min(.6, (t - t0) * .8); it.rotation.z = Math.min(1.5, (t - t0) * 3); } });
    // Mika takes cover under the table: a quick run, then she crouches there.
    const to = [2.45, .55], dist = Math.hypot(to[0] + 1.2, to[1] + 1.75), arrive = .5 + dist / RUN;
    if (t < .5) { mika.position.set(-1.2, 0, -1.75); mika.userData.pose('Idle', t); }
    else if (t < arrive) { go(mika, -1.2, -1.75, to[0] + 1.2, to[1] + 1.75, (t - .5) * RUN); mika.userData.pose('Run', t); }
    else { mika.position.set(to[0], 0, to[1]); mika.rotation.y = -Math.PI * .4; mika.userData.pose('Sitting', 0); }
  };
  s.userData.camera = {from: [3.4, 1.7, 4.6], to: [3.6, 1.3, 3.9], look: () => [1.6, .65, -.2]};
  return s;
};

shots.warning = () => {
  const s = new T.Scene(); sky(s, 0x79b9dc, 0xf3d9b8); lights(s); street(s);
  const pole = block(s, 4, 3.1, -6, .15, 6.2, .15, 0x595959); const beacon = block(s, 4, 6.5, -6, .9, .5, .7, 0xb84331);
  block(s, 4, 6, -6, .7, .7, .6, 0xcea64f);
  const mika = person(s, 'woman', -.5, -9, 0, MIKA, 'Walk');
  const others = [0, 1, 2, 3].map(i => person(s, i % 2 ? 'man' : 'woman', -3.6 + (i % 2) * 7.4, -12 - i * 2.2, 0, crowdShirts[i], 'Walk', i * .4));
  s.userData.tick = (t) => {
    beacon.material.color.setHex(Math.sin(t * 9) > 0 ? 0xff3b2f : 0x7a1d18); beacon.material.emissive.setHex(Math.sin(t * 9) > 0 ? 0xff2a1a : 0); beacon.material.emissiveIntensity = 1.2;
    const along = (t0) => t < t0 ? t * WALK : t0 * WALK + (t - t0) * RUN;  // walk, then run, toward the camera
    go(mika, -.5, -9, 0, 1, along(2.5)); mika.userData.pose(t > 2.5 ? 'Run' : 'Walk', t);
    others.forEach((p, i) => { go(p, -3.6 + (i % 2) * 7.4, -12 - i * 2.2, 0, 1, along(2)); p.userData.pose(t > 2 ? 'Run' : 'Walk', t); });
  };
  s.userData.camera = {from: [1.6, 1.8, 2], to: [1.2, 1.7, 4.5], look: () => [mika.position.x, 1, mika.position.z]};
  return s;
};

shots.evacuation = () => {
  const s = new T.Scene(); sky(s, 0x8fb7d4, 0xf0dcc0); lights(s); street(s, {cars: false});
  // A long, orderly queue toward higher ground. Mika is in yellow.
  const queue = []; for (let i = 0; i < 14; i++) queue.push(person(s, i % 2 ? 'man' : 'woman', (i % 2 ? -.35 : .35), 4 - i * 1.25, 0, i === 3 ? MIKA : crowdShirts[i % 6], 'Walk', rand(i) * 2));
  block(s, 2.6, 3, -9, .16, 6, .16, 0x555555); block(s, 5.4, 3, -9, .16, 6, .16, 0x555555);
  sign(s, ['EVACUATE IN AN', 'ORDERLY QUEUE :)', 'OFFICIAL BROCHURE · PAGE 1 OF 48'], 4, 5.6, -8.9, 4.6, 2.5, {bg: '#ffd23f', fg: '#0f1a33', size: 86, h: 420, w: 768});
  const mika = queue[3];
  s.userData.tick = (t) => queue.forEach((p, i) => { go(p, i % 2 ? -.35 : .35, 4 - i * 1.25, 0, -1, t * WALK); p.userData.pose('Walk', t); });
  s.userData.camera = {from: [-2.2, 2.6, 7], to: [-1.6, 2.4, 2.5], look: () => [mika.position.x, 1.1, mika.position.z - 2]};
  return s;
};

shots.shelter = () => {
  const s = new T.Scene(); s.background = new T.Color(0x151924); lights(s, {power: .5, ambient: .7, from: [8, 10, 6]});
  const g = gym(s), spot = g.spot;
  const mika = person(s, 'woman', spot.position.x, spot.position.z, Math.PI * .1, MIKA, 'Sitting');
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
  const mika = person(s, 'woman', spot.position.x, spot.position.z, Math.PI * .1, MIKA, 'Sitting');
  block(s, spot.position.x + .05, .56, spot.position.z + .22, .26, .02, .34, 0xffffff); // clipboard on her lap
  // Pages done on her left, pages still to do on her right.
  const left = block(s, spot.position.x - .75, .05, spot.position.z + .1, .42, .1, .56, 0xf7f4ea);
  const right = block(s, spot.position.x + .8, .05, spot.position.z - .2, .42, .1, .56, 0xf7f4ea);
  const label = sign(s, ['FORM 77-B', `PAGE ${page} OF 600`], spot.position.x + .8, 1, spot.position.z + .09, .6, .2, {bg: '#ffffff', fg: '#10131b', size: 110, w: 768});
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
shots.aftershock = () => shelterDay(.33, .34, true, 200);

shots['home-again'] = () => {
  // Two beats in one shot: the train comes back, then Mika is home with her toast.
  const station = new T.Scene(); sky(station, 0x8ec2e6, 0xfbe3c2); lights(station); station.fog = new T.Fog(0xe9dcc6, 30, 95);
  block(station, 0, -.3, -30, 400, .2, 400, 0x7d7a6c);
  block(station, 0, -.12, -30, 24, .24, 130, 0x8d8980); block(station, -3.2, .35, -30, 3.3, .7, 120, 0xc8c0ad);
  for (const x of [-.8, .8]) block(station, x, .08, -30, .08, .12, 130, 0x948f87);
  for (let z = -90; z < 20; z += 1.1) block(station, 0, .04, z, 1.9, .08, .18, 0x544c41);
  for (let i = 0; i < 22; i++) { station.add(model('building-d', 5 + i % 2 * 1.5, 7, -90 + i * 5, -Math.PI / 2)); station.add(model('building-a', 6 + i % 3, -11, -88 + i * 5, Math.PI / 2)); }
  // The cab faces +Z and drives +Z toward the platform, easing to a stop.
  const train = model('train-electric-city-a', 2.9, 0, -30, 0); station.add(train);
  const stationMika = person(station, 'woman', -3, -4, 0, MIKA, 'Idle'); stationMika.position.y = .7;
  const home = new T.Scene(); home.background = new T.Color(0x2a2f3a); lights(home, {power: 1.6, from: [6, 9, 8]});
  const a = apartment(home); const mika = person(a.room, 'woman', 1.6, -.2, 0, MIKA, 'Walk');
  const split = 3.0, walkTo = [-1.2, -1.75], walkLen = Math.hypot(walkTo[0] - 1.6, walkTo[1] + .2);
  const tick = (t) => {
    if (t < split) {
      const f = Math.min(1, t / 2.2); train.position.z = -30 + (1 - (1 - f) ** 3) * 24;
      if (t < 2.2) stationMika.userData.pose('Idle', t);
      else { go(stationMika, -3, -4, 0, 1, (t - 2.2) * WALK); stationMika.userData.pose('Walk', t); }
      return station;
    }
    const u = t - split, d = Math.min(walkLen, u * WALK);
    if (d < walkLen) { go(mika, 1.6, -.2, walkTo[0] - 1.6, walkTo[1] + .2, d); mika.userData.pose('Walk', u); }
    else { mika.position.set(walkTo[0], 0, walkTo[1]); mika.rotation.y = Math.PI; mika.userData.pose('Idle', u); }
    const pop = Math.max(0, Math.min(1, (u - walkLen / WALK - .2) * 4)); a.toast.forEach(tt => { tt.position.y = 1.12 + pop * .16; });
    return home;
  };
  return {split, tick, station, home,
    camera: (t) => t < split ? {from: [-6.5, 2.2, 6], to: [-5.5, 2, 3.5], look: [-2, 1.3, -8]} : {from: [2.9, 1.6, 4.4], to: [2.2, 1.5, 3.6], look: [-.6, 1, -1.5]}};
};

const scenes = script.shots.map(shot => shots[shot.scene]());

// ---- overlays ----------------------------------------------------------------
const $ = (q) => document.querySelector(q);
$('#lower .name').textContent = script.person.name.toUpperCase();
$('#stats h2').textContent = `${script.person.name.toUpperCase()}'S FOUR DAYS`;
$('#stats .rows').innerHTML = script.stats.map(m => `<div class="row"><span>${m.label}</span><b data-v="${m.value}">0</b></div>`).join('');
$('#stats p').textContent = script.disclaimer;

const camera = new T.PerspectiveCamera(50, W / H, .05, 260);
const OUTRO = 3.5;
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
  let scene, cam;
  if (shot.tick && shot.split !== undefined) { scene = shot.tick(local); cam = shot.camera(local); }
  else { scene = shot; shot.userData.tick?.(local); cam = shot.userData.camera; }
  const span = shot.split !== undefined ? (local < shot.split ? shot.split : len - shot.split) : len;
  const f = ease(Math.min((shot.split !== undefined && local >= shot.split ? local - shot.split : local) / span, 1));
  camera.position.set(...cam.from.map((v, k) => v + (cam.to[k] - v) * f));
  camera.lookAt(...(typeof cam.look === 'function' ? cam.look() : cam.look));

  $('#date').textContent = data.date;
  const speaking = local < (timing.voice_durations[i] + timing.lead_in + .6);
  $('#caption').textContent = speaking ? data.narration : '';
  $('#lower').style.opacity = data.lower_third ? fade((local - .4) / .3) * fade((len - 1 - local) / .3) : 0;
  const phone = $('#phone');
  if (data.notification) {
    phone.querySelector('.who').innerHTML = '';
    phone.querySelector('.who').append(data.notification.author, Object.assign(document.createElement('span'), {textContent: data.notification.handle}));
    phone.querySelector('.text').textContent = data.notification.text;
    const k = fade((local - 1.1) / .3) * fade((len - .3 - local) / .3);
    phone.style.opacity = k; phone.style.transform = `translateY(${(1 - k) * -60}px)`;
  } else phone.style.opacity = 0;
  const last = i === scenes.length - 1, outro = last ? time - cuts[cuts.length - 1] : -1;
  $('#stats').style.opacity = last ? fade(outro / .4) : 0;
  if (last) { phone.style.opacity = outro > 0 ? 0 : phone.style.opacity; document.querySelectorAll('#stats b').forEach(b => { b.textContent = Math.round(Number(b.dataset.v) * fade((outro - .3) / 2)); }); }
  renderer.render(scene, camera);
};
window.READY = true; window.render(0);
