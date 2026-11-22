import { spawn } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { recapFilmJobs, type RecapFilmJob } from "../../../../lib/recap-film-jobs";
import { findProjectRoot } from "../../../../lib/project-root";

export const runtime = "nodejs";
export const maxDuration = 900;

const root = findProjectRoot();
const runIdPattern = /^[a-zA-Z0-9_-]{1,100}$/;
const tonePattern = /^(straight|satirical)$/;

function response(runId: string, job: RecapFilmJob) {
  return NextResponse.json({ runId, ...job });
}

function validRunId(runId: string) {
  return runIdPattern.test(runId);
}

export async function GET(_request: Request, context: { params: Promise<{ runId: string }> }) {
  const { runId } = await context.params;
  if (!validRunId(runId)) return NextResponse.json({ message: "Invalid run id" }, { status: 400 });
  return response(runId, recapFilmJobs.get(runId) ?? { status: "failed", stage: "unavailable", message: "No recap job is available for this run." });
}

export async function POST(request: Request, context: { params: Promise<{ runId: string }> }) {
  const { runId } = await context.params;
  if (!validRunId(runId)) return NextResponse.json({ message: "Invalid run id" }, { status: 400 });
  const existing = recapFilmJobs.get(runId);
  if (existing && existing.status !== "failed") return response(runId, existing);

  let tone = "straight";
  try {
    const body = await request.json() as { tone?: string };
    if (body.tone && tonePattern.test(body.tone)) tone = body.tone;
  } catch { /* Tone is optional; the default recap is satirical. */ }

  const jobsRoot = path.join(root, ".cache", "recap-films");
  await mkdir(jobsRoot, { recursive: true });
  recapFilmJobs.set(runId, { status: "queued", stage: "queued" });
  const child = spawn(process.env.PYTHON_EXECUTABLE ?? "python3", [
    path.join(root, "scripts", "recap-film-job.py"), runId, tone,
  ], { cwd: root, env: process.env, stdio: ["ignore", "pipe", "pipe"] });

  recapFilmJobs.set(runId, { status: "generating", stage: "starting" });
  child.stdout.on("data", (chunk: Buffer) => {
    for (const line of chunk.toString().split(/\r?\n/)) {
      if (!line.startsWith("STAGE:")) continue;
      const stage = line.slice("STAGE:".length).trim();
      recapFilmJobs.set(runId, { status: stage === "ready" ? "ready" : "generating", stage,
        ...(stage === "ready" ? { videoUrl: `/api/recap-films/${encodeURIComponent(runId)}/video` } : {}) });
    }
  });
  child.stderr.on("data", (chunk: Buffer) => console.error(`[recap-film ${runId}] ${chunk.toString().trim()}`));
  child.on("error", (error) => {
    console.error(`[recap-film ${runId}] failed to start`, error);
    recapFilmJobs.set(runId, { status: "failed", stage: "failed", message: "The recap film could not start. Check the local renderer setup." });
  });
  child.on("close", async (code) => {
    const current = recapFilmJobs.get(runId);
    if (code !== 0 || current?.status !== "ready") {
      recapFilmJobs.set(runId, { status: "failed", stage: "failed", message: "The recap film could not be rendered. Check the local renderer setup and server logs." });
      return;
    }
    const jobDir = path.join(jobsRoot, runId);
    try {
      const videoName = (await readFile(path.join(jobDir, "video.txt"), "utf8")).trim();
      if (!/^[a-zA-Z0-9_-]+\.mp4$/.test(videoName)) throw new Error("Unexpected video filename");
      recapFilmJobs.set(runId, { status: "ready", stage: "ready", videoUrl: `/api/recap-films/${encodeURIComponent(runId)}/video` });
    } catch (error) {
      console.error(`[recap-film ${runId}] missing output`, error);
      recapFilmJobs.set(runId, { status: "failed", stage: "failed", message: "The recap film finished without a playable video." });
    }
  });

  return response(runId, recapFilmJobs.get(runId)!);
}
