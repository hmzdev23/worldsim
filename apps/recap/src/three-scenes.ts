import * as THREE from "three";

type Place = { lat: number; lon: number };
type Data = {
  hazard?: string;
  vignette?: string;
  places?: Place[];
  aid?: Place[];
  recovery?: Place[];
};
export type Shot3D = { kind: string; data: Data };

const ink = 0x10121b,
  red = 0xc53242,
  cyan = 0x7eddd2,
  gold = 0xffbb4d;
const mat = (color: number, emissive = 0x000000) =>
  new THREE.MeshStandardMaterial({
    color,
    emissive,
    roughness: 0.78,
    metalness: 0.08,
  });
function solid(
  g: THREE.Group,
  geom: THREE.BufferGeometry,
  color: number,
  x: number,
  y: number,
  z: number,
  edges = true,
  emissive = 0,
) {
  const mesh = new THREE.Mesh(geom, mat(color, emissive));
  mesh.position.set(x, y, z);
  g.add(mesh);
  if (edges) {
    const outline = new THREE.LineSegments(
      new THREE.EdgesGeometry(geom, 30),
      new THREE.LineBasicMaterial({ color: ink }),
    );
    mesh.add(outline);
  }
  return mesh;
}
function box(
  g: THREE.Group,
  w: number,
  h: number,
  d: number,
  c: number,
  x: number,
  y: number,
  z: number,
) {
  return solid(g, new THREE.BoxGeometry(w, h, d), c, x, y, z);
}
function sphere(
  g: THREE.Group,
  r: number,
  c: number,
  x: number,
  y: number,
  z: number,
) {
  return solid(g, new THREE.SphereGeometry(r, 20, 14), c, x, y, z, false);
}
function cylinder(
  g: THREE.Group,
  r1: number,
  r2: number,
  h: number,
  c: number,
  x: number,
  y: number,
  z: number,
) {
  return solid(g, new THREE.CylinderGeometry(r1, r2, h, 16), c, x, y, z);
}
function beam(
  g: THREE.Group,
  a: THREE.Vector3,
  b: THREE.Vector3,
  width: number,
  c: number,
) {
  const dir = b.clone().sub(a);
  const obj = cylinder(g, width, width, dir.length(), c, 0, 0, 0);
  obj.position.copy(a.clone().add(b).multiplyScalar(0.5));
  obj.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    dir.normalize(),
  );
  return obj;
}
function person(
  g: THREE.Group,
  x: number,
  z: number,
  scale: number,
  pose: string,
  t: number,
  hoodie = red,
) {
  const p = new THREE.Group();
  p.name = "recap-character";
  g.add(p);
  p.position.set(x, 0, z);
  p.scale.setScalar(scale);
  const walk = pose === "walk" ? Math.sin(t * 5 + x) * 0.35 : 0;
  const body = sphere(p, 0.56, hoodie, 0, 1.12, 0);
  body.scale.set(1.05, 1.2, 0.75);
  sphere(p, 0.52, 0xf7f2df, 0, 2.05, 0);
  sphere(p, 0.037, ink, -0.16, 2.08, 0.484).scale.set(0.8, 1.5, 0.45);
  sphere(p, 0.037, ink, 0.16, 2.08, 0.484).scale.set(0.8, 1.5, 0.45);
  beam(
    p,
    new THREE.Vector3(0, 2.57, 0),
    new THREE.Vector3(0.06, 2.81, 0.02),
    0.035,
    ink,
  );
  beam(
    p,
    new THREE.Vector3(0.06, 2.81, 0.02),
    new THREE.Vector3(0.22, 2.86, 0.02),
    0.035,
    ink,
  );
  for (const side of [-1, 1]) {
    beam(
      p,
      new THREE.Vector3(side * 0.25, 0.72, 0),
      new THREE.Vector3(side * 0.3, 0.22, walk * side),
      0.14,
      ink,
    );
    const raised = (pose === "point" && side === 1) || pose === "react";
    const handY = raised ? 1.48 + 0.15 * Math.sin(t * 3 + side) : 0.85;
    const handZ = pose === "walk" ? -walk * side : 0.05;
    beam(
      p,
      new THREE.Vector3(side * 0.4, 1.4, 0),
      new THREE.Vector3(side * 0.75, handY, handZ),
      0.16,
      hoodie,
    );
    sphere(p, 0.11, 0xf7f2df, side * 0.75, handY, handZ);
    beam(
      p,
      new THREE.Vector3(side * 0.13, 1.55, 0.45),
      new THREE.Vector3(side * 0.16, 1.2, 0.46),
      0.022,
      ink,
    );
  }
  p.position.y = pose === "walk" ? Math.abs(Math.sin(t * 5 + x)) * 0.06 : 0;
  if (pose === "walk") p.position.x += Math.min(t * 0.22, 1.5);
  if (pose === "react") p.rotation.z = Math.sin(t * 7 + x) * 0.09;
  p.rotation.y = pose === "walk" ? -0.65 : Math.sin(t * 1.2 + x) * 0.25;
  return p;
}
function base(g: THREE.Group) {
  box(g, 8, 0.38, 6, 0x1c2d3b, 0, -0.25, 0);
  box(g, 8, 0.09, 6, 0x2a4150, 0, -0.01, 0);
  for (let i = 0; i < 10; i++)
    box(g, 0.025, 0.02, 6, 0x38505c, -3.6 + i * 0.8, 0.05, 0);
}
function buildings(g: THREE.Group, t: number, quake: boolean) {
  for (let i = 0; i < 7; i++) {
    const b = new THREE.Group();
    g.add(b);
    const h = 1.25 + (i % 3) * 0.68;
    b.position.set(-3.25 + i * 1.05, 0, -1.65 - (i % 2) * 0.35);
    b.rotation.z = quake
      ? Math.sin(t * 14 + i) * 0.035 * Math.max(0, 1 - t / 3)
      : 0;
    box(b, 0.85, h, 0.8, [0x46596b, 0x59677a, 0x3d5366][i % 3], 0, h / 2, 0);
    box(b, 0.94, 0.12, 0.88, 0x202e3d, 0, h + 0.06, 0);
    for (let row = 0; row < Math.floor(h / 0.52); row++)
      for (let col = 0; col < 2; col++) {
        const light = quake && t > 1.3 ? 0x182737 : 0xffc06b;
        box(
          b,
          0.17,
          0.22,
          0.025,
          light,
          -0.2 + col * 0.38,
          0.35 + row * 0.48,
          0.414,
        );
      }
  }
}
function volcano(g: THREE.Group, t: number) {
  const mountain = solid(
    g,
    new THREE.ConeGeometry(2.1, 2.75, 6),
    0x574748,
    1.3,
    1.35,
    -1.2,
  );
  mountain.rotation.y = 0.2;
  const crater = cylinder(g, 0.38, 0.45, 0.12, 0xff6635, 1.3, 2.72, -1.2);
  (crater.material as THREE.MeshStandardMaterial).emissive.setHex(0xc92b0c);
  for (let i = 0; i < 7; i++) {
    const s = 0.25 + (i % 3) * 0.13;
    const puff = sphere(
      g,
      s,
      0x59636e,
      1.28 + Math.sin(i * 2 + t * 0.8) * (0.25 + i * 0.1),
      3 + i * 0.29,
      -1.2,
    );
    puff.scale.set(1.2, 0.75, 1);
  }
  for (let i = 0; i < 4; i++) {
    const lava = sphere(
      g,
      0.09,
      0xff793a,
      1.1 + i * 0.15,
      2.8 + ((t * 0.8 + i * 0.4) % 1.2),
      -1.2,
    );
    (lava.material as THREE.MeshStandardMaterial).emissive.setHex(0xd7350c);
  }
}
function hook(g: THREE.Group, data: Data, t: number) {
  base(g);
  buildings(g, t, data.hazard === "earthquake");
  if (data.hazard === "volcanic_eruption") volcano(g, t);
  person(g, -1.2, 1.1, 0.55, "react", t);
  person(g, 0.15, 0.7, 0.48, "react", t + 0.8, 0x467c91);
}
function vignette(g: THREE.Group, data: Data, t: number) {
  base(g);
  const kind = data.vignette || "generic";
  if (["power_out", "tsunami_siren", "flooding", "aftershock"].includes(kind))
    person(g, -1.8, 0.65, 0.56, "react", t);
  if (kind === "power_out") {
    box(g, 2.3, 2.9, 0.24, 0x637180, 1.1, 1.45, -0.7);
    box(g, 0.82, 1.1, 0.15, 0xded6bf, 1.1, 1.65, -0.5);
    box(g, 0.18, 0.48, 0.18, 0x252c35, 1.1, 1.65, -0.34);
    sphere(g, 0.35, 0xf6c85d, 2.6, 2.7, -0.4);
    beam(
      g,
      new THREE.Vector3(2.3, 2.2, -0.4),
      new THREE.Vector3(2.7, 2.6, -0.4),
      0.06,
      ink,
    );
  } else if (kind === "water_out") {
    box(g, 2.6, 0.22, 1.2, 0x7c969e, 1.2, 0.8, 0);
    box(g, 0.18, 1.1, 0.18, 0x7c969e, 1.1, 1.43, -0.45);
    beam(
      g,
      new THREE.Vector3(1.1, 1.95, -0.45),
      new THREE.Vector3(1.8, 1.95, -0.45),
      0.11,
      0x9db2b2,
    );
    sphere(g, 0.11, cyan, 1.8, 1.45 - (t % 1) * 0.5, -0.45);
  } else if (kind === "evacuation") {
    for (let i = 0; i < 7; i++)
      person(
        g,
        -2.6 + i * 0.68,
        -0.8 + (i % 3) * 0.8,
        0.42 + (i % 3) * 0.04,
        "walk",
        t + i * 0.3,
        [red, 0x477b91, 0xb28a57, 0x8a667f][i % 4],
      );
    box(g, 2.0, 0.2, 0.4, 0xeeeece, 1.6, 2.2, -1);
    beam(
      g,
      new THREE.Vector3(0.6, 1, -1),
      new THREE.Vector3(0.6, 2.3, -1),
      0.05,
      ink,
    );
  } else if (kind === "tsunami_siren") {
    cylinder(g, 0.1, 0.1, 2.3, 0xaab6b5, 1.2, 1.15, 0);
    const alarm = sphere(g, 0.53, t % 1 < 0.5 ? 0xff5544 : gold, 1.2, 2.55, 0);
    (alarm.material as THREE.MeshStandardMaterial).emissive.setHex(
      t % 1 < 0.5 ? 0x992211 : 0x553000,
    );
    for (let i = 1; i < 4; i++) {
      const ring = solid(
        g,
        new THREE.TorusGeometry(0.55 + i * 0.3, 0.035, 8, 32),
        gold,
        1.2,
        2.55,
        0,
        false,
      );
      ring.rotation.y = Math.PI / 2;
    }
  } else if (kind === "flooding") {
    for (let i = 0; i < 4; i++) {
      const wave = box(
        g,
        2.6,
        0.12,
        0.45,
        0x268cad,
        1.3,
        0.28 + i * 0.12,
        -1 + i * 0.5,
      );
      wave.rotation.y = -0.1 + Math.sin(t * 2 + i) * 0.04;
    }
    box(g, 1.6, 1.5, 1.3, 0x6b7a82, 1.5, 0.9, -0.3);
    const roof = solid(
      g,
      new THREE.ConeGeometry(1.25, 0.7, 4),
      0xa05d4d,
      1.5,
      1.95,
      -0.3,
    );
    roof.rotation.y = Math.PI / 4;
  } else if (kind === "contamination") {
    const sign = solid(
      g,
      new THREE.CylinderGeometry(0, 1.3, 2.2, 3),
      gold,
      1.3,
      1.7,
      0,
    );
    sign.rotation.z = Math.PI;
    box(g, 0.13, 0.9, 0.15, ink, 1.3, 1.65, 0.5);
    sphere(g, 0.09, ink, 1.3, 1.05, 0.55);
  } else if (kind === "economic") {
    for (let i = 0; i < 4; i++)
      box(
        g,
        0.48,
        0.5 + i * 0.55,
        0.55,
        0x738e99,
        0.2 + i * 0.62,
        (0.5 + i * 0.55) / 2,
        0,
      );
    for (let i = 0; i < 3; i++)
      beam(
        g,
        new THREE.Vector3(0.25 + i * 0.6, 2.6 - i * 0.5, 0.4),
        new THREE.Vector3(0.8 + i * 0.6, 2.1 - i * 0.5, 0.4),
        0.055,
        0xff6859,
      );
  } else if (kind === "government") {
    box(g, 2.6, 1.5, 1.1, 0x8997a0, 1.2, 0.85, 0);
    for (let i = 0; i < 4; i++)
      cylinder(g, 0.1, 0.1, 1.3, 0xe8e1ce, 0.35 + i * 0.55, 1, 0.61);
    const roof = solid(
      g,
      new THREE.ConeGeometry(1.8, 0.6, 4),
      0xddd6bf,
      1.2,
      1.95,
      0,
    );
    roof.rotation.y = Math.PI / 4;
  } else if (kind === "aftershock") {
    buildings(g, t, true);
  } else {
    solid(g, new THREE.OctahedronGeometry(0.8), gold, 1.3, 1.3, 0);
  }
}
function response(g: THREE.Group, data: Data, progress: number) {
  base(g);
  const pts = (data.places || []).filter(
    (p) => Number.isFinite(p.lat) && Number.isFinite(p.lon),
  );
  if (!pts.length) return;
  const minLat = Math.min(...pts.map((p) => p.lat)),
    maxLat = Math.max(...pts.map((p) => p.lat));
  const minLon = Math.min(...pts.map((p) => p.lon)),
    maxLon = Math.max(...pts.map((p) => p.lon));
  const pos = (p: Place) => [
    -2.7 + ((p.lon - minLon) / Math.max(0.01, maxLon - minLon)) * 5.4,
    1.8 - ((p.lat - minLat) / Math.max(0.01, maxLat - minLat)) * 3.6,
  ];
  for (const p of pts) {
    const [x, z] = pos(p);
    cylinder(g, 0.34, 0.39, 0.24, 0x587369, x, 0.18, z);
    sphere(g, 0.075, 0xf4e9cc, x, 0.38, z);
  }
  (data.aid || []).forEach((p, i, a) => {
    if (progress > ((i + 1) / (a.length + 1)) * 0.6) {
      const [x, z] = pos(p);
      box(g, 0.32, 0.18, 0.32, cyan, x, 0.55, z);
      box(g, 0.08, 0.2, 0.1, 0xffffff, x, 0.67, z);
    }
  });
  (data.recovery || []).forEach((p, i, a) => {
    if (progress > 0.55 + (i / Math.max(a.length, 1)) * 0.3) {
      const [x, z] = pos(p);
      const glow = sphere(g, 0.2, gold, x, 0.55, z);
      (glow.material as THREE.MeshStandardMaterial).emissive.setHex(0x995500);
    }
  });
}
export function createScene(shot: Shot3D, t: number, progress: number) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x101b2a);
  scene.fog = new THREE.Fog(0x101b2a, 14, 35);
  scene.add(new THREE.HemisphereLight(0xc3dfed, 0x1f1c2b, 2));
  const key = new THREE.DirectionalLight(0xffe2b5, 2.2);
  key.position.set(-5, 9, 9);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x509fc5, 1.5);
  rim.position.set(4, 4, -7);
  scene.add(rim);
  const g = new THREE.Group();
  scene.add(g);
  if (shot.kind === "hook") hook(g, shot.data, t);
  else if (shot.kind === "vignette") vignette(g, shot.data, t);
  else if (shot.kind === "map") response(g, shot.data, progress);
  else base(g);
  return scene;
}
export function createCamera(t: number, kind: string, vignette?: string) {
  const camera = new THREE.PerspectiveCamera(38, 1080 / 1920, 0.1, 100);
  const arc = Math.sin(t * 0.32) * 1.35;
  if (kind === "hook") {
    // Start overhead and descend toward the street as the event unfolds.
    const descent = Math.min(1, t / 5);
    const shake = Math.sin(t * 18) * 0.07 * Math.max(0, 1 - t / 3);
    camera.position.set(8 + arc + shake, 13 - descent * 6, 16 - descent * 2);
    camera.lookAt(0, 0.6 + descent * 0.5, 0);
  } else if (
    kind === "map" ||
    vignette === "evacuation" ||
    vignette === "flooding"
  ) {
    // Aerial pass for crowds, flooding and the response map.
    camera.position.set(5 + arc, 13, 10 + Math.cos(t * 0.25));
    camera.lookAt(0, 0, 0);
  } else if (kind === "vignette") {
    // Street-level tracking moves across the scene and toward the action.
    camera.position.set(
      4.5 + arc,
      3.3 + Math.sin(t * 0.4) * 0.35,
      10.8 - Math.min(t * 0.1, 0.8),
    );
    camera.lookAt(0, 1.0, 0);
  } else {
    camera.position.set(7 + arc, 7.5, 14);
    camera.lookAt(0, 0.8, 0);
  }
  return camera;
}
