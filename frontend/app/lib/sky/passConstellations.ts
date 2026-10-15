import * as satellite from "satellite.js";
import type { Observer } from "../passes";
import { constellationAt, type SkyData } from "./skyData";
import { horizontalToEquatorial, localSiderealRad } from "./skyMath";

const DEG = Math.PI / 180;
const STEP_MS = 10_000;
/** Low in the sky a satellite is hard to see and the stars behind it are lost in haze. */
const MIN_ALTITUDE_DEG = 10;

/**
 * The constellations a satellite moves through during a pass, in order, as the observer sees it against the stars:
 * "where do I look?" for a pass prediction.
 */
export function constellationsAlongPass(
  data: SkyData,
  satrec: satellite.SatRec,
  observer: Observer,
  riseMs: number,
  setMs: number
): string[] {
  const gd = { latitude: observer.latDeg * DEG, longitude: observer.lngDeg * DEG, height: observer.heightKm ?? 0 };
  const names: string[] = [];
  for (let ms = riseMs; ms <= setMs; ms += STEP_MS) {
    const date = new Date(ms);
    const pv = satellite.propagate(satrec, date);
    if (!pv || !pv.position || typeof pv.position === "boolean") continue;
    const look = satellite.ecfToLookAngles(gd, satellite.eciToEcf(pv.position, satellite.gstime(date)));
    const altDeg = look.elevation / DEG;
    if (altDeg < MIN_ALTITUDE_DEG) continue;
    const eq = horizontalToEquatorial(altDeg, look.azimuth / DEG, observer.latDeg, localSiderealRad(ms, observer.lngDeg));
    const index = constellationAt(data, eq.raDeg, eq.decDeg);
    const name = index === null ? null : data.constellations[index].name;
    if (name && names[names.length - 1] !== name) names.push(name);
  }
  return names;
}
