/**
 * Builds the Constellations page's sky data from the d3-celestial data files (BSD-3-Clause, Olaf Frohn):
 * https://github.com/ofrohn/d3-celestial/tree/master/data
 *
 * Usage: node scripts/build-sky-data.mjs <folder with stars.6.json, starnames.json, constellations.json,
 *        constellations.lines.json, constellations.bounds.json>
 *
 * Writes public/sky/:
 *   sky.json   stars (naked eye, mag ≤ 6), the 88 constellations with their stick figures and boundaries
 *   grid.bin   which constellation each 0.5° cell of the sky is in (RA 0→360° by column, Dec +90→−90° by row;
 *              byte = index into sky.json's constellations + 1, 0 = none), so "what constellation is the ISS in?"
 *              is a lookup instead of a point-in-polygon test on the sphere
 * All coordinates are J2000 RA / Dec in degrees, RA 0–360.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { geoArea, geoContains } from "d3-geo";

const input = process.argv[2];
if (!input) {
  console.error("Usage: node scripts/build-sky-data.mjs <d3-celestial data folder>");
  process.exit(1);
}
const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "sky");
const read = (name) => JSON.parse(readFileSync(join(input, name), "utf8"));

const GRID_CELL_DEG = 0.5;
const round = (v, d = 3) => Math.round(v * 10 ** d) / 10 ** d;
const ra360 = (lon) => round(((lon % 360) + 360) % 360);
const point = ([lon, lat]) => [ra360(lon), round(lat)];

const info = read("constellations.json").features;
const lines = new Map(read("constellations.lines.json").features.map((f) => [f.id, f]));
const boundsFeatures = read("constellations.bounds.json").features;

// Serpens comes in two halves (head and tail) with the same id: one constellation, two figures and boundaries.
const ids = [...new Set(info.map((f) => f.id))];
const constellations = ids.map((id) => {
  const parts = info.filter((f) => f.id === id);
  const p = parts[0].properties;
  const figure = lines.get(id)?.geometry.coordinates ?? [];
  const bounds = boundsFeatures.filter((f) => f.id === id).flatMap((f) => f.geometry.coordinates);
  return {
    id,
    name: p.name,
    genitive: p.gen,
    rank: Number(p.rank),
    // Label position: the first part's (Serpens Caput is the larger half).
    center: point(parts[0].geometry.coordinates),
    lines: figure.map((line) => line.map(point)),
    bounds: bounds.map((ring) => ring.map(point)),
  };
});
const indexById = new Map(constellations.map((c, i) => [c.id, i]));

// d3-geo decides inside/outside by winding; a ring wound the other way would contain the rest of the sky. Fix any
// boundary that covers more than half the sphere by reversing it.
for (const f of boundsFeatures) {
  if (geoArea(f) > 2 * Math.PI) f.geometry.coordinates = f.geometry.coordinates.map((ring) => [...ring].reverse());
}

const cols = Math.round(360 / GRID_CELL_DEG);
const rows = Math.round(180 / GRID_CELL_DEG);
const grid = new Uint8Array(rows * cols);
let unassigned = 0;
let overlaps = 0;
for (let r = 0; r < rows; r++) {
  const dec = 90 - (r + 0.5) * GRID_CELL_DEG;
  for (let c = 0; c < cols; c++) {
    const ra = (c + 0.5) * GRID_CELL_DEG;
    const lon = ra > 180 ? ra - 360 : ra;
    let found = 0;
    for (const f of boundsFeatures) {
      if (!geoContains(f, [lon, dec])) continue;
      if (found) overlaps++;
      found = indexById.get(f.id) + 1;
    }
    if (!found) unassigned++;
    grid[r * cols + c] = found;
  }
}

const names = read("starnames.json");
const stars = read("stars.6.json").features.map((f) => {
  const n = names[String(f.id)];
  const [ra, dec] = point(f.geometry.coordinates);
  const bv = Number.parseFloat(f.properties.bv);
  return [
    ra,
    dec,
    round(f.properties.mag, 2),
    Number.isFinite(bv) ? round(bv, 2) : 0.6, // colour unknown: roughly Sun-like
    f.id,
    n?.name || "",
    // Bayer letter (α Ori) or else Flamsteed number (61 Cyg), for stars without a proper name.
    n ? n.bayer || n.flam || "" : "",
  ];
});

mkdirSync(outDir, { recursive: true });
writeFileSync(
  join(outDir, "sky.json"),
  JSON.stringify({
    source: "d3-celestial (BSD-3-Clause, Olaf Frohn): https://github.com/ofrohn/d3-celestial",
    gridCellDeg: GRID_CELL_DEG,
    starFields: ["ra", "dec", "mag", "bv", "hip", "name", "designation"],
    stars,
    constellations,
  })
);
writeFileSync(join(outDir, "grid.bin"), grid);
writeFileSync(join(outDir, "LICENSE-d3-celestial.txt"), readFileSync(join(input, "LICENSE"), "utf8"));

const cellsPer = constellations.map((c, i) => [c.id, grid.reduce((n, v) => n + (v === i + 1 ? 1 : 0), 0)]);
cellsPer.sort((a, b) => b[1] - a[1]);
console.log(`${stars.length} stars, ${constellations.length} constellations`);
console.log(`grid ${cols}×${rows}: ${unassigned} cells unassigned, ${overlaps} overlapping`);
console.log("largest:", cellsPer.slice(0, 3), "smallest:", cellsPer.slice(-3));
