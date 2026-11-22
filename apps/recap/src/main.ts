import * as THREE from "three";
import japan from "../samples/japan-earthquake.storyboard.json";
import iceland from "../samples/iceland-eruption.storyboard.json";

type Place = { lat: number; lon: number; place?: string; country?: string };
type Stat = { key: string; label: string; value: number; display: string };
type SceneData = {
  hazard?: string;
  vignette?: string;
  places?: Place[];
  aid?: Place[];
  recovery?: Place[];
  stats?: Stat[];
};
type Shot = {
  id: string;
  kind: string;
  min_duration_s: number;
  overlay: string;
  caption: string;
  sim_time_label: string;
  data: SceneData;
};
type Storyboard = {
  label: string;
  format: { width: number; height: number; fps: number };
  scenes: Shot[];
};
type Narration = { scenes: Record<string, { duration_s: number }> };
type Range = { id: string; start_frame: number; end_frame: number };
type Timeline = { fps: number; total_frames: number; scenes: Range[] };
declare global {
  interface Window {
    recap: {
      load: (story: Storyboard, narration?: Narration) => Promise<Timeline>;
      renderFrame: (frame: number) => Promise<void>;
    };
  }
}

const W = 1080,
  H = 1920;
const canvas = document.querySelector<HTMLCanvasElement>("#recap")!;
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  preserveDrawingBuffer: true,
  alpha: false,
});
renderer.setPixelRatio(1);
renderer.setSize(W, H, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
const camera = new THREE.OrthographicCamera(0, W, H, 0, 0.1, 100);
camera.position.z = 50;
let story: Storyboard | undefined, timeline: Timeline | undefined;
let preview = false;
const ink = "#10131b",
  cream = "#f8f3dc",
  amber = "#ffbb4d",
  red = "#f05b50",
  cyan = "#72d7d6";

// Scene coordinates use a top-left origin. Flat, black-backed shapes form the outlines.
function rect(
  g: THREE.Group,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
  z = 0,
  angle = 0,
) {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }),
  );
  m.position.set(x + w / 2, H - y - h / 2, z);
  m.rotation.z = -angle;
  g.add(m);
  return m;
}
function ellipse(
  g: THREE.Group,
  x: number,
  y: number,
  rx: number,
  ry: number,
  color: string,
  z = 0,
) {
  const m = new THREE.Mesh(
    new THREE.CircleGeometry(1, 40),
    new THREE.MeshBasicMaterial({ color }),
  );
  m.scale.set(rx, ry, 1);
  m.position.set(x, H - y, z);
  g.add(m);
  return m;
}
function polygon(g: THREE.Group, points: number[][], color: string, z = 0) {
  const s = new THREE.Shape();
  points.forEach(([x, y], i) => (i ? s.lineTo(x, H - y) : s.moveTo(x, H - y)));
  s.closePath();
  const m = new THREE.Mesh(
    new THREE.ShapeGeometry(s),
    new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }),
  );
  m.position.z = z;
  g.add(m);
  return m;
}
function line(
  g: THREE.Group,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  width: number,
  color: string,
  z = 0,
) {
  const dx = x2 - x1,
    dy = y2 - y1,
    len = Math.hypot(dx, dy);
  const m = rect(g, 0, 0, len, width, color, z);
  m.position.set((x1 + x2) / 2, H - (y1 + y2) / 2, z);
  m.rotation.z = -Math.atan2(dy, dx);
  return m;
}
function panel(
  g: THREE.Group,
  x: number,
  y: number,
  w: number,
  h: number,
  c: string,
  z = 1,
) {
  rect(g, x - 9, y - 9, w + 18, h + 18, ink, z);
  rect(g, x, y, w, h, c, z + 0.1);
}
function disk(
  g: THREE.Group,
  x: number,
  y: number,
  rx: number,
  ry: number,
  c: string,
  z = 1,
) {
  ellipse(g, x, y, rx + 9, ry + 9, ink, z);
  ellipse(g, x, y, rx, ry, c, z + 0.1);
}
function character(
  g: THREE.Group,
  x: number,
  y: number,
  scale: number,
  pose: string,
  t: number,
) {
  const c = new THREE.Group();
  g.add(c);
  const bob =
    pose === "walk"
      ? Math.sin(t * 7) * 10
      : pose === "shiver"
        ? Math.sin(t * 18) * 4
        : Math.sin(t * 2) * 3;
  // Local art is authored around the centre and transformed as a group.
  line(
    c,
    430,
    1270,
    405 + (pose === "walk" ? Math.sin(t * 7) * 25 : 0),
    1350,
    35,
    ink,
    3,
  );
  line(
    c,
    510,
    1270,
    540 - (pose === "walk" ? Math.sin(t * 7) * 25 : 0),
    1350,
    35,
    ink,
    3,
  );
  disk(c, 470, 1165, 110, 125, "#ad2638", 3);
  rect(c, 385, 1160, 170, 155, "#b82d40", 3.2);
  const raised = pose === "wave" || pose === "point";
  line(c, 390, 1140, 330, raised ? 1030 : 1230, 42, ink, 3);
  line(c, 390, 1140, 330, raised ? 1030 : 1230, 25, "#b82d40", 3.2);
  line(c, 550, 1140, 610, pose === "shrug" ? 1100 : 1230, 42, ink, 3);
  line(c, 550, 1140, 610, pose === "shrug" ? 1100 : 1230, 25, "#b82d40", 3.2);
  disk(c, 470, 1010, 104, 100, cream, 4);
  ellipse(c, 440, 1010, 8, 14, ink, 4.3);
  ellipse(c, 500, 1010, 8, 14, ink, 4.3);
  line(c, 464, 908, 455, 866, 10, ink, 4.4);
  line(c, 455, 866, 482, 845, 10, ink, 4.4);
  line(c, 450, 1100, 442, 1165, 7, ink, 4.4);
  line(c, 488, 1100, 496, 1165, 7, ink, 4.4);
  c.scale.set(scale, scale, 1);
  c.position.set(x - 470 * scale, H - y - (H - 1150) * scale + bob, 0);
}
function city(g: THREE.Group, t: number, quake: boolean, eruption: boolean) {
  rect(g, 0, 0, W, H, "#101a2b", 0);
  ellipse(g, 800, 630, 170, 170, eruption ? "#a94137" : "#29374c", 0.1);
  polygon(
    g,
    [
      [0, 1240],
      [160, 1120],
      [260, 1190],
      [400, 1070],
      [530, 1180],
      [700, 1050],
      [850, 1160],
      [1080, 1040],
      [1080, 1450],
      [0, 1450],
    ],
    "#24354a",
    0.2,
  );
  if (eruption) {
    polygon(
      g,
      [
        [530, 1170],
        [700, 885],
        [850, 1170],
      ],
      ink,
      0.3,
    );
    polygon(
      g,
      [
        [550, 1160],
        [700, 915],
        [830, 1160],
      ],
      "#753d39",
      0.4,
    );
    ellipse(g, 700, 910, 45 + 10 * Math.sin(t * 4), 36, red, 0.5);
    for (let i = 0; i < 5; i++)
      disk(
        g,
        680 + i * 35,
        820 - i * 55,
        45 + i * 6,
        35 + i * 3,
        "#59616b",
        0.5,
      );
  }
  for (let i = 0; i < 7; i++) {
    const h = 210 + (i % 3) * 80,
      x = i * 160 - 30;
    const sway = quake ? Math.sin(t * 15 + i) * 6 : 0;
    panel(g, x + sway, 1300 - h, 135, h, "#34445a", 1);
    for (let j = 0; j < 3; j++)
      for (let k = 0; k < 3; k++)
        rect(
          g,
          x + 18 + j * 36 + sway,
          1325 - h + k * 55,
          17,
          24,
          quake && t > 1.2 ? "#1c2839" : amber,
          1.3,
        );
  }
  rect(g, 0, 1305, W, 615, "#202b38", 1.5);
}
function vignette(g: THREE.Group, kind: string, t: number) {
  rect(g, 0, 0, W, H, "#1a2737");
  rect(g, 0, 1280, W, 640, "#35444b", 0.2);
  character(
    g,
    340,
    1130,
    1.25,
    kind === "evacuation"
      ? "walk"
      : kind === "water_out"
        ? "shrug"
        : kind === "aftershock"
          ? "shiver"
          : kind === "government"
            ? "point"
            : kind === "generic"
              ? "wave"
              : "look_up",
    t,
  );
  if (kind === "power_out") {
    panel(g, 650, 850, 230, 310, "#e7dcbc", 1);
    panel(g, 725, 950, 80, 100, "#54606a", 2);
    line(g, 762, 973, 770, 1023, 13, ink, 3);
  } else if (kind === "water_out") {
    panel(g, 640, 1000, 260, 70, "#93a8a8", 1);
    panel(g, 700, 920, 75, 130, "#93a8a8", 1);
    line(g, 790, 1010, 790, 1070, 30, ink, 2);
    ellipse(g, 790, 1120, 14, 22, cyan, 2);
  } else if (kind === "evacuation") {
    for (let i = 0; i < 3; i++)
      character(g, 620 + i * 130, 1190 + i * 30, 0.55, "walk", t + i);
  } else if (kind === "tsunami_siren") {
    panel(g, 750, 1050, 45, 250, "#89959b", 1);
    disk(g, 770, 1000, 95, 70, Math.sin(t * 8) > 0 ? red : amber, 2);
    for (let i = 0; i < 3; i++)
      line(g, 880, 920 + i * 45, 945, 880 + i * 45, 10, amber, 2);
  } else if (kind === "flooding") {
    polygon(
      g,
      [
        [0, 1240],
        [140, 1200],
        [280, 1240],
        [420, 1200],
        [560, 1240],
        [700, 1200],
        [840, 1240],
        [1080, 1200],
        [1080, 1920],
        [0, 1920],
      ],
      "#277b9b",
      3,
    );
  } else if (kind === "contamination") {
    polygon(
      g,
      [
        [670, 850],
        [900, 1240],
        [440, 1240],
      ],
      ink,
      1,
    );
    polygon(
      g,
      [
        [670, 885],
        [870, 1220],
        [470, 1220],
      ],
      amber,
      2,
    );
    line(g, 670, 990, 670, 1100, 22, ink, 3);
    disk(g, 670, 1150, 12, 12, ink, 3);
  } else if (kind === "economic") {
    panel(g, 610, 860, 300, 320, "#d5dfd6", 1);
    line(g, 650, 930, 860, 930, 8, ink, 2);
    line(g, 650, 990, 700, 1030, 15, red, 2);
    line(g, 700, 1030, 760, 1000, 15, red, 2);
    line(g, 760, 1000, 855, 1100, 15, red, 2);
  } else if (kind === "aftershock") {
    for (let i = 0; i < 3; i++)
      line(g, 660 + i * 55, 900, 620 + i * 55, 1200, 12, amber, 2);
  } else if (kind === "government") {
    panel(g, 600, 1010, 320, 200, "#758a99", 1);
    polygon(
      g,
      [
        [580, 1000],
        [760, 870],
        [940, 1000],
      ],
      cream,
      2,
    );
    for (let i = 0; i < 4; i++) rect(g, 630 + i * 75, 1030, 25, 150, cream, 2);
  } else {
    disk(g, 755, 1020, 105, 105, amber, 1);
    line(g, 755, 950, 755, 1040, 16, ink, 2);
    disk(g, 755, 1090, 10, 10, ink, 2);
  }
}
function explainer(g: THREE.Group, hazard: string, t: number) {
  rect(g, 0, 0, W, H, "#253747");
  rect(g, 0, 1100, W, 820, "#755449", 0.2);
  rect(g, 0, 1060, W, 50, "#8bb9bc", 0.3);
  if (hazard === "earthquake") {
    polygon(
      g,
      [
        [0, 1150],
        [560, 1150],
        [420, 1600],
        [0, 1600],
      ],
      "#bc8a69",
      1,
    );
    polygon(
      g,
      [
        [580, 1150],
        [1080, 1150],
        [1080, 1600],
        [440, 1600],
      ],
      "#9d735d",
      1,
    );
    line(g, 560, 1150, 420, 1600, 16, ink, 2);
    for (let i = 1; i <= 3; i++) {
      ellipse(
        g,
        500,
        1340,
        55 + i * 80 + ((t * 35) % 60),
        30 + i * 45 + ((t * 20) % 35),
        i % 2 ? amber : red,
        2 + i * 0.1,
      );
      ellipse(
        g,
        500,
        1340,
        45 + i * 80 + ((t * 35) % 60),
        22 + i * 45 + ((t * 20) % 35),
        "#a97c64",
        2.05 + i * 0.1,
      );
    }
    polygon(
      g,
      [
        [0, 1060],
        [250, 1060],
        [320, 1000],
        [390, 1060],
        [1080, 1060],
        [1080, 1100],
        [0, 1100],
      ],
      cyan,
      3,
    );
  } else {
    disk(g, 540, 1500, 180, 105, "#e4603d", 1);
    polygon(
      g,
      [
        [470, 1450],
        [505, 1110],
        [575, 1110],
        [610, 1450],
      ],
      "#e4603d",
      1,
    );
    polygon(
      g,
      [
        [310, 1100],
        [500, 900],
        [580, 900],
        [790, 1100],
      ],
      "#9b705d",
      1,
    );
    line(g, 540, 1060, 540, 900, 24, red, 2);
    for (let i = 0; i < 5; i++)
      disk(g, 505 + i * 37, 850 - i * 40, 45 + i * 7, 35 + i * 4, "#727b80", 2);
  }
}
function mapScene(g: THREE.Group, data: SceneData, progress: number) {
  rect(g, 0, 0, W, H, "#172b3b");
  const pts = (data.places || []).filter(
    (p) => Number.isFinite(p.lat) && Number.isFinite(p.lon),
  );
  if (!pts.length) return;
  const minLat = Math.min(...pts.map((p) => p.lat)),
    maxLat = Math.max(...pts.map((p) => p.lat)),
    minLon = Math.min(...pts.map((p) => p.lon)),
    maxLon = Math.max(...pts.map((p) => p.lon));
  const project = (p: Place) => [
    190 + ((p.lon - minLon) / Math.max(0.01, maxLon - minLon)) * 700,
    1320 - ((p.lat - minLat) / Math.max(0.01, maxLat - minLat)) * 500,
  ];
  // An abstract footprint around reported coordinates, never a real border.
  for (const p of pts) {
    const [x, y] = project(p);
    disk(g, x, y, 65, 75, "#344c55", 1);
  }
  for (const p of pts) {
    const [x, y] = project(p);
    disk(g, x, y, 9, 9, cream, 2);
  }
  (data.aid || []).forEach((p, i, a) => {
    if (progress > ((i + 1) / (a.length + 2)) * 0.7) {
      const [x, y] = project(p);
      disk(g, x, y, 24, 24, cyan, 3);
      line(g, x - 11, y, x + 11, y, 6, ink, 4);
      line(g, x, y - 11, x, y + 11, 6, ink, 4);
    }
  });
  (data.recovery || []).forEach((p, i, a) => {
    if (progress > 0.55 + (i / (a.length || 1)) * 0.3) {
      const [x, y] = project(p);
      disk(g, x, y, 17, 17, amber, 4);
    }
  });
}
function textWrap(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  max: number,
  lineHeight: number,
  maxLines = 5,
) {
  const words = text.split(/\s+/);
  let lineText = "",
    row = 0;
  for (const word of words) {
    const test = lineText ? lineText + " " + word : word;
    if (ctx.measureText(test).width > max && lineText) {
      ctx.fillText(lineText, x, y + row * lineHeight);
      row++;
      lineText = word;
    } else lineText = test;
  }
  if (lineText && row < maxLines)
    ctx.fillText(lineText, x, y + row * lineHeight);
}
function formatted(s: Stat, progress: number) {
  const n = progress >= 1 ? s.value : Math.floor(s.value * progress);
  const prefix = s.display.startsWith("$") ? "$" : "";
  const unit = s.display.includes("km²")
    ? " km²"
    : s.display.includes("tonnes")
      ? " tonnes"
      : "";
  return (
    prefix + n.toLocaleString("en-US", { maximumFractionDigits: 20 }) + unit
  );
}
function hud(shot: Shot, label: string, progress: number) {
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d")!;
  ctx.textBaseline = "top";
  ctx.fillStyle = "#0b101dcc";
  ctx.fillRect(42, 48, 410, 55);
  ctx.font = "bold 25px Arial, sans-serif";
  ctx.fillStyle = amber;
  ctx.fillText(label, 60, 61);
  ctx.textAlign = "right";
  ctx.fillStyle = "#d3dedc";
  ctx.font = "bold 24px Arial, sans-serif";
  ctx.fillText(shot.sim_time_label, 1020, 64);
  ctx.textAlign = "left";
  ctx.fillStyle = "#0b101ddd";
  ctx.fillRect(42, 150, 996, 270);
  ctx.shadowColor = "#ffb245";
  ctx.shadowBlur = 18;
  ctx.fillStyle = cream;
  ctx.font = "900 62px Arial, sans-serif";
  textWrap(ctx, shot.overlay, 75, 180, 930, 72, 3);
  ctx.shadowBlur = 0;
  if (shot.kind === "explainer") {
    ctx.fillStyle = amber;
    ctx.font = "bold 30px Arial, sans-serif";
    ctx.fillText("ILLUSTRATION · NOT TO SCALE", 72, 495);
    ctx.font = "bold 28px Arial, sans-serif";
    ctx.fillStyle = cream;
    if (shot.data.hazard === "earthquake") {
      ctx.fillText("P-WAVES", 100, 950);
      ctx.fillText("S-WAVES", 680, 950);
      ctx.fillText("FAULT", 400, 1520);
      ctx.fillText("TSUNAMI", 720, 1010);
    } else {
      ctx.fillText("ASH PLUME", 650, 720);
      ctx.fillText("FISSURE", 620, 980);
      ctx.fillText("MAGMA CHAMBER", 355, 1630);
    }
  }
  if (shot.kind === "map") {
    ctx.font = "bold 24px Arial, sans-serif";
    ctx.fillStyle = cream;
    ctx.fillText("REPORTED PLACES · ABSTRACT FOOTPRINT", 85, 505);
    ctx.fillStyle = cyan;
    ctx.fillText("✚ AID", 85, 1510);
    ctx.fillStyle = amber;
    ctx.fillText("● RECOVERY", 270, 1510);
  }
  if (shot.kind === "stats_card") {
    const stats = shot.data.stats || [];
    const top = 490,
      bottom = 1570,
      row = Math.min(92, (bottom - top) / Math.max(1, stats.length));
    ctx.font = "bold 26px Arial, sans-serif";
    ctx.fillStyle = amber;
    ctx.fillText("FINAL REPORTED VALUES", 76, 445);
    stats.forEach((s, i) => {
      const y = top + i * row;
      ctx.fillStyle = i % 2 ? "#1a2d3b" : "#243b48";
      ctx.fillRect(65, y, 950, row - 5);
      ctx.fillStyle = "#dbe4de";
      ctx.font = `bold ${row < 65 ? 24 : 28}px Arial, sans-serif`;
      ctx.fillText(s.label, 85, y + row * 0.25);
      ctx.textAlign = "right";
      ctx.fillStyle = cream;
      ctx.font = `bold ${row < 65 ? 27 : 34}px Arial, sans-serif`;
      ctx.fillText(formatted(s, progress), 995, y + row * 0.21);
      ctx.textAlign = "left";
    });
  }
  ctx.fillStyle = "#0b101de8";
  ctx.fillRect(42, 1645, 996, 180);
  ctx.fillStyle = cream;
  ctx.font = "bold 34px Arial, sans-serif";
  textWrap(ctx, shot.caption, 75, 1680, 930, 44, 3);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
function dispose(g: THREE.Object3D) {
  g.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.dispose();
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (m instanceof THREE.MeshBasicMaterial) m.map?.dispose();
        m.dispose();
      }
    }
  });
}
async function load(
  input: Storyboard,
  narration?: Narration,
): Promise<Timeline> {
  if (
    !input ||
    input.format.width !== W ||
    input.format.height !== H ||
    !Number.isFinite(input.format.fps) ||
    input.format.fps <= 0 ||
    !input.scenes.length
  )
    throw new Error("Invalid recap storyboard format or empty scenes");
  // Frame ranges are half-open: start_frame is included, end_frame is excluded.
  let cursor = 0;
  const ranges = input.scenes.map((s) => {
    const duration = Math.max(
      s.min_duration_s,
      narration?.scenes?.[s.id]?.duration_s || 0,
    );
    if (!Number.isFinite(duration) || duration <= 0)
      throw new Error(`Invalid duration: ${s.id}`);
    const start_frame = cursor;
    cursor += Math.ceil(duration * input.format.fps);
    return { id: s.id, start_frame, end_frame: cursor };
  });
  story = input;
  timeline = { fps: input.format.fps, total_frames: cursor, scenes: ranges };
  preview = false;
  return timeline;
}
async function renderFrame(n: number): Promise<void> {
  if (!story || !timeline) throw new Error("Load a storyboard first");
  if (!Number.isInteger(n) || n < 0 || n >= timeline.total_frames)
    throw new RangeError("Frame outside storyboard");
  const index = timeline.scenes.findIndex(
    (s) => n >= s.start_frame && n < s.end_frame,
  );
  const shot = story.scenes[index],
    range = timeline.scenes[index];
  const t = (n - range.start_frame) / timeline.fps;
  const progress = Math.min(
    1,
    (n - range.start_frame) /
      Math.max(1, (range.end_frame - range.start_frame - 1) * 0.8),
  );
  const world = new THREE.Scene(),
    g = new THREE.Group();
  world.add(g);
  if (shot.kind === "hook") {
    city(
      g,
      t,
      shot.data.hazard === "earthquake",
      shot.data.hazard === "volcanic_eruption",
    );
    character(g, 510, 1230, 1.25, "look_up", t);
    if (shot.data.hazard === "earthquake")
      g.position.x = Math.sin(t * 24) * 8 * Math.max(0, 1 - t / 3);
  } else if (shot.kind === "vignette")
    vignette(g, shot.data.vignette || "generic", t);
  else if (shot.kind === "explainer") explainer(g, shot.data.hazard || "", t);
  else if (shot.kind === "map") mapScene(g, shot.data, progress);
  else if (shot.kind === "stats_card") rect(g, 0, 0, W, H, "#101e2a");
  const tex = hud(shot, story.label, progress);
  const overlay = new THREE.Mesh(
    new THREE.PlaneGeometry(W, H),
    new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      depthTest: false,
    }),
  );
  overlay.position.set(W / 2, H / 2, 30);
  overlay.renderOrder = 10;
  world.add(overlay);
  renderer.render(world, camera);
  dispose(world);
}
window.recap = { load, renderFrame };
const sample = new URLSearchParams(location.search).get("sample") || "japan";
if (sample === "japan" || sample === "iceland") {
  const data = (sample === "japan" ? japan : iceland) as Storyboard;
  void load(data).then(async (result) => {
    preview = true;
    await renderFrame(0);
    let start: number | undefined,
      last = -1;
    const tick = (stamp: number) => {
      if (!preview) return;
      start ??= stamp;
      const frame = Math.min(
        result.total_frames - 1,
        Math.floor(((stamp - start) * result.fps) / 1000),
      );
      if (frame !== last) {
        last = frame;
        void renderFrame(frame);
      }
      if (frame < result.total_frames - 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}
