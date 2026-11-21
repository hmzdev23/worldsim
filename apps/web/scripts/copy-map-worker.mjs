import { copyFile, mkdir } from "node:fs/promises";

const source = new URL("../node_modules/maplibre-gl/dist/", import.meta.url);
const destination = new URL("../public/maplibre-worker/", import.meta.url);

await mkdir(destination, { recursive: true });
for (const filename of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) {
  await copyFile(new URL(filename, source), new URL(filename, destination));
}
