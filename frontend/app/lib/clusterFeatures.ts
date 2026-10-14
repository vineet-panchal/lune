import type * as satellite from "satellite.js";

/**
 * What the clustering models see for each satellite.
 *  - "position": where it is right now (Earth-centred x, y, z in km). Groups by place; changes within minutes.
 *  - "elements": the shape and orientation of its orbit from the TLE. Groups by orbit (shells, planes), and
 *    stays valid for hours.
 */
export type FeatureSet = "position" | "elements";

export type OrbitalElement = "altitude" | "inclination" | "plane" | "eccentricity";

export const ORBITAL_ELEMENTS: { id: OrbitalElement; label: string; detail: string }[] = [
  { id: "altitude", label: "Altitude", detail: "mean height above Earth (km)" },
  { id: "inclination", label: "Inclination", detail: "tilt from the equator (°)" },
  { id: "plane", label: "Orbital plane", detail: "RAAN: which way the orbit faces" },
  { id: "eccentricity", label: "Eccentricity", detail: "how elongated the orbit is" },
];

export const DEFAULT_ELEMENTS: OrbitalElement[] = ["altitude", "inclination", "plane"];

/** How long a run's labels describe the satellites: positions move within minutes, orbital planes ~1°/6 h in LEO. */
export const STALE_AFTER_MS: Record<FeatureSet, number> = {
  position: 5 * 60_000,
  elements: 6 * 3600_000,
};

export type FeatureSelection = { set: "position" } | { set: "elements"; elements: OrbitalElement[] };

const MU_KM3_S2 = 398600.4418; // Earth's gravitational parameter
const SGP4_EARTH_RADIUS_KM = 6378.137;
const RAD_TO_DEG = 180 / Math.PI;
const JD_UNIX_EPOCH = 2440587.5;

/** Column names in the order featureVector returns them (RAAN is two columns: see featureVector). */
export function featureNames(selection: FeatureSelection): string[] {
  if (selection.set === "position") return ["x_km", "y_km", "z_km"];
  return ORBITAL_ELEMENTS.filter((e) => selection.elements.includes(e.id)).flatMap((e) => {
    switch (e.id) {
      case "altitude":
        return ["mean_altitude_km"];
      case "inclination":
        return ["inclination_deg"];
      case "plane":
        return ["raan_sin", "raan_cos"];
      case "eccentricity":
        return ["eccentricity"];
    }
  });
}

/**
 * The features for one satellite at atMs, in featureNames order.
 * xyzKm is its Earth-centred position at atMs (only used for "position").
 */
export function featureVector(
  selection: FeatureSelection,
  satrec: satellite.SatRec,
  xyzKm: { x: number; y: number; z: number },
  atMs: number
): number[] {
  if (selection.set === "position") return [xyzKm.x, xyzKm.y, xyzKm.z];
  const out: number[] = [];
  for (const { id } of ORBITAL_ELEMENTS) {
    if (!selection.elements.includes(id)) continue;
    switch (id) {
      case "altitude":
        out.push(meanAltitudeKm(satrec));
        break;
      case "inclination":
        out.push(satrec.inclo * RAD_TO_DEG);
        break;
      case "plane": {
        // RAAN wraps at 360°, so 359° and 1° are neighbours: encode it as a point on a circle.
        const raan = raanAt(satrec, atMs);
        out.push(Math.sin(raan), Math.cos(raan));
        break;
      }
      case "eccentricity":
        out.push(satrec.ecco);
        break;
    }
  }
  return out;
}

/** Semi-major axis from the mean motion, minus Earth's radius. */
function meanAltitudeKm(satrec: satellite.SatRec): number {
  const meanMotionRadS = satrec.no / 60; // no is radians per minute
  return Math.cbrt(MU_KM3_S2 / (meanMotionRadS * meanMotionRadS)) - SGP4_EARTH_RADIUS_KM;
}

/**
 * RAAN (radians) carried from the TLE epoch to atMs. Earth's bulge turns LEO planes by several degrees a day,
 * and every TLE has its own epoch, so comparing raw TLE values would split one plane into many.
 */
function raanAt(satrec: satellite.SatRec, atMs: number): number {
  const minutesSinceEpoch = (atMs / 86_400_000 + JD_UNIX_EPOCH - satrec.jdsatepoch) * 1440;
  return satrec.nodeo + satrec.nodedot * minutesSinceEpoch;
}
