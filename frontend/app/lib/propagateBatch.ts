import * as satellite from "satellite.js";
import { inEarthShadow, sunEci } from "./passes";

/** globe.gl's globe radius in scene units, and the Earth radius it maps to. */
export const GLOBE_RADIUS = 100;
export const EARTH_RADIUS_KM = 6371;

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
    if (!pv || !pv.position || typeof pv.position === "boolean") {
      geo[k] = geo[k + 1] = geo[k + 2] = NaN;
      xyz[k] = xyz[k + 1] = xyz[k + 2] = NaN;
      continue;
    }
    shadow[i] = inEarthShadow(pv.position, sun) ? 1 : 0;
    const g = satellite.eciToGeodetic(pv.position, gmst);
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
