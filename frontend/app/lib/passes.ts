import * as satellite from "satellite.js";

/**
 * "When can I see it?": predicts when a satellite passes over an observer, and whether it will be
 * visible to the eye (sunlit while the observer's sky is dark).
 */

export type Observer = { latDeg: number; lngDeg: number; heightKm?: number };

export type PassVisibility = "visible" | "daylight" | "eclipsed";

export type Pass = {
  rise: Date;
  set: Date;
  maxAt: Date;
  maxElevationDeg: number;
  riseAzimuthDeg: number;
  setAzimuthDeg: number;
  visibility: PassVisibility;
};

export type PassPrediction =
  | { kind: "passes"; passes: Pass[] }
  /** Geosynchronous satellites don't rise and set; they hang at one spot in the sky (or never appear). */
  | { kind: "stationary"; elevationDeg: number; azimuthDeg: number };

const DEG = Math.PI / 180;
const EARTH_RADIUS_KM = 6378.137;
const AU_KM = 149_597_870.7;
/** Sun below this is dark enough to see satellites (end of civil twilight). */
const DARK_SKY_SUN_ELEVATION_DEG = -6;
/** Passes that never get higher than this are hard to see over trees and buildings. */
const DEFAULT_MIN_PEAK_DEG = 10;

export function predictPasses(
  satrec: satellite.SatRec,
  observer: Observer,
  fromMs: number,
  { days = 3, maxPasses = 5, minPeakDeg = DEFAULT_MIN_PEAK_DEG } = {}
): PassPrediction {
  const gd = toObserverGd(observer);
  const periodMin = (2 * Math.PI) / satrec.no;

  if (periodMin > 600) {
    const look = lookAngles(satrec, gd, fromMs);
    return { kind: "stationary", elevationDeg: look ? look.elevation / DEG : -90, azimuthDeg: look ? look.azimuth / DEG : 0 };
  }

  const elevationAt = (ms: number) => lookAngles(satrec, gd, ms)?.elevation ?? -Math.PI / 2;
  // Low orbits cross the sky in a few minutes, so sample often enough not to miss a pass.
  const stepMs = Math.min(60_000, (periodMin * 60_000) / 30);
  const endMs = fromMs + days * 86_400_000;
  const passes: Pass[] = [];

  let prevMs = fromMs;
  let prevEl = elevationAt(fromMs);
  let riseMs: number | null = prevEl >= 0 ? fromMs : null; // already up: the current pass counts from now

  for (let t = fromMs + stepMs; t <= endMs && passes.length < maxPasses; t += stepMs) {
    const el = elevationAt(t);
    if (riseMs === null && prevEl < 0 && el >= 0) {
      riseMs = crossing(elevationAt, prevMs, t);
    } else if (riseMs !== null && prevEl >= 0 && el < 0) {
      const setMs = crossing(elevationAt, prevMs, t);
      const pass = describePass(satrec, gd, riseMs, setMs, elevationAt);
      if (pass.maxElevationDeg >= minPeakDeg) passes.push(pass);
      riseMs = null;
    }
    prevMs = t;
    prevEl = el;
  }
  return { kind: "passes", passes };
}

/** Bisect for the moment elevation crosses 0° between a (one side) and b (other side). */
function crossing(elevationAt: (ms: number) => number, a: number, b: number): number {
  const aUp = elevationAt(a) >= 0;
  for (let i = 0; i < 12; i++) {
    const mid = (a + b) / 2;
    if (elevationAt(mid) >= 0 === aUp) a = mid;
    else b = mid;
  }
  return (a + b) / 2;
}

function describePass(
  satrec: satellite.SatRec,
  gd: satellite.GeodeticLocation,
  riseMs: number,
  setMs: number,
  elevationAt: (ms: number) => number
): Pass {
  // Peak: coarse scan then golden-section refine.
  const samples = 40;
  let bestMs = riseMs;
  let bestEl = -Infinity;
  for (let i = 0; i <= samples; i++) {
    const t = riseMs + ((setMs - riseMs) * i) / samples;
    const el = elevationAt(t);
    if (el > bestEl) {
      bestEl = el;
      bestMs = t;
    }
  }
  const span = (setMs - riseMs) / samples;
  let lo = Math.max(riseMs, bestMs - span);
  let hi = Math.min(setMs, bestMs + span);
  for (let i = 0; i < 20; i++) {
    const m1 = lo + (hi - lo) * 0.382;
    const m2 = lo + (hi - lo) * 0.618;
    if (elevationAt(m1) < elevationAt(m2)) lo = m1;
    else hi = m2;
  }
  const maxMs = (lo + hi) / 2;

  return {
    rise: new Date(riseMs),
    set: new Date(setMs),
    maxAt: new Date(maxMs),
    maxElevationDeg: elevationAt(maxMs) / DEG,
    riseAzimuthDeg: (lookAngles(satrec, gd, riseMs)?.azimuth ?? 0) / DEG,
    setAzimuthDeg: (lookAngles(satrec, gd, setMs)?.azimuth ?? 0) / DEG,
    visibility: passVisibility(satrec, gd, riseMs, setMs),
  };
}

/** Visible if at any point the satellite is sunlit while the observer's sky is dark. */
function passVisibility(satrec: satellite.SatRec, gd: satellite.GeodeticLocation, riseMs: number, setMs: number): PassVisibility {
  let anyDark = false;
  const steps = Math.max(4, Math.ceil((setMs - riseMs) / 30_000));
  for (let i = 0; i <= steps; i++) {
    const ms = riseMs + ((setMs - riseMs) * i) / steps;
    const date = new Date(ms);
    const sun = sunEci(ms);
    const sunLook = satellite.ecfToLookAngles(gd, satellite.eciToEcf(sun, satellite.gstime(date)));
    const dark = sunLook.elevation / DEG < DARK_SKY_SUN_ELEVATION_DEG;
    if (!dark) continue;
    anyDark = true;
    const pos = positionEci(satrec, date);
    if (pos && !inEarthShadow(pos, sun)) return "visible";
  }
  return anyDark ? "eclipsed" : "daylight";
}

function lookAngles(satrec: satellite.SatRec, gd: satellite.GeodeticLocation, ms: number) {
  const date = new Date(ms);
  const pos = positionEci(satrec, date);
  if (!pos) return null;
  return satellite.ecfToLookAngles(gd, satellite.eciToEcf(pos, satellite.gstime(date)));
}

function positionEci(satrec: satellite.SatRec, date: Date): satellite.EciVec3<number> | null {
  const pv = satellite.propagate(satrec, date);
  if (!pv || !pv.position || typeof pv.position === "boolean") return null;
  return pv.position;
}

function toObserverGd(o: Observer): satellite.GeodeticLocation {
  return { latitude: o.latDeg * DEG, longitude: o.lngDeg * DEG, height: o.heightKm ?? 0 };
}

/**
 * Sun position in Earth-centred inertial coordinates (km), low-precision formula from the
 * Astronomical Almanac — good to about 0.01°, far more than needed for day/night decisions.
 */
export function sunEci(ms: number): satellite.EciVec3<number> {
  const jd = ms / 86_400_000 + 2440587.5;
  const T = (jd - 2451545.0) / 36525;
  const L = 280.46 + 36000.771 * T;
  const M = (357.5291092 + 35999.05034 * T) * DEG;
  const lambda = (L + 1.914666471 * Math.sin(M) + 0.019994643 * Math.sin(2 * M)) * DEG;
  const eps = (23.439291 - 0.0130042 * T) * DEG;
  const r = (1.000140612 - 0.016708617 * Math.cos(M) - 0.000139589 * Math.cos(2 * M)) * AU_KM;
  return {
    x: r * Math.cos(lambda),
    y: r * Math.cos(eps) * Math.sin(lambda),
    z: r * Math.sin(eps) * Math.sin(lambda),
  };
}

/** Cylindrical shadow model: behind the Earth (relative to the Sun) and within one Earth radius of the Sun–Earth line. */
export function inEarthShadow(sat: satellite.EciVec3<number>, sun: satellite.EciVec3<number>): boolean {
  const sunDist = Math.hypot(sun.x, sun.y, sun.z);
  const sx = sun.x / sunDist;
  const sy = sun.y / sunDist;
  const sz = sun.z / sunDist;
  const along = sat.x * sx + sat.y * sy + sat.z * sz;
  if (along > 0) return false;
  const px = sat.x - along * sx;
  const py = sat.y - along * sy;
  const pz = sat.z - along * sz;
  return Math.hypot(px, py, pz) < EARTH_RADIUS_KM;
}

const COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];

export function compassPoint(azimuthDeg: number): string {
  const normalized = ((azimuthDeg % 360) + 360) % 360;
  return COMPASS[Math.round(normalized / 22.5) % 16];
}
