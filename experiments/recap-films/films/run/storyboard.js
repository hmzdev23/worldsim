// A recap of ONE simulation run, followed through one invented local.
// Every shot is one of the run's events, in the run's order (script.json, built by
// make-script.py from GET /scenarios/{id}/result). Scenes are chosen by event type, so
// any run can be filmed; place names, dates and the map come from the run itself.
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
  ['car-kit', 'sedan'], ['car-kit', 'delivery'], ['car-kit', 'ambulance']];
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
  lines.forEach((line, i) => {
    let px = i ? size * .6 : size; g.font = `900 ${px}px Arial`;
    while (g.measureText(line).width > w * .92 && px > 20) { px -= 4; g.font = `900 ${px}px Arial`; }  // long place names fit
    g.fillText(line, w / 2, h / 2 + (i - (lines.length - 1) / 2) * size * 1.05);
  });
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

// People: Quaternius CC0 characters, posed with mixer.setTime(t) so any frame renders the
// same in any order. Locals are coloured from the setting's palette (script.person.look);
// the protagonist always wears yellow and keeps one fixed look.
const HERO = 0xffc53d;
const KIND = script.person.kind === 'man' ? 'man' : 'woman';
const LOOK = script.person.look;
const HERO_LOOK = {skin: LOOK.skin[0], hair: LOOK.hair[0]};
const CLIP = (kind, base) => `HumanArmature|${kind === 'man' ? 'Man' : 'Female'}_${base}`;
let lookSeed = 0;
function person(parent, kind, x, z, rot, shirt, clip = 'Idle', phase = 0) {
  const asset = people[kind], p = cloneSkeleton(asset.scene);
  p.scale.setScalar(.29); p.position.set(x, 0, z); p.rotation.y = rot; parent.add(p);
  const n = ++lookSeed, pick = (list, k) => list[Math.floor(rand(n * 7.3 + k) * list.length)];
  const look = shirt === HERO ? HERO_LOOK : {skin: pick(LOOK.skin, 1), hair: pick(LOOK.hair, 2)};
  const colours = {Shirt: shirt, Skin: look.skin, Hair: look.hair, HairBase: look.hair};
  p.traverse(o => { if (!o.isMesh) return; o.castShadow = true; o.receiveShadow = true;
    const fix = (m) => { if (!(m.name in colours)) return m; const c = m.clone(); c.color.setHex(colours[m.name]); return c; };
    o.material = Array.isArray(o.material) ? o.material.map(fix) : fix(o.material); });
  const mixer = new T.AnimationMixer(p), actions = {};
  for (const name of ['Idle', 'Walk', 'Run', 'Sitting', 'Standing', 'Clapping']) {
    const c = asset.animations.find(a => a.name === CLIP(kind, name)); if (!c) continue;
    const a = mixer.clipAction(c);
    if (name === 'Sitting') { a.setLoop(T.LoopOnce, 1); a.clampWhenFinished = true; }
    a.play(); a.setEffectiveWeight(0); actions[name] = a;
  }
  p.userData.pose = (name, t) => {
    for (const [k, a] of Object.entries(actions)) { a.reset(); a.setEffectiveWeight(k === name ? 1 : 0); }
    mixer.setTime(name === 'Sitting' ? 60 : t + phase);
  };
  p.userData.pose(clip, 0); return p;
}
const hero = (parent, x, z, rot, clip = 'Idle') => person(parent, KIND, x, z, rot, HERO, clip);
// Every model faces local +Z. Anything that moves is placed with go(): heading follows
// velocity, so nothing travels backwards. Speeds match the clips, so feet don't slide.
const WALK = 1.0, RUN = 2.4;
function go(obj, x0, z0, dx, dz, dist) {
  const len = Math.hypot(dx, dz) || 1;
  obj.position.x = x0 + dx / len * dist; obj.position.z = z0 + dz / len * dist;
  obj.rotation.y = Math.atan2(dx, dz);
}
const crowdShirts = [0x5b7aa6, 0x8c5a4a, 0x4f7a5a, 0x6c6c78, 0x9a7b4f, 0x7a4f6c];
const UP = (s) => String(s ?? '').toUpperCase();

// ---- sets ------------------------------------------------------------------
function apartment(s) {
  // A closed room (floor, four walls, ceiling) so no edge of the set is ever in frame.
  const room = new T.Group(); s.add(room);
  block(room, 0, -.05, 2, 9, .1, 12, 0xb48a60);
  block(room, 0, 1.6, -3, 9, 3.2, .15, 0xe9ddc7); block(room, -4.4, 1.6, 2, .15, 3.2, 12, 0xdfd0b5);
  block(room, 4.4, 1.6, 2, .15, 3.2, 12, 0xdfd0b5).castShadow = false; block(room, 0, 1.6, 8, 9, 3.2, .15, 0xe9ddc7).castShadow = false;
  block(room, 0, 3.25, 2, 9, .1, 12, 0xf3ede0).castShadow = false;
  const fill = new T.PointLight(0xfff0d8, 10, 14); fill.position.set(1, 2.8, 3); room.add(fill);
  block(room, 1.6, 1.9, -2.9, 2.2, 1.3, .05, glow(0x9fc9e8, .7));
  block(room, 1.6, 1.9, -2.88, .06, 1.3, .06, 0xffffff); block(room, 1.6, 1.9, -2.88, 2.2, .06, .06, 0xffffff);
  block(room, -1.6, .45, -2.55, 3, .9, .7, 0xc8b79c); block(room, -1.6, .92, -2.55, 3.05, .05, .75, 0x8a7b67);
  block(room, -2.3, 1.2, -2.5, .25, .35, .25, 0x4f7a8a);
  block(room, 1.2, .38, .3, 1.8, .06, 1.1, 0x7a5a3a); for (const [x, z] of [[.4, -.1], [2, -.1], [.4, .7], [2, .7]]) block(room, x, .18, z, .07, .36, .07, 0x6a4c30);
  const shelfY = [1.5, 2.1], items = [];
  for (const y of shelfY) block(room, -4.2, y, -.5, .3, .05, 2.6, 0x8a6a4a);
  for (let i = 0; i < 8; i++) { const it = block(room, -4.15, shelfY[i % 2] + .14, -1.6 + i * .32, .16, .22 + rand(i) * .15, .16, [0xd7262e, 0x4f7a8a, 0xf2e6c8, 0x6a8a4f][i % 4]); it.userData.y0 = it.position.y; items.push(it); }
  const lamp = new T.Group(); lamp.position.set(1.2, 3.1, .3); room.add(lamp);
  block(lamp, 0, -.35, 0, .02, .7, .02, 0x333333); const shade = new T.Mesh(new T.ConeGeometry(.28, .3, 16, 1, true), mat(0xf0e2c0, {side: T.DoubleSide})); shade.position.y = -.8; lamp.add(shade);
  const bulb = new T.PointLight(0xffd9a0, 6, 6); bulb.position.y = -.85; lamp.add(bulb);
  return {room, items, lamp};
}

function street(s, {cars = true, fog = 0xd9cbb6, ground = 0x7d7a6c} = {}) {
  // Road and buildings run 120 units into fog, over a ground plane that reaches the horizon.
  s.fog = new T.Fog(fog, 30, 95);
  block(s, 0, -.3, -30, 400, .2, 400, ground);
  block(s, 0, -.14, -40, 24, .25, 130, 0x484945); block(s, -5, .03, -40, 3.2, .18, 130, 0xb9ac98); block(s, 5, .03, -40, 3.2, .18, 130, 0xb9ac98);
  for (let z = -100; z < 22; z += 4) block(s, 0, .015, z, .1, .02, 1.8, 0xe9d1a1);
  const types = ['building-a', 'building-d', 'building-f', 'building-type-e'];
  for (const side of [-1, 1]) for (let i = 0; i < 26; i++) {
    s.add(model(types[(i + (side > 0)) % 4], 4 + (i % 3) * 1.6, side * 8.3, -100 + i * 4.6, side === 1 ? -Math.PI / 2 : Math.PI / 2));
    s.add(model(types[(i + 2) % 4], 6 + (i % 4) * 1.8, side * 14, -98 + i * 4.6, side === 1 ? -Math.PI / 2 : Math.PI / 2));
  }
  for (let z = -90; z < 20; z += 8) { s.add(model('light-curved', 4, -3.1, z)); s.add(model('tree-small', 2.3, 3.8, z)); }
  if (cars) for (let j = 0; j < 3; j++) s.add(model('sedan', 1.4, j % 2 ? 1.6 : -1.6, -14 + j * 6, j % 2 ? 0 : Math.PI));
}

function gym(s, {lit = true} = {}) {
  block(s, 0, -.05, 0, 16, .1, 14, 0xc9a57a);
  for (const x of [-7.9, 7.9]) block(s, x, 2.6, 0, .2, 5.2, 14, 0xd8d2c4); block(s, 0, 2.6, -6.9, 16, 5.2, .2, 0xd8d2c4);
  block(s, 0, 2.6, 6.9, 16, 5.2, .2, 0xd8d2c4).castShadow = false; block(s, 0, 5.3, 0, 16, .1, 14, 0xbfb8a8).castShadow = false;
  const panels = []; for (let i = 0; i < 6; i++) panels.push(block(s, -5 + (i % 3) * 5, 5.1, -4 + Math.floor(i / 3) * 6, 1.6, .1, .6, glow(0xfff2d6, lit ? 1.6 : 0)));
  const mats = []; for (let i = 0; i < 12; i++) mats.push(block(s, -5.6 + (i % 4) * 3.4, .05, -4.5 + Math.floor(i / 4) * 3.2, 1.8, .1, 2.4, 0x3f6ea8));
  // Cardboard-box seats, as in real evacuation centres.
  const seat = (x, z) => block(s, x, .21, z, .42, .32, .42, 0xb08a5c);
  const crowd = []; for (let i = 0; i < 11; i++) { if (i === 5) continue; const m = mats[i]; const x = m.position.x + (rand(i) - .5) * .6, z = m.position.z + (rand(i + 3) - .5) * .8; seat(x, z); const p = person(s, i % 2 ? 'man' : 'woman', x, z, rand(i + 7) * 6.28, crowdShirts[i % 6], 'Sitting', rand(i) * 2); p.position.y = .02; crowd.push(p); }
  seat(mats[5].position.x, mats[5].position.z);
  const lamp = new T.PointLight(0xfff2d6, lit ? 40 : 0, 30); lamp.position.set(0, 4.8, 0); s.add(lamp);
  return {panels, crowd, lamp, spot: mats[5]};
}

function hall(s) {
  // A closed briefing room: committee table, banner and a wall TV.
  s.background = new T.Color(0x14171d); lights(s, {power: .6, ambient: 1.1, from: [8, 10, 6]});
  block(s, 0, -.05, 0, 14, .1, 14, 0x6f6d68);
  for (const x of [-6.9, 6.9]) block(s, x, 1.6, 0, .2, 3.2, 14, 0x8a8781); block(s, 0, 1.6, -6.9, 14, 3.2, .2, 0x8a8781);
  block(s, 0, 1.6, 6.9, 14, 3.2, .2, 0x8a8781).castShadow = false; block(s, 0, 3.25, 0, 14, .1, 14, 0x75736e).castShadow = false;
  for (let i = 0; i < 4; i++) block(s, -4.5 + i * 3, 3.15, -1, 1.4, .08, .2, glow(0xe9f2ff, 1.4));
  const lamp = new T.PointLight(0xe9f2ff, 24, 20); lamp.position.set(0, 2.9, 0); s.add(lamp);
}

// ---- shots -----------------------------------------------------------------
// Each builder gets its shot from script.json (place, country, date) and returns a
// scene with userData.tick(t) and userData.camera, or {split, tick, camera} for two beats.
const shots = {};

shots.quake = () => {
  const s = new T.Scene(); s.background = new T.Color(0x2a2f3a); lights(s, {power: 1.4, from: [6, 9, 8]});
  const a = apartment(s); const me = hero(a.room, -1.2, -1.75, Math.PI * .92);
  s.userData.tick = (t) => {
    const k = Math.max(0, 1 - t / 6) * (t > .3 ? 1 : 0);
    a.room.position.set(Math.sin(t * 31) * .06 * k, Math.abs(Math.sin(t * 23)) * .03 * k, Math.cos(t * 27) * .05 * k);
    a.lamp.rotation.z = Math.sin(t * 5) * .35 * Math.max(0, 1 - t / 7);
    a.items.forEach((it, i) => { const t0 = .5 + rand(i) * 1.5; if (t > t0) { it.position.y = Math.max(.1, it.userData.y0 - 4.9 * (t - t0) ** 2); it.position.x = -4.15 + Math.min(.6, (t - t0) * .8); it.rotation.z = Math.min(1.5, (t - t0) * 3); } });
    // Take cover under the table: a quick run, then crouch there.
    const to = [2.45, .55], dist = Math.hypot(to[0] + 1.2, to[1] + 1.75), arrive = .5 + dist / RUN;
    if (t < .5) { me.position.set(-1.2, 0, -1.75); me.userData.pose('Idle', t); }
    else if (t < arrive) { go(me, -1.2, -1.75, to[0] + 1.2, to[1] + 1.75, (t - .5) * RUN); me.userData.pose('Run', t); }
    else { me.position.set(to[0], 0, to[1]); me.rotation.y = -Math.PI * .4; me.userData.pose('Sitting', 0); }
  };
  s.userData.camera = {from: [3.4, 1.7, 4.6], to: [3.6, 1.3, 3.9], look: () => [1.6, .65, -.2]};
  return s;
};

function beaconStreet(s, label, lines) {
  block(s, 4, 3.1, -6, .15, 6.2, .15, 0x595959); block(s, 4, 6, -6, .7, .7, .6, 0xcea64f);
  const beacon = block(s, 4, 6.5, -6, .9, .5, .7, 0xb84331);
  block(s, -4.4, 2.4, -10, .16, 4.8, .16, 0x555555); block(s, -2, 2.4, -10, .16, 4.8, .16, 0x555555);
  sign(s, lines ?? [label], -3.2, 4.2, -9.9, 4, 1.8, {bg: '#d7262e', fg: '#ffffff', size: 88, h: 384, w: 768});
  return (t) => { beacon.material.color.setHex(Math.sin(t * 9) > 0 ? 0xff3b2f : 0x7a1d18); beacon.material.emissive.setHex(Math.sin(t * 9) > 0 ? 0xff2a1a : 0); beacon.material.emissiveIntensity = 1.2; };
}

shots.warning = (shot) => {
  const s = new T.Scene(); sky(s, 0x79b9dc, 0xf3d9b8); lights(s); street(s);
  const flash = beaconStreet(s, '', [UP(shot.event_type === 'tsunami_warning' ? 'TSUNAMI WARNING' : 'ALERT'), UP(shot.place)]);
  const me = hero(s, -.5, -9, 0, 'Walk');
  const others = [0, 1, 2, 3].map(i => person(s, i % 2 ? 'man' : 'woman', -3.6 + (i % 2) * 7.4, -12 - i * 2.2, 0, crowdShirts[i], 'Walk', i * .4));
  s.userData.tick = (t) => {
    flash(t);
    const along = (t0) => t < t0 ? t * WALK : t0 * WALK + (t - t0) * RUN;  // walk, then run, toward the camera
    go(me, -.5, -9, 0, 1, along(2.5)); me.userData.pose(t > 2.5 ? 'Run' : 'Walk', t);
    others.forEach((p, i) => { go(p, -3.6 + (i % 2) * 7.4, -12 - i * 2.2, 0, 1, along(2)); p.userData.pose(t > 2 ? 'Run' : 'Walk', t); });
  };
  s.userData.camera = {from: [1.6, 1.8, 2], to: [1.2, 1.7, 4.5], look: () => [me.position.x, 1, me.position.z]};
  return s;
};

function volcano(s, z = -60) {
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

shots.eruption = () => {
  const s = new T.Scene(); sky(s, 0x1a1420, 0xb2502a); lights(s, {sun: 0xff9a6a, power: .6, ambient: .7}); street(s, {fog: 0x5a3326});
  const tick = volcano(s, -70);
  const me = hero(s, -.4, 4, Math.PI, 'Walk');
  s.userData.tick = (t) => { tick(t); const d = Math.min(2.2, t * WALK); go(me, -.4, 4, 0, -1, d); me.userData.pose(d < 2.2 ? 'Walk' : 'Idle', t); };
  s.userData.camera = {from: [.2, 1.6, 6.8], to: [0, 1.8, 5.6], look: () => [-.3, 2.2, -40]};
  return s;
};

shots.sky = (shot) => {
  // Something in the sky above the street: a vast silent object, or a meteor streak and flash.
  const meteor = shot.event_type === 'meteor_impact';
  const s = new T.Scene(); sky(s, meteor ? 0x2a2340 : 0x4b5f7a, meteor ? 0xd08a5a : 0xc9d3dc); lights(s, {power: 1.2}); street(s, {fog: meteor ? 0x6a4a40 : 0xb7c2cc});
  const thing = new T.Group(); s.add(thing);
  if (!meteor) {
    const disc = new T.Mesh(new T.CylinderGeometry(14, 16, 2.4, 48), mat(0x30343c, {metalness: .7, roughness: .4})); thing.add(disc);
    for (let i = 0; i < 16; i++) { const l = block(thing, Math.cos(i / 16 * 6.28) * 13, -1.3, Math.sin(i / 16 * 6.28) * 13, .8, .2, .8, glow(0x9fe8ff, 2)); l.castShadow = false; }
    thing.position.set(0, 26, -46);
  } else {
    const rock = new T.Mesh(new T.IcosahedronGeometry(1.4, 1), glow(0xffb36a, 2.4)); thing.add(rock);
    const tail = new T.Mesh(new T.ConeGeometry(1.2, 14, 12), new T.MeshBasicMaterial({color: 0xffd8a0, transparent: true, opacity: .6})); tail.rotation.z = Math.PI / 2 + .5; tail.position.set(6, 3, 0); thing.add(tail);
  }
  const me = hero(s, .4, 2, Math.PI, 'Idle');
  const crowd = [0, 1, 2, 3].map(i => person(s, i % 2 ? 'man' : 'woman', -3 + i * 2, -1 - (i % 2) * 1.5, Math.PI, crowdShirts[i], 'Idle', i * .3));
  s.userData.tick = (t) => {
    me.userData.pose('Idle', t); crowd.forEach(p => p.userData.pose('Idle', t));
    if (!meteor) { thing.rotation.y = t * .1; thing.position.y = 26 + Math.sin(t) * .3; }
    else { const f = Math.min(1, t / 2.4); thing.position.set(40 - f * 60, 40 - f * 38, -80); thing.visible = f < 1; window.FLASH = t > 2.4 && t < 2.8 ? 1 - (t - 2.4) / .4 : 0; }
  };
  s.userData.camera = {from: [1.6, 1.4, 6.5], to: [1.2, 1.3, 5.6], look: () => [0, 9, -30]};
  return s;
};

function waterStreet(shot, {rain = false} = {}) {
  const s = new T.Scene(); sky(s, rain ? 0x3d4652 : 0x6f8796, rain ? 0x8a929a : 0xc7c9c2); lights(s, {power: 1.1, ambient: 1.4}); street(s, {fog: rain ? 0x6d757c : 0xa7aca8});
  const water = new T.Mesh(new T.PlaneGeometry(400, 400), new T.MeshStandardMaterial({color: 0x51707e, transparent: true, opacity: .82, roughness: .15, metalness: .2}));
  water.rotation.x = -Math.PI / 2; s.add(water);
  const drops = []; if (rain) for (let i = 0; i < 260; i++) { const d = block(s, (rand(i) - .5) * 30, 0, -rand(i + 1) * 40 + 6, .02, .5, .02, new T.MeshBasicMaterial({color: 0xcfd8e0, transparent: true, opacity: .5})); d.castShadow = false; drops.push(d); }
  const sandbags = []; for (let i = 0; i < 8; i++) sandbags.push(block(s, -3 + i * .62, .12, 3.4, .58, .24, .4, 0xb89a6a));
  const me = hero(s, 1.2, 4.6, Math.PI, 'Idle');
  sign(s, ['FLOODING', UP(shot.place)], -3.6, 3.4, -9.9, 4, 1.6, {bg: '#ffd23f', fg: '#0f1a33', size: 90, h: 360, w: 768});
  block(s, -4.4, 2, -10, .16, 4, .16, 0x555555); block(s, -2.8, 2, -10, .16, 4, .16, 0x555555);
  s.userData.tick = (t) => {
    water.position.y = -.25 + Math.min(.5, t * .12) + Math.sin(t * 2) * .02;
    drops.forEach((d, i) => { d.position.y = 12 - ((t * 14 + rand(i + 3) * 12) % 12); });
    me.userData.pose('Idle', t);
  };
  s.userData.camera = {from: [3.4, 2.2, 9.5], to: [2.6, 2, 8], look: () => [0, .8, -6]};
  return s;
}
shots.flood = (shot) => waterStreet(shot);
shots.storm = (shot) => waterStreet(shot, {rain: true});

shots.outbreak = (shot) => {
  // A quiet street: few people, a pharmacy queue, a public-health banner.
  const s = new T.Scene(); sky(s, 0x9db3c2, 0xe3e6dc); lights(s, {power: 1.6}); street(s, {cars: false, fog: 0xc9d3cf});
  block(s, -4.4, 2.4, -10, .16, 4.8, .16, 0x555555); block(s, -2, 2.4, -10, .16, 4.8, .16, 0x555555);
  sign(s, ['PUBLIC HEALTH NOTICE', UP(shot.place)], -3.2, 4.2, -9.9, 4, 2.2, {bg: '#e8f4ee', fg: '#0f3a24', size: 80, h: 420, w: 768, accent: '#2f9e64'});
  const queue = []; for (let i = 0; i < 6; i++) queue.push(person(s, i % 2 ? 'man' : 'woman', 6.2, -2 - i * 1.6, Math.PI, crowdShirts[i % 6], 'Idle', i * .4));
  const me = hero(s, 1, -10, 0, 'Walk');
  s.userData.tick = (t) => { queue.forEach(p => p.userData.pose('Idle', t)); go(me, 1, -10, 0, 1, t * WALK); me.userData.pose('Walk', t); };
  s.userData.camera = {from: [2.6, 1.8, 0], to: [2.2, 1.7, 2.2], look: () => [me.position.x, 1, me.position.z]};
  return s;
};

shots.outage = () => {
  // The shelter's lights go out; only phone screens remain.
  const s = new T.Scene(); s.background = new T.Color(0x151924); lights(s, {power: .5, ambient: .7, from: [8, 10, 6]});
  const g = gym(s), spot = g.spot;
  const me = person(s, KIND, spot.position.x, spot.position.z, Math.PI * .1, HERO, 'Sitting');
  const screen = block(s, spot.position.x + .05, .72, spot.position.z + .3, .12, .2, .02, glow(0x9fd3ff, 0));
  const phoneLight = new T.PointLight(0x9fd3ff, 0, 2.5); phoneLight.position.set(spot.position.x + .1, .7, spot.position.z + .5); s.add(phoneLight);
  s.userData.tick = (t) => {
    const on = t < 1.6;
    g.panels.forEach(p => { p.material.emissiveIntensity = on ? 1.6 : 0; }); g.lamp.intensity = on ? 40 : 0;
    screen.material.emissiveIntensity = on ? 0 : 2; phoneLight.intensity = on ? 0 : 3;
    g.crowd.forEach(p => p.userData.pose('Sitting', 1.2)); me.userData.pose('Sitting', 1.2);
  };
  s.userData.camera = {from: [spot.position.x + 2.4, 1.6, spot.position.z + 3.4], to: [spot.position.x + 1.4, 1.2, spot.position.z + 2.2], look: () => [spot.position.x, .5, spot.position.z]};
  return s;
};

function briefing(lines, tvLines, {clap = false} = {}) {
  const s = new T.Scene(); hall(s);
  const seat = (x, z) => block(s, x, .21, z, .42, .32, .42, 0xb08a5c);
  block(s, 0, .55, -5.2, 3.6, .08, 1, 0x5a4632); for (const x of [-1.6, 1.6]) block(s, x, .27, -5.2, .08, .54, .9, 0x4a3828);
  sign(s, lines, 0, 2.35, -6.75, 3.8, .9, {bg: '#0f1a33', fg: '#ffd23f', size: 78, accent: '#d7262e'});
  const officials = [-1, 0, 1].map((k, i) => { seat(k * 1.1, -5.95); const p = person(s, i % 2 ? 'woman' : 'man', k * 1.1, -5.95, 0, [0x2f3a56, 0x3a2f45, 0x2f4538][i], 'Sitting'); p.position.y = .02; return p; });
  sign(s, tvLines, -6.75, 1.9, -1.5, 2.6, 1.3, {bg: clap ? '#0f3a24' : '#1d2b4a', fg: '#ffffff', size: 100, accent: '#ffd23f'}, Math.PI / 2);
  const spots = clap ? [[-1.4, -3], [-.6, -2.1], [-1.2, .3], [.4, -3.3], [.8, .9], [-.2, 1.6]] : [[-3.6, -2.4], [-2, -1.2], [2.4, -2.2], [3.8, -.6], [-3.2, .9], [2.6, 1.4]];
  const crowd = spots.map(([x, z], i) => { if (!clap) seat(x, z); const p = person(s, i % 2 ? 'man' : 'woman', x, z, clap ? -Math.PI / 2 + (rand(i) - .5) * .4 : rand(i + 7) * 6.28 - 3.14, crowdShirts[i % 6], clap ? 'Clapping' : 'Sitting', rand(i) * 2); p.position.y = clap ? 0 : .02; return p; });
  const spot = clap ? [.1, -.9] : [.2, -.6]; if (!clap) seat(...spot);
  const me = person(s, KIND, spot[0], spot[1], clap ? -Math.PI / 2 : Math.PI * .1, HERO, clap ? 'Clapping' : 'Sitting'); me.position.y = clap ? 0 : .02;
  s.userData.tick = (t) => { officials.forEach(p => p.userData.pose('Sitting', 0)); crowd.forEach(p => p.userData.pose(clap ? 'Clapping' : 'Sitting', t)); me.userData.pose(clap ? 'Clapping' : 'Sitting', t); };
  s.userData.camera = clap ? {from: [4.6, 1.9, 1.6], to: [3.6, 1.8, 1.1], look: () => [-6.7, 1.6, -1.5]} : {from: [.6, 1.6, 3.8], to: [.4, 1.4, 3], look: () => [0, .9, -3.5]};
  return s;
}
shots.committee = (shot) => briefing(['EMERGENCY RESPONSE', UP(shot.country)], ['LIVE', UP(shot.place)]);
shots.tv = (shot) => briefing(['CEASEFIRE BRIEFING', UP(shot.country)], ['CEASEFIRE', `AGREED IN ${UP(shot.place)}`], {clap: true});

shots.aid = (shot) => {
  const s = new T.Scene(); s.background = new T.Color(0x2a3140); lights(s, {power: 1.3, ambient: 1.5, from: [8, 10, 6]});
  gym(s, {lit: true});
  const worker = hero(s, 3.3, -4.9, Math.PI / 2, 'Walk');
  for (let crate = 0; crate < 6; crate++) {
    block(s, 5 + (crate % 3) * .9, .4 + Math.floor(crate / 3) * .8, -5.5, .8, .75, .8, 0x9c7b56);
  }
  sign(s, ['RELIEF SUPPLIES'], 5.9, 2.3, -5.08, 2.6, .7, {bg: '#ffffff', fg: '#0f1a33', size: 90});
  s.userData.tick = (t) => {
    go(worker, 3.3, -4.9, 1, 0, Math.min(1.2, t * WALK));
    worker.userData.pose(t * WALK < 1.2 ? 'Walk' : 'Idle', t);
  };
  s.userData.camera = {from: [1.2, 2.2, .4], to: [2.5, 1.9, -.7], look: () => [4.8, 1.1, -5.2]};
  return s;
};

shots.evacuation = (shot) => {
  const s = new T.Scene(); sky(s, 0x8fb7d4, 0xf0dcc0); lights(s); street(s, {cars: false});
  // An orderly queue leaving town, away from the camera; cars drive the same way.
  const queue = []; for (let i = 0; i < 14; i++) queue.push(person(s, i % 2 ? 'man' : 'woman', i % 2 ? 2.85 : 3.55, 4 - i * 1.25, Math.PI, i === 3 ? HERO : crowdShirts[i % 6], 'Walk', rand(i) * 2));
  const cars = []; for (let i = 0; i < 7; i++) { const c = model(i % 3 === 2 ? 'delivery' : 'sedan', 1.4, -1.6, 6 - i * 3.6, Math.PI); s.add(c); cars.push(c); }
  block(s, 5.4, 3, -9, .16, 6, .16, 0x555555); block(s, 8.2, 3, -9, .16, 6, .16, 0x555555);
  sign(s, ['EVACUATION ROUTE', UP(shot.place)], 6.8, 5.6, -8.9, 4.6, 2.5, {bg: '#ffd23f', fg: '#0f1a33', size: 86, h: 420, w: 768});
  const me = queue[3];
  s.userData.tick = (t) => {
    queue.forEach((p, i) => { go(p, i % 2 ? 2.85 : 3.55, 4 - i * 1.25, 0, -1, t * WALK); p.userData.pose('Walk', t); });
    cars.forEach((c, i) => go(c, -1.6, 6 - i * 3.6, 0, -1, t * 2.2));
  };
  s.userData.camera = {from: [.6, 2.6, 8], to: [1.2, 2.4, 4], look: () => [me.position.x, 1.1, me.position.z - 2]};
  return s;
};

shots.departures = () => {
  const s = new T.Scene();
  hall(s);
  sign(s, ['DEPARTURES', 'FLIGHTS DISRUPTED'], 0, 2.6, -5.9, 4.8, 1.8,
    {bg: '#141821', fg: '#ffcf65', size: 102, w: 1024, h: 420});
  const traveller = hero(s, .5, -2, Math.PI, 'Idle');
  block(s, 1, .27, -2, .32, .54, .42, 0x343c4c);
  s.userData.tick = (t) => traveller.userData.pose('Idle', t);
  s.userData.camera = {from: [0, 1.8, 4], to: [.25, 1.7, 2.75], look: () => [0, 1.85, -4.4]};
  return s;
};

shots.market = (shot) => {
  // A city street under a market board that only ever says one thing.
  const s = new T.Scene(); sky(s, 0x7f98b0, 0xe2d6c2); lights(s); street(s);
  block(s, -4.4, 3, -12, .2, 6, .2, 0x555555); block(s, 4.4, 3, -12, .2, 6, .2, 0x555555);
  const board = sign(s, ['MARKETS', '▼ ▼ ▼', UP(shot.place)], 0, 6.4, -11.9, 9, 3.2, {bg: '#111', fg: '#ff4a3a', size: 96, h: 384});
  const me = hero(s, -.6, -10, 0, 'Walk');
  const others = [0, 1, 2].map(i => person(s, i % 2 ? 'woman' : 'man', 2.4 - i * 2.6, -13 - i * 1.4, 0, crowdShirts[i + 2], 'Walk', i * .5));
  s.userData.tick = (t) => {
    board.material.opacity = 1; board.visible = Math.sin(t * 6) > -.9;
    go(me, -.6, -10, 0, 1, t * WALK); me.userData.pose('Walk', t);
    others.forEach((p, i) => { go(p, 2.4 - i * 2.6, -13 - i * 1.4, 0, 1, t * WALK); p.userData.pose('Walk', t); });
  };
  s.userData.camera = {from: [1.4, 1.6, 1.5], to: [1.2, 1.7, 3.2], look: () => [0, 4.2, -12]};
  return s;
};

shots.street = (shot) => {
  // Protest or escalation: a crowd with placards, jets passing high overhead (nose first).
  const s = new T.Scene(); sky(s, 0x6f93b8, 0xe9d6bc); lights(s); street(s);
  const conflict = shot.event_type === 'conflict_escalation';
  const jets = conflict ? [0, 1, 2].map(i => { const j = new T.Group(); block(j, 0, 0, 0, .3, .2, 1.6, 0x6b7280); block(j, 0, 0, -.2, 1.4, .05, .5, 0x6b7280); j.rotation.y = Math.PI / 2; j.position.set(-40, 24 + i, -30 - i * 3); s.add(j); return j; }) : [];
  const crowd = []; for (let i = 0; i < 10; i++) {
    const p = person(s, i % 2 ? 'man' : 'woman', -3 + (i % 5) * 1.5, -14 - Math.floor(i / 5) * 1.6, 0, crowdShirts[i % 6], 'Walk', rand(i) * 2); crowd.push(p);
    if (!conflict && i % 3 === 0) sign(p, [['ENOUGH', 'ACT NOW', 'WE NEED ANSWERS'][Math.floor(i / 3) % 3]], 0, 7.5, 0, 3.2, 1.6, {bg: '#ffffff', fg: '#10131b', size: 120, w: 512, h: 256});
  }
  const me = hero(s, 3.8, -6, 0, 'Walk');
  sign(s, [conflict ? 'STAY INDOORS' : 'ROAD CLOSED', UP(shot.place)], -3.2, 4.2, -9.9, 4, 1.8, {bg: '#d7262e', fg: '#ffffff', size: 88, h: 384, w: 768});
  block(s, -4.4, 2.4, -10, .16, 4.8, .16, 0x555555); block(s, -2, 2.4, -10, .16, 4.8, .16, 0x555555);
  s.userData.tick = (t) => {
    jets.forEach((j, i) => { j.position.x = -40 + (t - i * .4) * 18; });
    crowd.forEach((p, i) => { go(p, -3 + (i % 5) * 1.5, -14 - Math.floor(i / 5) * 1.6, 0, 1, t * WALK); p.userData.pose('Walk', t); });
    go(me, 3.8, -6, 0, 1, t * WALK); me.userData.pose('Walk', t);
  };
  s.userData.camera = {from: [5.4, 1.8, 2], to: [5, 1.7, 3.6], look: () => [me.position.x - 2, 1.2, me.position.z - 3]};
  return s;
};

shots.map = (shot) => {
  // Mark the exact event location. Several events can share the same place name.
  const s = new T.Scene(); s.background = new T.Color(0x8fb4c0); s.fog = new T.Fog(0x8fb4c0, 60, 160);
  s.add(new T.HemisphereLight(0xffffff, 0x61706b, 2.3)); const sun = new T.DirectionalLight(0xfff0d0, 1.6); sun.position.set(-6, 12, 7); s.add(sun);
  const ocean = new T.Mesh(new T.PlaneGeometry(600, 600), mat(0x6f9fb0)); ocean.rotation.x = -Math.PI / 2; ocean.position.y = -.05; s.add(ocean);
  const [w, e, so, no] = script.map.box, lon0 = (w + e) / 2, lat0 = (so + no) / 2, cos = Math.cos(lat0 * Math.PI / 180);
  const k = 60 / Math.max((e - w) * cos, (no - so), 1);
  const xy = (lon, lat) => [(lon - lon0) * k * cos, -(lat - lat0) * k];
  for (const rings of Object.values(script.map.countries)) for (const ring of rings) {
    const shape = new T.Shape(); ring.forEach(([lon, lat], i) => { const [x, y] = xy(lon, lat); i ? shape.lineTo(x, -y) : shape.moveTo(x, -y); });
    const m = new T.Mesh(new T.ExtrudeGeometry(shape, {depth: .25, bevelEnabled: false}), mat(0xe3d6b6)); m.rotation.x = -Math.PI / 2; s.add(m);
  }
  const [hx, hz] = xy(shot.lon, shot.lat);
  block(s, hx, .6, hz, .35, 1.2, .35, glow(0xd7262e, 1.2));
  sign(s, [UP(shot.title)], hx, 2.1, hz, Math.min(11, 2 + shot.title.length * .29), 1,
    {bg: '#141821', fg: '#ffffff', size: 100}).rotation.x = -.9;
  const ring = new T.Mesh(new T.RingGeometry(.9, 1, 48), new T.MeshBasicMaterial({color: 0xffffff, transparent: true, side: T.DoubleSide}));
  ring.rotation.x = -Math.PI / 2; ring.position.set(hx, .45, hz); s.add(ring);
  const blast = shot.event_type === 'nuclear_detonation';
  const cloud = new T.Group(); cloud.position.set(hx, 0, hz); cloud.scale.setScalar(.5); s.add(cloud); cloud.visible = false;
  const stem = new T.Mesh(new T.CylinderGeometry(.35, .6, 1, 12), mat(0x9b938a)); cloud.add(stem);
  const cap = []; for (let i = 0; i < 9; i++) { const c = new T.Mesh(new T.IcosahedronGeometry(1, 1), mat(i % 2 ? 0xb3aaa0 : 0x8f877e)); c.userData.a = i / 9 * Math.PI * 2; cloud.add(c); cap.push(c); }
  s.userData.tick = (t) => {
    const f = Math.max(0, t - .8);
    ring.scale.setScalar(.6 + (blast ? f * 2 : (f % 1.4) * 2)); ring.material.opacity = blast ? Math.max(0, .9 - f / 3) : .9 * (1 - (f % 1.4) / 1.4);
    if (blast) {
      const rise = Math.min(1, f / 3), h = .4 + rise * 4.5; cloud.visible = f > .2; stem.scale.y = h; stem.position.y = h / 2;
      cap.forEach((c, i) => { const r = (.3 + rise * .45) * (i % 3 ? 1 : .4); c.position.set(Math.cos(c.userData.a) * r, h + .15 * (i % 2), Math.sin(c.userData.a) * r); c.scale.setScalar(.5 + rise * 1.1); });
      window.FLASH = f > 0 && f < .25 ? 1 - f / .25 : 0;
    }
  };
  s.userData.camera = {from: [hx, 34, hz + 18], to: [hx, 28, hz + 14], look: () => [hx, 0, hz]};
  return s;
};

shots['home-again'] = () => {
  // Two beats: a resident heads home as recovery begins.
  const out = new T.Scene(); sky(out, 0x8ec2e6, 0xfbe3c2); lights(out); street(out);
  const walker = hero(out, .6, -10, 0, 'Walk');
  const home = new T.Scene(); home.background = new T.Color(0x2a2f3a); lights(home, {power: 1.6, from: [6, 9, 8]});
  const a = apartment(home);
  const me = hero(a.room, 3.2, 1.6, 0, 'Walk');
  const split = 2.6, to = [.9, 1.1], walkLen = Math.hypot(to[0] - 3.2, to[1] - 1.6);
  const tick = (t) => {
    if (t < split) { go(walker, .6, -10, 0, 1, t * WALK); walker.userData.pose('Walk', t); return out; }
    const u = t - split, d = Math.min(walkLen, u * WALK);
    if (d < walkLen) { go(me, 3.2, 1.6, to[0] - 3.2, to[1] - 1.6, d); me.userData.pose('Walk', u); }
    else { me.position.set(to[0], 0, to[1]); me.rotation.y = Math.PI; me.userData.pose('Idle', u); }
    return home;
  };
  return {split, tick,
    camera: (t) => t < split ? {from: [1.8, 1.7, -2], to: [1.6, 1.7, -.5], look: [walker.position.x, 1, walker.position.z]} : {from: [3.2, 1.6, 4.4], to: [2.6, 1.5, 3.7], look: [1, .7, .4]}};
};

const scenes = script.shots.map(shot => (shots[shot.scene] ?? shots.map)(shot));

// ---- overlays ----------------------------------------------------------------
const $ = (q) => document.querySelector(q);
const camera = new T.PerspectiveCamera(50, W / H, .05, 400);
const OUTRO = script.outro_seconds;
const cuts = timing.cuts, total = cuts[cuts.length - 1] + OUTRO;
const shotParam = new URLSearchParams(location.search).get('shot');
const selected = shotParam === null ? -1 : Number(shotParam);
if (selected !== -1 && !(Number.isInteger(selected) && selected >= 0 && selected < scenes.length)) throw new Error('Invalid shot');
window.DUR = selected < 0 ? total : (selected === scenes.length - 1 ? cuts[selected + 1] + OUTRO : cuts[selected + 1]) - cuts[selected];
const ease = (x) => x < .5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2;

// Fit caption changes to the measured narration length. Grouping words keeps
// the scene visible while the narrator reads a longer report.
const captionTracks = script.shots.map(data => {
  const chunks = data.captions ?? [data.narration];
  let words = 0;
  const segments = chunks.map(text => ({text, end: words += text.trim().split(/\s+/).length}));
  return {segments, words};
});

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

  $('#country').textContent = data.country;
  $('#place').textContent = data.place === data.country ? '' : data.place;
  $('#date').textContent = data.date;
  const track = captionTracks[i];
  const elapsed = Math.max(0, local - timing.lead_in);
  const word = elapsed / Math.max(.01, timing.voice_durations[i]) * track.words;
  const caption = track.segments.find(segment => word < segment.end) ?? track.segments.at(-1);
  $('#caption').textContent = caption.text;
  $('#flash').style.opacity = window.FLASH;
  renderer.render(scene, camera);
};
window.READY = true; window.render(0);
