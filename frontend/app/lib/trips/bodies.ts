import * as Astronomy from "astronomy-engine";
import type { Vec3 } from "./vec";

/**
 * The planets Trips can fly between, their physical constants and where they are. Positions come from
 * astronomy-engine (VSOP87, good to well under an arcminute) as heliocentric J2000 equatorial (EQJ) vectors;
 * the trajectory maths works in EQJ km and km/s, and the scene shows the ecliptic (ECL) plane.
 */
export const AU_KM = 149_597_870.7;
export const DAY_S = 86_400;
export const DAY_MS = 86_400_000;
/** Sun's gravitational parameter, km³/s². */
export const MU_SUN = 1.32712440018e11;
const OBLIQUITY_RAD = (23.4392911 * Math.PI) / 180;
const SIN_E = Math.sin(OBLIQUITY_RAD);
const COS_E = Math.cos(OBLIQUITY_RAD);
/** The ecliptic's north pole in EQJ: "prograde" transfers go round it anticlockwise, like the planets. */
export const ECLIPTIC_NORTH_EQJ: Vec3 = [0, -SIN_E, COS_E];

export type PlanetId = "Mercury" | "Venus" | "Earth" | "Mars" | "Jupiter" | "Saturn" | "Uranus" | "Neptune" | "Pluto";

export type Planet = {
  id: PlanetId;
  body: Astronomy.Body;
  /** Gravitational parameter, km³/s². */
  mu: number;
  radiusKm: number;
  /** Mean distance from the Sun, AU. */
  smaAu: number;
  periodDays: number;
  color: string;
  /** A low orbit to depart from or arrive into (altitude above the equator, km). */
  lowOrbitAltKm: number;
  /** Whether the orbit around it is the end of the trip or a landing is possible (rocky). */
  rocky: boolean;
  /** The planet's rotation period in hours (negative: retrograde), for the spinning globe. */
  rotationHours: number;
  /** Axial tilt to its orbit, degrees. */
  tiltDeg: number;
};

const P = (p: Omit<Planet, "periodDays">): Planet => ({ ...p, periodDays: 365.256363 * Math.pow(p.smaAu, 1.5) });

export const PLANETS: Planet[] = [
  P({ id: "Mercury", body: Astronomy.Body.Mercury, mu: 22_031.8, radiusKm: 2_439.7, smaAu: 0.387098, color: "#a8a39d", lowOrbitAltKm: 200, rocky: true, rotationHours: 1407.6, tiltDeg: 0.03 }),
  P({ id: "Venus", body: Astronomy.Body.Venus, mu: 324_858.6, radiusKm: 6_051.8, smaAu: 0.723332, color: "#e3c58f", lowOrbitAltKm: 250, rocky: true, rotationHours: -5832.5, tiltDeg: 177.4 }),
  P({ id: "Earth", body: Astronomy.Body.Earth, mu: 398_600.4418, radiusKm: 6_378.137, smaAu: 1.0, color: "#4f8fe6", lowOrbitAltKm: 200, rocky: true, rotationHours: 23.934, tiltDeg: 23.44 }),
  P({ id: "Mars", body: Astronomy.Body.Mars, mu: 42_828.37, radiusKm: 3_396.2, smaAu: 1.523679, color: "#d0623c", lowOrbitAltKm: 250, rocky: true, rotationHours: 24.623, tiltDeg: 25.19 }),
  P({ id: "Jupiter", body: Astronomy.Body.Jupiter, mu: 126_686_534, radiusKm: 71_492, smaAu: 5.2026, color: "#d9b38c", lowOrbitAltKm: 5_000, rocky: false, rotationHours: 9.925, tiltDeg: 3.13 }),
  P({ id: "Saturn", body: Astronomy.Body.Saturn, mu: 37_931_187, radiusKm: 60_268, smaAu: 9.5549, color: "#e6d29a", lowOrbitAltKm: 8_000, rocky: false, rotationHours: 10.656, tiltDeg: 26.73 }),
  P({ id: "Uranus", body: Astronomy.Body.Uranus, mu: 5_793_939, radiusKm: 25_559, smaAu: 19.2184, color: "#9fd8e0", lowOrbitAltKm: 4_000, rocky: false, rotationHours: -17.24, tiltDeg: 97.77 }),
  P({ id: "Neptune", body: Astronomy.Body.Neptune, mu: 6_836_529, radiusKm: 24_764, smaAu: 30.11, color: "#5b7cf0", lowOrbitAltKm: 4_000, rocky: false, rotationHours: 16.11, tiltDeg: 28.32 }),
  P({ id: "Pluto", body: Astronomy.Body.Pluto, mu: 869.6, radiusKm: 1_188.3, smaAu: 39.482, color: "#c9b29b", lowOrbitAltKm: 100, rocky: true, rotationHours: -153.29, tiltDeg: 122.53 }),
];

export const PLANET_BY_ID = new Map(PLANETS.map((p) => [p.id, p]));

export function planet(id: PlanetId): Planet {
  return PLANET_BY_ID.get(id)!;
}

/** Sphere of influence radius (Laplace), km: inside it the planet's gravity dominates the Sun's. */
export function soiKm(p: Planet): number {
  return p.smaAu * AU_KM * Math.pow(p.mu / MU_SUN, 0.4);
}

export type State = { r: Vec3; v: Vec3 };

/** Heliocentric position (km) and velocity (km/s) in EQJ. */
export function helioState(id: PlanetId, ms: number): State {
  const s = Astronomy.HelioState(planet(id).body, new Date(ms));
  const kmPerS = AU_KM / DAY_S;
  return { r: [s.x * AU_KM, s.y * AU_KM, s.z * AU_KM], v: [s.vx * kmPerS, s.vy * kmPerS, s.vz * kmPerS] };
}

/** Heliocentric position in AU, ecliptic J2000 (what the scene and JPL's trajectories use). */
export function helioEclipticAu(id: PlanetId, ms: number): Vec3 {
  const v = Astronomy.HelioVector(planet(id).body, new Date(ms));
  return eqjToEcl([v.x, v.y, v.z]);
}

export function eqjToEcl(a: Vec3): Vec3 {
  return [a[0], COS_E * a[1] + SIN_E * a[2], -SIN_E * a[1] + COS_E * a[2]];
}

export function eclToEqj(a: Vec3): Vec3 {
  return [a[0], COS_E * a[1] - SIN_E * a[2], SIN_E * a[1] + COS_E * a[2]];
}

/** Ideal Hohmann transfer between circular, coplanar orbits at the two planets' mean distances. */
export function hohmann(from: PlanetId, to: PlanetId) {
  const r1 = planet(from).smaAu * AU_KM;
  const r2 = planet(to).smaAu * AU_KM;
  const a = (r1 + r2) / 2;
  const tofDays = (Math.PI * Math.sqrt((a * a * a) / MU_SUN)) / DAY_S;
  const vInfDepart = Math.abs(Math.sqrt(MU_SUN / r1) * (Math.sqrt((2 * r2) / (r1 + r2)) - 1));
  const vInfArrive = Math.abs(Math.sqrt(MU_SUN / r2) * (1 - Math.sqrt((2 * r1) / (r1 + r2))));
  return { tofDays, vInfDepart, vInfArrive };
}

/** How often the two planets return to the same relative position, i.e. how often launch windows repeat. */
export function synodicDays(a: PlanetId, b: PlanetId): number {
  return 1 / Math.abs(1 / planet(a).periodDays - 1 / planet(b).periodDays);
}
