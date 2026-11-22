import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { Readable } from "node:stream";
import path from "node:path";
import { NextResponse } from "next/server";
import { recapFilmJobs } from "../../../../../lib/recap-film-jobs";
import { findProjectRoot } from "../../../../../lib/project-root";

export const runtime = "nodejs";

const root = findProjectRoot();
const runIdPattern = /^[a-zA-Z0-9_-]{1,100}$/;

export async function GET(request: Request, context: { params: Promise<{ runId: string }> }) {
  const { runId } = await context.params;
  const job = recapFilmJobs.get(runId);
  if (!runIdPattern.test(runId) || job?.status !== "ready") {
    return NextResponse.json({ message: "Recap film is not ready" }, { status: 404 });
  }
  const jobDir = path.join(root, ".cache", "recap-films", runId);
  const videoName = await readFile(path.join(jobDir, "video.txt"), "utf8").then((value) => value.trim()).catch(() => "");
  if (!/^[a-zA-Z0-9_-]+\.mp4$/.test(videoName)) return NextResponse.json({ message: "Recap film is missing" }, { status: 404 });
  const videoPath = path.join(jobDir, "output", videoName);
  try {
    const file = await stat(videoPath);
    const common = { "Content-Type": "video/mp4", "Cache-Control": "no-store", "Content-Disposition": `inline; filename="${videoName}"`, "Accept-Ranges": "bytes" };
    const range = request.headers.get("range");
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${file.size}` } });
      const start = match[1] ? Number(match[1]) : Math.max(0, file.size - Number(match[2]));
      const end = match[2] && match[1] ? Math.min(file.size - 1, Number(match[2])) : file.size - 1;
      if (!Number.isSafeInteger(start) || start < 0 || start > end || start >= file.size) {
        return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${file.size}` } });
      }
      const stream = Readable.toWeb(createReadStream(videoPath, { start, end })) as ReadableStream<Uint8Array>;
      return new Response(stream, { status: 206, headers: {
        ...common, "Content-Length": String(end - start + 1), "Content-Range": `bytes ${start}-${end}/${file.size}`,
      } });
    }
    const stream = Readable.toWeb(createReadStream(videoPath)) as ReadableStream<Uint8Array>;
    return new Response(stream, { headers: { ...common, "Content-Length": String(file.size) } });
  } catch {
    return NextResponse.json({ message: "Recap film is missing" }, { status: 404 });
  }
}
