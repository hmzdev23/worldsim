import { existsSync } from "node:fs";
import path from "node:path";

export function findProjectRoot(start = process.cwd()) {
  let candidate = path.resolve(start);
  for (let depth = 0; depth < 5; depth += 1) {
    if (existsSync(path.join(candidate, "scripts", "recap-film-job.py"))) return candidate;
    const parent = path.dirname(candidate);
    if (parent === candidate) break;
    candidate = parent;
  }
  throw new Error("Could not locate the WorldSim repository root.");
}
