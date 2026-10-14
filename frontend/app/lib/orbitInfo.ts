import * as satellite from "satellite.js";
import { isPlausibleAltitude } from "./propagateBatch";

/** Orbit facts derived from a satellite's TLE. These only change when the TLE is refreshed. */
export type OrbitInfo = {
  noradId: string;
  inclinationDeg: number;
  periodMin: number;
  revsPerDay: number;
  eccentricity: number;
  perigeeKm: number;
  apogeeKm: number;
  orbitClass: string;
  /** International designator, e.g. "2019-029K" (launch year, launch number of that year, piece). */
  launchDesignator: string | null;
  launchYear: number | null;
  tleEpoch: Date;
};

/** Where the satellite is right now. */
export type LiveState = {
  lat: number;
  lng: number;
  altitudeKm: number;
  speedKmS: number;
};

const EARTH_RADIUS_KM = 6378.137; // WGS-84 equatorial radius, matching SGP4
const MU_KM3_S2 = 398600.4418; // Earth's gravitational parameter

export function getOrbitInfo(satrec: satellite.SatRec, line1?: string): OrbitInfo {
  const periodMin = (2 * Math.PI) / satrec.no; // no = mean motion in radians per minute
  const meanMotionRadS = satrec.no / 60;
  const semiMajorKm = Math.cbrt(MU_KM3_S2 / (meanMotionRadS * meanMotionRadS));
  const perigeeKm = semiMajorKm * (1 - satrec.ecco) - EARTH_RADIUS_KM;
  const apogeeKm = semiMajorKm * (1 + satrec.ecco) - EARTH_RADIUS_KM;
  const launch = parseLaunch(line1);

  return {
    noradId: String(satrec.satnum).trim(),
    inclinationDeg: (satrec.inclo * 180) / Math.PI,
    periodMin,
    revsPerDay: 1440 / periodMin,
    eccentricity: satrec.ecco,
    perigeeKm,
    apogeeKm,
    orbitClass: classifyOrbit(periodMin, satrec.ecco, apogeeKm),
    launchDesignator: launch?.designator ?? null,
    launchYear: launch?.year ?? null,
    tleEpoch: new Date((satrec.jdsatepoch - 2440587.5) * 86_400_000),
  };
}

export function getLiveState(satrec: satellite.SatRec, date: Date): LiveState | null {
  const pv = satellite.propagate(satrec, date);
  if (!pv || !pv.position || typeof pv.position === "boolean" || !pv.velocity || typeof pv.velocity === "boolean") {
    return null;
  }
  const geo = satellite.eciToGeodetic(pv.position, satellite.gstime(date));
  if (!isPlausibleAltitude(geo.height, satrec)) return null;
  const v = pv.velocity;
  return {
    lat: satellite.degreesLat(geo.latitude),
    lng: satellite.degreesLong(geo.longitude),
    altitudeKm: geo.height,
    speedKmS: Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z),
  };
}

function classifyOrbit(periodMin: number, eccentricity: number, apogeeKm: number): string {
  if (Math.abs(periodMin - 1436) < 30 && eccentricity < 0.05) return "Geosynchronous (GEO)";
  if (eccentricity > 0.25) return "Highly elliptical (HEO)";
  if (apogeeKm < 2000) return "Low Earth orbit (LEO)";
  if (apogeeKm < 35_000) return "Medium Earth orbit (MEO)";
  return "High Earth orbit";
}

/**
 * TLE line 1, columns 10–17: 2-digit launch year, launch number of that year, piece letters.
 * designator is the full international designator ("2019-029K"); launch drops the piece ("2019-029").
 */
export function parseLaunch(line1?: string): { designator: string; launch: string; year: number } | null {
  if (!line1 || line1.length < 17) return null;
  const yy = Number.parseInt(line1.slice(9, 11), 10);
  const number = line1.slice(11, 14).trim();
  const piece = line1.slice(14, 17).trim();
  if (Number.isNaN(yy) || !number) return null;
  const year = yy < 57 ? 2000 + yy : 1900 + yy; // the catalog starts with Sputnik in 1957
  return { designator: `${year}-${number}${piece}`, launch: `${year}-${number}`, year };
}
