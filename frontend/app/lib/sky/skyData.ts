/**
 * The star catalogue and the 88 constellations, built by scripts/build-sky-data.mjs into public/sky/ from the
 * d3-celestial data (BSD-3-Clause). Loaded once per page and shared by every view.
 * Coordinates are J2000 right ascension / declination in degrees (RA 0–360).
 */

export type Constellation = {
  /** IAU abbreviation, e.g. "Ori". */
  id: string;
  name: string;
  /** Genitive used in star names: "Orionis" (as in α Orionis). */
  genitive: string;
  /** 1 = prominent, 3 = faint (d3-celestial's label ranking). */
  rank: number;
  /** Where its label goes [ra, dec]. */
  center: [number, number];
  /** Stick figure: polylines of [ra, dec]. */
  lines: [number, number][][];
  /** IAU boundary rings of [ra, dec] (Serpens has two). */
  bounds: [number, number][][];
};

/** Stars in parallel arrays (index = star). */
export type StarCatalog = {
  count: number;
  ra: Float32Array;
  dec: Float32Array;
  mag: Float32Array;
  /** B−V colour index: negative = blue-white, ~0.6 = Sun-like, 1.5+ = orange-red. */
  bv: Float32Array;
  hip: Int32Array;
  /** Proper name ("Betelgeuse"), or "". */
  name: string[];
  /** Bayer letter or Flamsteed number ("α", "61"), or "". */
  designation: string[];
  /** Index into constellations. */
  constellation: Uint8Array;
};

export type SkyData = {
  stars: StarCatalog;
  constellations: Constellation[];
  constellationIndex: Map<string, number>;
  /** Which constellation each grid cell is in (see constellationAt). */
  grid: Uint8Array;
  gridCellDeg: number;
};

type RawSky = {
  gridCellDeg: number;
  stars: [number, number, number, number, number, string, string][];
  constellations: Constellation[];
};

let loading: Promise<SkyData> | null = null;

export function loadSkyData(): Promise<SkyData> {
  loading ??= (async () => {
    const [raw, gridBuffer] = await Promise.all([
      fetch("/sky/sky.json").then((r) => {
        if (!r.ok) throw new Error(`Star data: ${r.status}`);
        return r.json() as Promise<RawSky>;
      }),
      fetch("/sky/grid.bin").then((r) => {
        if (!r.ok) throw new Error(`Constellation grid: ${r.status}`);
        return r.arrayBuffer();
      }),
    ]);
    const grid = new Uint8Array(gridBuffer);
    const n = raw.stars.length;
    const stars: StarCatalog = {
      count: n,
      ra: new Float32Array(n),
      dec: new Float32Array(n),
      mag: new Float32Array(n),
      bv: new Float32Array(n),
      hip: new Int32Array(n),
      name: new Array(n),
      designation: new Array(n),
      constellation: new Uint8Array(n),
    };
    const data: SkyData = {
      stars,
      constellations: raw.constellations,
      constellationIndex: new Map(raw.constellations.map((c, i) => [c.id, i])),
      grid,
      gridCellDeg: raw.gridCellDeg,
    };
    raw.stars.forEach(([ra, dec, mag, bv, hip, name, designation], i) => {
      stars.ra[i] = ra;
      stars.dec[i] = dec;
      stars.mag[i] = mag;
      stars.bv[i] = bv;
      stars.hip[i] = hip;
      stars.name[i] = name;
      stars.designation[i] = designation;
      stars.constellation[i] = constellationAt(data, ra, dec) ?? 0;
    });
    return data;
  })();
  // A failed load (e.g. offline) can be retried later.
  loading.catch(() => {
    loading = null;
  });
  return loading;
}

/** Index of the constellation containing this J2000 RA/Dec (degrees), or null outside the grid. */
export function constellationAt(data: Pick<SkyData, "grid" | "gridCellDeg">, raDeg: number, decDeg: number): number | null {
  const cell = data.gridCellDeg;
  const cols = Math.round(360 / cell);
  const rows = Math.round(180 / cell);
  const ra = ((raDeg % 360) + 360) % 360;
  const col = Math.min(cols - 1, Math.floor(ra / cell));
  const row = Math.min(rows - 1, Math.max(0, Math.floor((90 - decDeg) / cell)));
  const v = data.grid[row * cols + col];
  return v ? v - 1 : null;
}

/**
 * The middle of a constellation's stick figure [ra, dec] (its boundary if it has no figure): better than the label
 * point for "how high is it?", since labels are often placed off to one side.
 */
export function figureCenter(c: Constellation): [number, number] {
  let x = 0;
  let y = 0;
  let z = 0;
  for (const [ra, dec] of (c.lines.length > 0 ? c.lines : c.bounds).flat()) {
    const r = (ra * Math.PI) / 180;
    const d = (dec * Math.PI) / 180;
    x += Math.cos(d) * Math.cos(r);
    y += Math.cos(d) * Math.sin(r);
    z += Math.sin(d);
  }
  const ra = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  return [ra, (Math.atan2(z, Math.hypot(x, y)) * 180) / Math.PI];
}

/** "Betelgeuse", else "α Orionis", else "HIP 27989". */
export function starLabel(data: SkyData, i: number): string {
  const s = data.stars;
  if (s.name[i]) return s.name[i];
  if (s.designation[i]) return `${s.designation[i]} ${data.constellations[s.constellation[i]]?.genitive ?? ""}`.trim();
  return `HIP ${s.hip[i]}`;
}

/** A constellation's brightest stars (star indices), brightest first. */
export function brightestStars(data: SkyData, constellationIndex: number, count = 5): number[] {
  const s = data.stars;
  const members: number[] = [];
  for (let i = 0; i < s.count; i++) if (s.constellation[i] === constellationIndex) members.push(i);
  return members.sort((a, b) => s.mag[a] - s.mag[b]).slice(0, count);
}
