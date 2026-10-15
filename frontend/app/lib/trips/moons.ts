import * as Astronomy from "astronomy-engine";
import { AU_KM, DAY_S, planet, type PlanetId, type State } from "./bodies";
import { propagate } from "./kepler";
import { add, scale, type Vec3 } from "./vec";

/**
 * The major moons Trips can fly to, and where they are around their planet. Positions are planet-centred J2000
 * equatorial (EQJ) km and km/s, like the rest of the trajectory maths:
 *  - our Moon and Jupiter's four big moons from astronomy-engine (its lunar theory and Lieske's E5 series);
 *  - the others from JPL Horizons via the backend, as osculating elements every 2 days, each propagated as a
 *    Kepler orbit to the moment asked and blended with its neighbour (good to roughly 100 km).
 */
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

export type MoonId = "Moon" | "Phobos" | "Deimos" | "Io" | "Europa" | "Ganymede" | "Callisto" | "Enceladus" | "Titan" | "Titania" | "Triton" | "Charon";

export type MoonBody = {
  id: MoonId;
  planet: PlanetId;
  /** Gravitational parameter, km³/s². */
  mu: number;
  radiusKm: number;
  /** Mean distance from the planet's centre, km. */
  smaKm: number;
  periodDays: number;
  color: string;
  /** A low circular orbit to arrive into (km above the surface), or null for moons too small to orbit: the trip ends matching speed with it. */
  lowOrbitAltKm: number | null;
  source: "astronomy-engine" | "horizons";
};

export const MOONS: MoonBody[] = [
  { id: "Moon", planet: "Earth", mu: 4_902.8, radiusKm: 1_737.4, smaKm: 384_400, periodDays: 27.3217, color: "#b8b4ac", lowOrbitAltKm: 100, source: "astronomy-engine" },
  { id: "Phobos", planet: "Mars", mu: 7.087e-4, radiusKm: 11.1, smaKm: 9_376, periodDays: 0.31891, color: "#9a8a7a", lowOrbitAltKm: null, source: "horizons" },
  { id: "Deimos", planet: "Mars", mu: 9.615e-5, radiusKm: 6.2, smaKm: 23_463, periodDays: 1.26244, color: "#b09f8c", lowOrbitAltKm: null, source: "horizons" },
  { id: "Io", planet: "Jupiter", mu: 5_959.9, radiusKm: 1_821.6, smaKm: 421_700, periodDays: 1.769138, color: "#e8d36a", lowOrbitAltKm: 100, source: "astronomy-engine" },
  { id: "Europa", planet: "Jupiter", mu: 3_202.7, radiusKm: 1_560.8, smaKm: 671_034, periodDays: 3.551181, color: "#cdb89a", lowOrbitAltKm: 100, source: "astronomy-engine" },
  { id: "Ganymede", planet: "Jupiter", mu: 9_887.8, radiusKm: 2_634.1, smaKm: 1_070_412, periodDays: 7.154553, color: "#9c8f80", lowOrbitAltKm: 200, source: "astronomy-engine" },
  { id: "Callisto", planet: "Jupiter", mu: 7_179.3, radiusKm: 2_410.3, smaKm: 1_882_709, periodDays: 16.689018, color: "#7d7262", lowOrbitAltKm: 200, source: "astronomy-engine" },
  { id: "Enceladus", planet: "Saturn", mu: 7.211, radiusKm: 252.1, smaKm: 237_948, periodDays: 1.370218, color: "#eef3f6", lowOrbitAltKm: 100, source: "horizons" },
  { id: "Titan", planet: "Saturn", mu: 8_978.1, radiusKm: 2_574.7, smaKm: 1_221_870, periodDays: 15.945, color: "#d9a95b", lowOrbitAltKm: 1_500, source: "horizons" },
  { id: "Titania", planet: "Uranus", mu: 228.2, radiusKm: 788.9, smaKm: 435_910, periodDays: 8.706234, color: "#b7a99a", lowOrbitAltKm: 100, source: "horizons" },
  { id: "Triton", planet: "Neptune", mu: 1_427.6, radiusKm: 1_353.4, smaKm: 354_759, periodDays: 5.876854, color: "#d9c7c3", lowOrbitAltKm: 100, source: "horizons" },
  { id: "Charon", planet: "Pluto", mu: 105.9, radiusKm: 606, smaKm: 19_591, periodDays: 6.387221, color: "#a59c95", lowOrbitAltKm: 50, source: "horizons" },
];

export const MOON_BY_ID = new Map(MOONS.map((m) => [m.id, m]));

/** Where a trip can go: a planet, or a moon (reached through its planet's sphere of influence). */
export type Destination = PlanetId | MoonId;

export function moon(id: MoonId): MoonBody {
  return MOON_BY_ID.get(id)!;
}

export function moonsOf(planet: PlanetId): MoonBody[] {
  return MOONS.filter((m) => m.planet === planet);
}

export function isMoon(id: string): id is MoonId {
  return MOON_BY_ID.has(id as MoonId);
}

const KM_PER_S = AU_KM / DAY_S;
const fromAstro = (s: Astronomy.StateVector): State => ({ r: [s.x * AU_KM, s.y * AU_KM, s.z * AU_KM], v: [s.vx * KM_PER_S, s.vy * KM_PER_S, s.vz * KM_PER_S] });
const JUPITER_MOON_KEY = { Io: "io", Europa: "europa", Ganymede: "ganymede", Callisto: "callisto" } as const;

/** Planet-centred EQJ state (km, km/s), or null while a Horizons moon's orbit for that year is still loading. */
export function moonState(id: MoonId, ms: number): State | null {
  if (id === "Moon") return fromAstro(Astronomy.GeoMoonState(new Date(ms)));
  if (id === "Io" || id === "Europa" || id === "Ganymede" || id === "Callisto") return fromAstro(Astronomy.JupiterMoons(new Date(ms))[JUPITER_MOON_KEY[id]]);
  const el = yearElements(id, ms);
  return el ? elementsState(el, ms) : null;
}

/** Whether moonState can answer for every one of these moments yet (and asks for whatever is missing). */
export function moonReady(id: MoonId, times: number[]): boolean {
  if (moon(id).source !== "horizons") return true;
  let ready = true;
  for (const y of new Set(times.map(yearOf))) {
    if (!cache.get(key(id, y))?.data) {
      ready = false;
      void ensureMoonYear(id, y);
    }
  }
  return ready;
}

/** Why a Horizons moon's orbit isn't available for any of these moments, if loading it failed. */
export function moonError(id: MoonId, times: number[]): string | null {
  for (const y of new Set(times.map(yearOf))) {
    const error = cache.get(key(id, y))?.error;
    if (error) return error;
  }
  return null;
}

/** Points around one orbit of the moon near `ms` (planet-centred EQJ km), for drawing; null until loaded. */
export function moonOrbit(id: MoonId, ms: number, n = 160): Vec3[] | null {
  const m = moon(id);
  const now = moonState(id, ms);
  if (!now) return null;
  // Two-body orbit through the current state: the real orbit drifts a little over one revolution.
  const mu = m.mu + planet(m.planet).mu;
  const pts: Vec3[] = [];
  const period = m.periodDays * DAY_S;
  for (let i = 0; i < n; i++) pts.push(propagate(now.r, now.v, (i / n) * period, mu).r);
  return pts;
}

// ── Horizons moons: elements one UTC year at a time ──

export type MoonElements = { t: number[]; a: number[]; e: number[]; i: number[]; node: number[]; peri: number[]; ma: number[]; n: number[] };
type Entry = { data: MoonElements | null; error: string | null; promise: Promise<void> | null };
const cache = new Map<string, Entry>();
const listeners = new Set<() => void>();
const key = (id: MoonId, year: number) => `${id}:${year}`;
const yearOf = (ms: number) => new Date(ms).getUTCFullYear();
const POLL_MS = 3000;
const MAX_POLLS = 40;

/** Called whenever another year of some moon's orbit arrives. */
export function subscribeMoons(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function ensureMoonYear(id: MoonId, year: number): Promise<void> {
  const k = key(id, year);
  const existing = cache.get(k);
  // Loaded, loading, or failed (kept with its error so a broken backend isn't asked again every frame).
  if (existing) return existing.promise ?? Promise.resolve();
  const entry: Entry = { data: null, error: null, promise: null };
  cache.set(k, entry);
  entry.promise = (async () => {
    for (let poll = 0; poll < MAX_POLLS; poll++) {
      try {
        const res = await fetch(`${API_BASE}/api/trips/moons/${id}/elements?year=${year}`);
        if (!res.ok) throw new Error(`${res.status}`);
        const feed: { data: MoonElements | null; loading: boolean; error: string | null } = await res.json();
        if (feed.data && feed.data.t.length >= 2) {
          entry.data = feed.data;
          entry.error = null;
          break;
        }
        if (!feed.loading) throw new Error(feed.error ?? "no data");
      } catch (e) {
        entry.error = `Couldn't load ${id}'s orbit from JPL Horizons (${e instanceof Error ? e.message : String(e)}). Is the backend running?`;
        break;
      }
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
    entry.promise = null;
    listeners.forEach((l) => l());
  })();
  return entry.promise;
}

function yearElements(id: MoonId, ms: number): MoonElements | null {
  const y = yearOf(ms);
  const hit = cache.get(key(id, y))?.data;
  if (hit) return hit;
  void ensureMoonYear(id, y);
  return null;
}

const D2R = Math.PI / 180;

/** The two samples around ms, each propagated to ms, blended by how close each is. */
function elementsState(el: MoonElements, ms: number): State {
  const n = el.t.length;
  let i = 0;
  while (i < n - 2 && el.t[i + 1] <= ms) i++;
  const a = sampleState(el, i, ms);
  const b = sampleState(el, i + 1, ms);
  const w = Math.max(0, Math.min(1, (ms - el.t[i]) / (el.t[i + 1] - el.t[i])));
  return { r: add(scale(a.r, 1 - w), scale(b.r, w)), v: add(scale(a.v, 1 - w), scale(b.v, w)) };
}

function sampleState(el: MoonElements, k: number, ms: number): State {
  const a = el.a[k];
  const e = el.e[k];
  const nRad = el.n[k] * D2R;
  const M = el.ma[k] * D2R + nRad * ((ms - el.t[k]) / 1000);
  let E = e < 0.8 ? M : Math.PI;
  for (let it = 0; it < 30; it++) {
    const d = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    E -= d;
    if (Math.abs(d) < 1e-12) break;
  }
  const cosE = Math.cos(E);
  const sinE = Math.sin(E);
  const b = a * Math.sqrt(1 - e * e);
  const r = a * (1 - e * cosE);
  const mu = nRad * nRad * a * a * a;
  const px = a * (cosE - e);
  const py = b * sinE;
  const k2 = Math.sqrt(mu * a) / r;
  const vx = -k2 * sinE;
  const vy = k2 * Math.sqrt(1 - e * e) * cosE;
  // Perifocal → EQJ: rotate by the argument of periapsis, inclination and node.
  const [P, Q] = perifocalAxes(el.node[k] * D2R, el.i[k] * D2R, el.peri[k] * D2R);
  return { r: add(scale(P, px), scale(Q, py)), v: add(scale(P, vx), scale(Q, vy)) };
}

function perifocalAxes(node: number, inc: number, peri: number): [Vec3, Vec3] {
  const cO = Math.cos(node);
  const sO = Math.sin(node);
  const ci = Math.cos(inc);
  const si = Math.sin(inc);
  const cw = Math.cos(peri);
  const sw = Math.sin(peri);
  return [
    [cO * cw - sO * sw * ci, sO * cw + cO * sw * ci, sw * si],
    [-cO * sw - sO * cw * ci, -sO * sw + cO * cw * ci, cw * si],
  ];
}
