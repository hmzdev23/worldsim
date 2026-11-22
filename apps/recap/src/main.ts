import * as THREE from "three";
import japan from "../samples/japan-earthquake.storyboard.json";
import iceland from "../samples/iceland-eruption.storyboard.json";
import { createScene, createCamera } from "./three-scenes";

type Place = { lat: number; lon: number };
type Stat = { key: string; label: string; value: number; display: string };
type Shot = {
  id: string;
  kind: string;
  min_duration_s: number;
  overlay: string;
  caption: string;
  sim_time_label: string;
  data: {
    hazard?: string;
    vignette?: string;
    places?: Place[];
    aid?: Place[];
    recovery?: Place[];
    stats?: Stat[];
  };
};
type Storyboard = {
  label: string;
  format: { width: number; height: number; fps: number };
  scenes: Shot[];
};
type Narration = { scenes: Record<string, { duration_s: number }> };
type Timeline = {
  fps: number;
  total_frames: number;
  scenes: { id: string; start_frame: number; end_frame: number }[];
};
declare global {
  interface Window {
    recap: {
      load: (story: Storyboard, narration?: Narration) => Promise<Timeline>;
      renderFrame: (frame: number) => Promise<void>;
    };
  }
}
const W = 1080,
  H = 1920,
  cream = "#f8f3dc",
  amber = "#ffbb4d",
  cyan = "#72d7d6";
const renderer = new THREE.WebGLRenderer({
  canvas: document.querySelector<HTMLCanvasElement>("#recap")!,
  antialias: true,
  preserveDrawingBuffer: true,
});
renderer.setPixelRatio(1);
renderer.setSize(W, H, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.autoClear = false;
const overlayCamera = new THREE.OrthographicCamera(0, W, H, 0, 0.1, 100);
overlayCamera.position.z = 50;
let story: Storyboard | undefined,
  timeline: Timeline | undefined,
  preview = false;
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
function displayText(text: string): string {
  return text.replace(/\bfictional\s+/gi, "").replace(/\bsimulated\s+/gi, "");
}
function hud(shot: Shot, progress: number) {
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d")!;
  ctx.textBaseline = "top";
  ctx.fillStyle = "#0b101dcc";
  ctx.fillRect(42, 48, 410, 55);
  ctx.font = "bold 25px Arial, sans-serif";
  ctx.fillStyle = amber;
  ctx.fillText("EVENT TIMELINE", 60, 61);
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
  textWrap(ctx, displayText(shot.overlay), 75, 180, 930, 72, 3);
  ctx.shadowBlur = 0;
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
  textWrap(ctx, displayText(shot.caption), 75, 1680, 930, 44, 3);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function dispose(g: THREE.Object3D) {
  g.traverse((o) => {
    if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) {
      o.geometry.dispose();
      const materials = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of materials) {
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
  // Legacy storyboards include a science explainer out of chronological order.
  // A recap is an event timeline, so exclude it until the storyboard producer removes it.
  const scenes = input.scenes.filter((s) => s.kind !== "explainer");
  if (!scenes.length) throw new Error("Storyboard has no timeline scenes");
  let cursor = 0;
  const ranges = scenes.map((s) => {
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
  story = { ...input, scenes };
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
    range = timeline.scenes[index],
    t = (n - range.start_frame) / timeline.fps;
  const progress = Math.min(
    1,
    (n - range.start_frame) /
      Math.max(1, (range.end_frame - range.start_frame - 1) * 0.8),
  );
  const world = createScene(shot, t, progress);
  const camera = createCamera(t, shot.kind, shot.data.vignette);
  renderer.clear();
  renderer.render(world, camera);
  renderer.clearDepth();
  const overlayScene = new THREE.Scene();
  const texture = hud(shot, progress);
  const overlay = new THREE.Mesh(
    new THREE.PlaneGeometry(W, H),
    new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
    }),
  );
  overlay.position.set(W / 2, H / 2, 30);
  overlayScene.add(overlay);
  renderer.render(overlayScene, overlayCamera);
  dispose(world);
  dispose(overlayScene);
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
