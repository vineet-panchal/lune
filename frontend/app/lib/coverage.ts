import * as satellite from "satellite.js";
import { footprintAngle } from "./coverageLayer";
import { inEarthShadow, sunEci, type Observer } from "./passes";
import { isPlausibleAltitude } from "./propagateBatch";

/** "What's above me right now?" and "where on Earth sees the most satellites?" for the loaded satellites. */

export type SkySatellite = { satelliteId: number; name: string; elevationDeg: number; azimuthDeg: number; sunlit: boolean };

export type SkyView = {
  aboveHorizon: number;
  above10: number;
  above30: number;
  /** Sunlit satellites above 10° while the observer's sky is dark: the ones you could actually see. */
  visibleToEye: number;
  /** Sun's elevation at the observer (°): below −6 it's dark enough to see satellites. */
  sunElevationDeg: number;
  /** Highest satellites first. */
  highest: SkySatellite[];
};

type Sat = { satelliteId: number; name: string; satrec: satellite.SatRec };

const DEG = Math.PI / 180;
const DARK_SKY_SUN_ELEVATION_DEG = -6;
const VISIBLE_MIN_ELEVATION_DEG = 10;
const HIGHEST_LISTED = 12;

export function skyView(observer: Observer, sats: Sat[], atMs: number): SkyView {
  const date = new Date(atMs);
  const gmst = satellite.gstime(date);
  const gd = { latitude: observer.latDeg * DEG, longitude: observer.lngDeg * DEG, height: observer.heightKm ?? 0 };
  const sun = sunEci(atMs);
  const sunElevationDeg = satellite.ecfToLookAngles(gd, satellite.eciToEcf(sun, gmst)).elevation / DEG;
  const dark = sunElevationDeg < DARK_SKY_SUN_ELEVATION_DEG;

  const up: SkySatellite[] = [];
  let above10 = 0;
  let above30 = 0;
  let visibleToEye = 0;
  for (const s of sats) {
    const pv = satellite.propagate(s.satrec, date);
    if (!pv || !pv.position || typeof pv.position === "boolean") continue;
    if (!isPlausibleAltitude(satellite.eciToGeodetic(pv.position, gmst).height, s.satrec)) continue;
    const look = satellite.ecfToLookAngles(gd, satellite.eciToEcf(pv.position, gmst));
    const elevationDeg = look.elevation / DEG;
    if (elevationDeg < 0) continue;
    const sunlit = !inEarthShadow(pv.position, sun);
    if (elevationDeg >= 10) above10++;
    if (elevationDeg >= 30) above30++;
    if (dark && sunlit && elevationDeg >= VISIBLE_MIN_ELEVATION_DEG) visibleToEye++;
    up.push({ satelliteId: s.satelliteId, name: s.name, elevationDeg, azimuthDeg: look.azimuth / DEG, sunlit });
  }
  up.sort((a, b) => b.elevationDeg - a.elevationDeg);
  return { aboveHorizon: up.length, above10, above30, visibleToEye, sunElevationDeg, highest: up.slice(0, HIGHEST_LISTED) };
}

/** Number of satellites visible above minElevationDeg from each cell of a lat/lng grid. */
export type CoverageGrid = {
  cellDeg: number;
  rows: number; // latitude, north (row 0 = +90°) to south
  cols: number; // longitude, west (col 0 = −180°) to east
  counts: Uint16Array;
  max: number;
};

/**
 * Coverage map: for every satellite, the cells inside its footprint (the area that sees it at or above
 * minElevationDeg) get +1. Works per latitude row on the sphere, so it's ~100 cells per satellite, not the whole grid.
 */
export function coverageGrid(positions: { lat: number; lng: number; altKm: number }[], minElevationDeg: number, cellDeg = 2): CoverageGrid {
  const rows = Math.round(180 / cellDeg);
  const cols = Math.round(360 / cellDeg);
  const counts = new Uint16Array(rows * cols);
  for (const p of positions) {
    const radius = footprintAngle(p.altKm, minElevationDeg);
    if (!(radius > 0)) continue;
    const lat0 = p.lat * DEG;
    const cosR = Math.cos(radius);
    const rowStart = Math.max(0, Math.floor((90 - (p.lat + radius / DEG)) / cellDeg));
    const rowEnd = Math.min(rows - 1, Math.floor((90 - (p.lat - radius / DEG)) / cellDeg));
    for (let r = rowStart; r <= rowEnd; r++) {
      const lat = (90 - (r + 0.5) * cellDeg) * DEG;
      // Points on this latitude within the footprint: angular distance ≤ radius ⇔ |Δlng| ≤ halfWidth.
      const denom = Math.cos(lat) * Math.cos(lat0);
      if (denom <= 1e-9) continue;
      const c = (cosR - Math.sin(lat) * Math.sin(lat0)) / denom;
      if (c > 1) continue;
      const halfWidth = c <= -1 ? 180 : Math.acos(c) / DEG;
      const from = Math.floor((p.lng - halfWidth + 180) / cellDeg);
      const to = Math.floor((p.lng + halfWidth + 180) / cellDeg);
      if (to - from + 1 >= cols) {
        // The footprint wraps all the way round this latitude (near a pole): every cell once.
        for (let col = 0; col < cols; col++) counts[r * cols + col]++;
        continue;
      }
      for (let col = from; col <= to; col++) {
        const wrapped = ((col % cols) + cols) % cols;
        counts[r * cols + wrapped]++;
      }
    }
  }
  let max = 0;
  for (let i = 0; i < counts.length; i++) if (counts[i] > max) max = counts[i];
  return { cellDeg, rows, cols, counts, max };
}
