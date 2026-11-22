// "Tom's three days": a fictional UK-France nuclear standoff (real countries, invented
// events, no real people or organizations), followed through one invented clerk. Text comes from script.json (fixture facts +
// worldwire.satire notifications); cuts come from timing.json.
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
const europe = await (await fetch(`${base}map-europe.json`)).json();
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
// Plausible Londoners: a real-world mix, weighted toward lighter tones, varied hair.
const LOCALS = {skin: [0xf3d0b5, 0xedc3a4, 0xf0c9ad, 0xe2b090, 0xc98e66, 0x9a6644, 0x6e4630], hair: [0x2b1d14, 0x4a3020, 0x8a5a32, 0xb5874f, 0x15110e, 0x9a4b26]};
const HERO_LOOK = {skin: 0xefc6a6, hair: 0x5a3a22};
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
  for (const name of ['Idle', 'Walk', 'Run', 'Sitting', 'Standing', 'Clapping']) {
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

function pamphlets(parent, x, y, z, label, h = .25) {
  const stack = block(parent, x, y + h / 2, z, .34, h, .46, 0xf3efe4);
  sign(parent, label, x, y + h + .09, z + .24, .5, .16, {bg: '#ffffff', fg: '#10131b', size: 104, w: 768});
  return stack;
}

shots.home = () => {
  const s = new T.Scene(); s.background = new T.Color(0x2a2f3a); lights(s, {power: 1.4, from: [6, 9, 8]});
  const a = apartment(s); a.toast.forEach(t => { t.visible = false; });  // the "toaster" is his coffee machine here
  const laptop = block(a.room, .9, .45, .2, .5, .03, .34, 0x2b2f36);
  const screen = sign(a.room, ['NO CONNECTION', 'TRY AGAIN LATER'], .9, .62, .02, .48, .3, {bg: '#1d2b4a', fg: '#ffffff', size: 84, w: 768});
  screen.rotation.x = -.2;
  pamphlets(a.room, 1.7, .41, .35, ['DON\'T PANIC', 'DRAFT 3']);
  const tomas = person(a.room, 'man', .9, 1.05, Math.PI, HERO, 'Idle');
  s.userData.tick = (t) => { tomas.userData.pose('Idle', t); screen.visible = t > 1 || Math.sin(t * 20) > 0; };
  s.userData.camera = {from: [3, 1.7, 3.9], to: [2.3, 1.5, 3.1], look: () => [.9, .7, .2]};
  return s;
};

shots.street = () => {
  const s = new T.Scene(); sky(s, 0x6f93b8, 0xe9d6bc); lights(s); street(s);
  const pole = block(s, 4, 3.1, -6, .15, 6.2, .15, 0x595959); block(s, 4, 6, -6, .7, .7, .6, 0xcea64f);
  const beacon = block(s, 4, 6.5, -6, .9, .5, .7, 0xb84331);
  // Jets cross high overhead, nose first (+X), the way they fly.
  const jets = [0, 1, 2].map(i => { const j = new T.Group(); block(j, 0, 0, 0, .3, .2, 1.6, 0x6b7280); block(j, 0, 0, -.2, 1.4, .05, .5, 0x6b7280); j.rotation.y = Math.PI / 2; j.position.set(-40, 24 + i, -30 - i * 3); s.add(j); return j; });
  const tomas = person(s, 'man', -.6, -8, 0, HERO, 'Walk');
  const others = [0, 1, 2].map(i => person(s, i % 2 ? 'woman' : 'man', -3.4 + i * 3.3, -12 - i * 2, 0, crowdShirts[i + 1], 'Walk', i * .5));
  s.userData.tick = (t) => {
    beacon.material.emissive.setHex(Math.sin(t * 9) > 0 ? 0xff2a1a : 0); beacon.material.emissiveIntensity = 1.2;
    jets.forEach((j, i) => { j.position.x = -40 + (t - i * .4) * 18; });
    go(tomas, -.6, -8, 0, 1, t * WALK); tomas.userData.pose('Walk', t);
    others.forEach((p, i) => { go(p, -3.4 + i * 3.3, -12 - i * 2, 0, 1, t * WALK); p.userData.pose('Walk', t); });
  };
  s.userData.camera = {from: [1.4, 1.8, 0], to: [1.2, 1.7, 2.6], look: () => [tomas.position.x, 1, tomas.position.z]};
  return s;
};

shots.queue = () => {
  const s = new T.Scene(); sky(s, 0x7d8fa6, 0xd9c7ae); lights(s, {power: 1.8}); street(s, {cars: false});
  // A public shelter entrance at the end of the street; the queue walks to it, away from camera.
  const bunker = new T.Group(); bunker.position.set(0, 0, -26); s.add(bunker);
  block(bunker, 0, 1.6, 0, 7, 3.2, 4, 0x9a9a94); block(bunker, 0, 1.2, 2.02, 2.4, 2.4, .05, 0x15171c);
  block(bunker, 0, 3.3, .2, 7.6, .3, 4.6, 0x86867f);
  sign(bunker, ['PUBLIC SHELTER 12', 'PLEASE QUEUE CALMLY'], 0, 2.75, 2.06, 3.6, .7, {bg: '#ffd23f', fg: '#10131b', size: 96});
  const queue = []; for (let i = 0; i < 14; i++) queue.push(person(s, i % 2 ? 'man' : 'woman', i % 2 ? -.35 : .35, 2 - i * 1.25, Math.PI, i === 2 ? HERO : crowdShirts[i % 6], 'Walk', rand(i) * 2));
  queue[2].traverse(o => { if (o.isMesh) o.castShadow = true; });
  const siren = new T.PointLight(0xff3b2f, 0, 30); siren.position.set(0, 6, -22); s.add(siren);
  s.userData.tick = (t) => {
    queue.forEach((p, i) => { go(p, i % 2 ? -.35 : .35, 2 - i * 1.25, 0, -1, t * WALK); p.userData.pose('Walk', t); });
    siren.intensity = Math.sin(t * 6) > 0 ? 60 : 0;
  };
  const hero = queue[2];
  s.userData.camera = {from: [-2.4, 2.4, 6.5], to: [-1.8, 2.3, 3], look: () => [hero.position.x, 1.2, hero.position.z - 4]};
  return s;
};

shots.blast = () => {
  // Real coastlines (Natural Earth) seen from high above. The warning detonation over the
  // Celtic Sea is shown plainly and far away, with no joke.
  const s = new T.Scene(); s.background = new T.Color(0x8fb4c0); s.fog = new T.Fog(0x8fb4c0, 40, 120);
  s.add(new T.HemisphereLight(0xffffff, 0x61706b, 2.3)); const sun = new T.DirectionalLight(0xfff0d0, 1.6); sun.position.set(-6, 12, 7); s.add(sun);
  const ocean = new T.Mesh(new T.PlaneGeometry(400, 400), mat(0x6f9fb0)); ocean.rotation.x = -Math.PI / 2; ocean.position.y = -.05; s.add(ocean);
  const lon0 = -2.5, lat0 = 50, k = 1.1, cos = Math.cos(lat0 * Math.PI / 180), xy = (lon, lat) => [(lon - lon0) * k * cos, -(lat - lat0) * k];
  const colours = {GBR: 0xeadfc2, FRA: 0xe3d6b6};
  for (const [iso, rings] of Object.entries(europe)) for (const ring of rings) {
    const shape = new T.Shape(); ring.forEach(([lon, lat], i) => { const [x, y] = xy(lon, lat); i ? shape.lineTo(x, -y) : shape.moveTo(x, -y); });
    const m = new T.Mesh(new T.ExtrudeGeometry(shape, {depth: colours[iso] ? .3 : .15, bevelEnabled: false}), mat(colours[iso] ?? 0xcfc9b6));
    m.rotation.x = -Math.PI / 2; s.add(m);
  }
  for (const p of script.map.places) { const [x, z] = xy(p.lon, p.lat); sign(s, [p.name], x, 1, z, p.name.length > 8 ? 3.6 : 2.4, .55, {bg: '#10131b', fg: '#ffffff', size: 110}).rotation.x = -.9; }
  const b = script.map.blast, [bx, bz] = xy(b.lon, b.lat);
  const flash = new T.Mesh(new T.SphereGeometry(1, 24, 16), new T.MeshBasicMaterial({color: 0xfff6d8, transparent: true}));
  flash.position.set(bx, .4, bz); s.add(flash);
  const ring = new T.Mesh(new T.RingGeometry(.9, 1, 48), new T.MeshBasicMaterial({color: 0xffffff, transparent: true, side: T.DoubleSide}));
  ring.rotation.x = -Math.PI / 2; ring.position.set(bx, .45, bz); s.add(ring);
  const cloud = new T.Group(); cloud.position.set(bx, 0, bz); cloud.scale.setScalar(.36); s.add(cloud);
  const stem = new T.Mesh(new T.CylinderGeometry(.35, .6, 1, 12), mat(0x9b938a)); cloud.add(stem);
  const cap = []; for (let i = 0; i < 9; i++) { const c = new T.Mesh(new T.IcosahedronGeometry(1, 1), mat(i % 2 ? 0xb3aaa0 : 0x8f877e)); c.userData.a = i / 9 * Math.PI * 2; cloud.add(c); cap.push(c); }
  s.userData.tick = (t) => {
    const f = Math.max(0, t - .8);  // narration first names it; the flash follows
    flash.visible = f > 0 && f < 1.2; flash.scale.setScalar(.1 + f); flash.material.opacity = Math.max(0, 1 - f / 1.2);
    ring.visible = f > 0; ring.scale.setScalar(.5 + f * 1.8); ring.material.opacity = Math.max(0, .9 - f / 3);
    const rise = Math.min(1, f / 3), h = .4 + rise * 4.5;
    cloud.visible = f > .2; stem.scale.y = h; stem.position.y = h / 2;
    cap.forEach((c, i) => { const r = (.3 + rise * .45) * (i % 3 ? 1 : .4); c.position.set(Math.cos(c.userData.a) * r, h + .15 * (i % 2), Math.sin(c.userData.a) * r); c.scale.setScalar(.5 + rise * 1.1); });
    window.FLASH = f > 0 && f < .25 ? 1 - f / .25 : 0;
  };
  const [mx, mz] = xy(-2.3, 50);
  s.userData.camera = {from: [mx, 27, mz + 13], to: [mx, 24, mz + 11], look: () => [mx, 0, mz]};
  return s;
};

function shelter({ceasefire = false} = {}) {
  // A concrete fallout shelter: closed room, cardboard-box seats, a committee table and a TV.
  const s = new T.Scene(); s.background = new T.Color(0x14171d); lights(s, {power: .5, ambient: 1, from: [8, 10, 6]});
  block(s, 0, -.05, 0, 14, .1, 14, 0x6f6d68);
  for (const x of [-6.9, 6.9]) block(s, x, 1.6, 0, .2, 3.2, 14, 0x8a8781); block(s, 0, 1.6, -6.9, 14, 3.2, .2, 0x8a8781);
  block(s, 0, 1.6, 6.9, 14, 3.2, .2, 0x8a8781).castShadow = false; block(s, 0, 3.25, 0, 14, .1, 14, 0x75736e).castShadow = false;
  const tubes = []; for (let i = 0; i < 4; i++) tubes.push(block(s, -4.5 + i * 3, 3.15, -1, 1.4, .08, .2, glow(0xe9f2ff, 1.4)));
  const lamp = new T.PointLight(0xe9f2ff, 24, 20); lamp.position.set(0, 2.9, 0); s.add(lamp);
  const seat = (x, z) => block(s, x, .21, z, .42, .32, .42, 0xb08a5c);
  // Committee table at the back with three seated officials under their banner.
  block(s, 0, .55, -5.2, 3.6, .08, 1, 0x5a4632); for (const x of [-1.6, 1.6]) block(s, x, .27, -5.2, .08, .54, .9, 0x4a3828);
  sign(s, ['EMERGENCY MEETING', '(TO SCHEDULE EMERGENCY MEETING)'], 0, 2.35, -6.75, 3.8, .9, {bg: '#0f1a33', fg: '#ffd23f', size: 78, accent: '#d7262e'});
  const officials = [-1, 0, 1].map((k, i) => { seat(k * 1.1, -5.95); return person(s, i % 2 ? 'woman' : 'man', k * 1.1, -5.95, 0, [0x2f3a56, 0x3a2f45, 0x2f4538][i], 'Sitting'); });
  officials.forEach(p => { p.position.y = .02; });
  // Wall TV on the left wall.
  const tv = sign(s, ceasefire ? ['CEASEFIRE', `SIGNED IN ${script.ceasefire_place.toUpperCase()}`] : ['STAY TUNED', 'REASSURANCE FOLLOWS'], -6.75, 1.9, -1.5, 2.6, 1.3,
    {bg: ceasefire ? '#0f3a24' : '#1d2b4a', fg: '#ffffff', size: 100, accent: '#ffd23f'}, Math.PI / 2);
  // Seated, people face every which way; at the ceasefire they all stand and face the TV (-X).
  const crowd = []; const spots = ceasefire
    ? [[-1.4, -3], [-.6, -2.1], [-1.2, .3], [.4, -3.3], [.8, .9], [-.2, 1.6], [1.6, -2.4]]
    : [[-3.6, -2.4], [-2, -1.2], [2.4, -2.2], [3.8, -.6], [-3.2, .9], [2.6, 1.4], [.2, 1.8]];
  spots.forEach(([x, z], i) => { if (!ceasefire) seat(x, z); const rot = ceasefire ? -Math.PI / 2 + (rand(i) - .5) * .4 : rand(i + 7) * 6.28 - 3.14; const p = person(s, i % 2 ? 'man' : 'woman', x, z, rot, crowdShirts[i % 6], ceasefire ? 'Clapping' : 'Sitting', rand(i) * 2); p.position.y = ceasefire ? 0 : .02; crowd.push(p); });
  const spot = ceasefire ? [.1, -.9] : [.2, -.6]; if (!ceasefire) seat(...spot);
  const tomas = person(s, 'man', spot[0], spot[1], ceasefire ? -Math.PI / 2 : Math.PI * .1, HERO, ceasefire ? 'Clapping' : 'Sitting');
  tomas.position.y = ceasefire ? 0 : .02;
  if (!ceasefire) pamphlets(s, spot[0] + .55, 0, spot[1] + .1, ['DON\'T PANIC', 'DRAFT 9'], .5);
  s.userData.tick = (t) => {
    const flicker = !ceasefire && (Math.sin(t * 13) > .92 || (t > 1.5 && t < 1.6));
    tubes.forEach(b => { b.material.emissiveIntensity = flicker ? .2 : 1.4; }); lamp.intensity = flicker ? 6 : 24;
    officials.forEach(p => p.userData.pose('Sitting', 0));
    crowd.forEach(p => p.userData.pose(ceasefire ? 'Clapping' : 'Sitting', t));
    tomas.userData.pose(ceasefire ? 'Clapping' : 'Sitting', t);
  };
  s.userData.camera = ceasefire
    ? {from: [4.6, 1.9, 1.6], to: [3.6, 1.8, 1.1], look: () => [-6.7, 1.6, -1.5]}
    : {from: [.6, 1.6, 3.8], to: [.4, 1.4, 3], look: () => [0, .9, -3.5]};
  return s;
}
shots.shelter = () => shelter();
shots.ceasefire = () => shelter({ceasefire: true});

shots['home-again'] = () => {
  // Two beats: Tomas comes up the street, then he is home with the finished pamphlets.
  const out = new T.Scene(); sky(out, 0x8ec2e6, 0xfbe3c2); lights(out); street(out);
  const walker = person(out, 'man', .6, -10, 0, HERO, 'Walk');
  const home = new T.Scene(); home.background = new T.Color(0x2a2f3a); lights(home, {power: 1.6, from: [6, 9, 8]});
  const a = apartment(home); a.toast.forEach(t => { t.visible = false; });
  pamphlets(a.room, 1.7, .41, .35, ['DON\'T PANIC', 'FINAL'], .55);
  const tomas = person(a.room, 'man', 3.2, 1.2, 0, HERO, 'Walk');
  const split = 2.6, to = [1.15, .9], walkLen = Math.hypot(to[0] - 3.2, to[1] - 1.2);
  const tick = (t) => {
    if (t < split) { go(walker, .6, -10, 0, 1, t * WALK); walker.userData.pose('Walk', t); return out; }
    const u = t - split, d = Math.min(walkLen, u * WALK);
    if (d < walkLen) { go(tomas, 3.2, 1.2, to[0] - 3.2, to[1] - 1.2, d); tomas.userData.pose('Walk', u); }
    else { tomas.position.set(to[0], 0, to[1]); tomas.rotation.y = Math.PI * .85; tomas.userData.pose('Idle', u); }
    return home;
  };
  return {split, tick,
    camera: (t) => t < split ? {from: [1.8, 1.7, -2], to: [1.6, 1.7, -.5], look: [walker.position.x, 1, walker.position.z]} : {from: [3.4, 1.6, 4.4], to: [2.8, 1.5, 3.7], look: [1.2, .8, .4]}};
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
