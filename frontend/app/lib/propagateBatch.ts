import * as satellite from "satellite.js";
import { inEarthShadow, sunEci } from "./passes";

/** globe.gl's globe radius in scene units, and the Earth radius it maps to. */
export const GLOBE_RADIUS = 100;
export const EARTH_RADIUS_KM = 6371;

/** Below this a satellite has re-entered; SGP4 keeps "propagating" decayed TLEs into the ground. */
const MIN_PLAUSIBLE_ALTITUDE_KM = 80;
/** Slack above the TLE's own apogee: SGP4 perturbations and drag terms move a real satellite tens of km, not this far. */
const APOGEE_MARGIN_KM = 500;
const APOGEE_MARGIN_FRACTION = 0.1;
const MU_KM3_S2 = 398600.4418; // Earth's gravitational parameter
const SGP4_EARTH_RADIUS_KM = 6378.137;

/**
 * Whether a propagated altitude can be a real satellite. SGP4 doesn't always flag broken or long-stale TLEs as
 * errors; it can return positions underground or far beyond the orbit the TLE describes (up to ~10¹⁴ km), which
 * would draw stray dots and skew clustering. A real satellite never climbs much above its TLE's apogee.
 */
export function isPlausibleAltitude(altitudeKm: number, satrec: satellite.SatRec): boolean {
  if (!(altitudeKm >= MIN_PLAUSIBLE_ALTITUDE_KM)) return false; // also rejects NaN
  const meanMotionRadS = satrec.no / 60; // no is radians per minute
  const semiMajorKm = Math.cbrt(MU_KM3_S2 / (meanMotionRadS * meanMotionRadS));
  const apogeeKm = semiMajorKm * (1 + satrec.ecco) - SGP4_EARTH_RADIUS_KM;
  return altitudeKm <= apogeeKm * (1 + APOGEE_MARGIN_FRACTION) + APOGEE_MARGIN_KM;
}

/**
 * Positions of many satellites at one moment, in two packed arrays (one entry per satellite, in order):
 *   geo: [lat°, lng°, altitude km]
 *   xyz: the same point in globe scene coordinates (identical to globe.gl's getCoords)
 *   shadow: 1 if the satellite is in Earth's shadow (not sunlit), else 0
 * NaN where SGP4 fails (e.g. long-decayed TLEs). Shared by the propagation worker and the main-thread fallback.
 */
export function propagateBatch(
  satrecs: (satellite.SatRec | null)[],
  atMs: number
): { geo: Float32Array; xyz: Float32Array; shadow: Uint8Array } {
  const date = new Date(atMs);
  const gmst = satellite.gstime(date);
  const sun = sunEci(atMs);
  const geo = new Float32Array(satrecs.length * 3);
  const xyz = new Float32Array(satrecs.length * 3);
  const shadow = new Uint8Array(satrecs.length);
  for (let i = 0; i < satrecs.length; i++) {
    const k = i * 3;
    const rec = satrecs[i];
    const pv = rec ? satellite.propagate(rec, date) : null;
    const position = pv && pv.position && typeof pv.position !== "boolean" ? pv.position : null;
    const g = position ? satellite.eciToGeodetic(position, gmst) : null;
    if (!rec || !position || !g || !isPlausibleAltitude(g.height, rec)) {
      geo[k] = geo[k + 1] = geo[k + 2] = NaN;
      xyz[k] = xyz[k + 1] = xyz[k + 2] = NaN;
      continue;
    }
    shadow[i] = inEarthShadow(position, sun) ? 1 : 0;
    const lat = satellite.degreesLat(g.latitude);
    const lng = satellite.degreesLong(g.longitude);
    geo[k] = lat;
    geo[k + 1] = lng;
    geo[k + 2] = g.height;
    polarToGlobe(lat, lng, g.height, xyz, k);
  }
  return { geo, xyz, shadow };
}

/** three-globe's polar2Cartesian, writing into out[k..k+2]. */
export function polarToGlobe(lat: number, lng: number, altitudeKm: number, out: Float32Array, k: number) {
  const phi = ((90 - lat) * Math.PI) / 180;
  const theta = ((90 - lng) * Math.PI) / 180;
  const r = GLOBE_RADIUS * (1 + Math.max(0, altitudeKm) / EARTH_RADIUS_KM);
  const phiSin = Math.sin(phi);
  out[k] = r * phiSin * Math.cos(theta);
  out[k + 1] = r * Math.cos(phi);
  out[k + 2] = r * phiSin * Math.sin(theta);
}

export type TleLines = { line1: string; line2: string };

export function toSatrecs(tles: TleLines[]): (satellite.SatRec | null)[] {
  return tles.map((t) => {
    try {
      return satellite.twoline2satrec(t.line1, t.line2);
    } catch {
      return null;
    }
  });
}
