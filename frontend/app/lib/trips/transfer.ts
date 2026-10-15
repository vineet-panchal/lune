import { AU_KM, DAY_MS, ECLIPTIC_NORTH_EQJ, MU_SUN, eqjToEcl, helioState, planet, soiKm, type PlanetId, type State } from "./bodies";
import { elements, lambert, propagate } from "./kepler";
import { angleBetween, norm, scale, sub, type Vec3 } from "./vec";

/**
 * A direct planet-to-planet transfer with patched conics: a Lambert arc around the Sun between where the two
 * planets are at departure and arrival, joined to hyperbolas at each end. This is how mission designers size
 * a trip before any detailed work, and it reproduces the published numbers for real launch windows (Mars 2020:
 * C3 ≈ 14 km²/s², ~7 months). It leaves out gravity assists, deep-space manoeuvres and the planets' pull
 * during cruise.
 */

/** What happens at the destination. */
export type ArrivalMode = "flyby" | "capture" | "orbit";

export const ARRIVAL_MODES: { id: ArrivalMode; label: string; detail: string }[] = [
  { id: "flyby", label: "Fly by", detail: "No braking: swing past the planet like Voyager or New Horizons." },
  { id: "capture", label: "Capture", detail: "Brake into a long, elliptical orbit (low point near the planet, high point at a quarter of its sphere of influence), like Juno or Cassini." },
  { id: "orbit", label: "Low orbit", detail: "Brake all the way into a low circular orbit. Costs the most fuel." },
];

export type Transfer = {
  origin: PlanetId;
  destination: PlanetId;
  departMs: number;
  arriveMs: number;
  tofDays: number;
  /** Heliocentric EQJ km and km/s: the spacecraft just after leaving the origin and on reaching the destination. */
  r1: Vec3;
  v1: Vec3;
  r2: Vec3;
  v2: Vec3;
  originAtDeparture: State;
  destinationAtArrival: State;
  /** Hyperbolic excess velocity leaving the origin (EQJ, km/s): the speed left over once free of its gravity. */
  vInfDepart: Vec3;
  vInfDepartKms: number;
  /** Launch energy, km²/s²: the number launch vehicles are rated by. */
  c3: number;
  /** Direction of the departure asymptote in the origin's equatorial frame (exact for Earth, EQJ for others). */
  declinationDeg: number;
  rightAscensionDeg: number;
  vInfArrive: Vec3;
  vInfArriveKms: number;
  /** Burn from the parking orbit onto the escape hyperbola, km/s. */
  departBurnKms: number;
  /** Braking burn at the destination for the chosen arrival mode, km/s. */
  arriveBurnKms: number;
  totalKms: number;
  /** Shape of the transfer orbit around the Sun. */
  orbit: { aAu: number; e: number; inclinationDeg: number; periAu: number; apoAu: number; sweepDeg: number; longWay: boolean };
  parkingAltKm: number;
  arrival: ArrivalMode;
  /** Low point of the orbit at the destination and, for a capture, its high point (km from the centre). */
  arrivalPeriapsisKm: number;
  arrivalApoapsisKm: number | null;
};

export type TransferOptions = { parkingAltKm?: number; arrival?: ArrivalMode };

export function transfer(origin: PlanetId, destination: PlanetId, departMs: number, arriveMs: number, opts: TransferOptions = {}): Transfer | null {
  const tof = (arriveMs - departMs) / 1000;
  if (!(tof > 0) || origin === destination) return null;
  const a = helioState(origin, departMs);
  const b = helioState(destination, arriveMs);
  return transferBetween(origin, destination, departMs, arriveMs, a, b, opts);
}

/** The same with the planets' states already known (the porkchop grid reuses them across many cells). */
export function transferBetween(origin: PlanetId, destination: PlanetId, departMs: number, arriveMs: number, a: State, b: State, opts: TransferOptions = {}): Transfer | null {
  const tof = (arriveMs - departMs) / 1000;
  const sol = lambert(a.r, b.r, tof, MU_SUN, ECLIPTIC_NORTH_EQJ);
  if (!sol) return null;
  const parkingAltKm = opts.parkingAltKm ?? planet(origin).lowOrbitAltKm;
  const arrival = opts.arrival ?? "capture";

  const vInfDepart = sub(sol.v1, a.v);
  const vInfArrive = sub(sol.v2, b.v);
  const vInfDepartKms = norm(vInfDepart);
  const vInfArriveKms = norm(vInfArrive);
  const from = planet(origin);
  const to = planet(destination);

  const departBurnKms = escapeBurn(from.mu, from.radiusKm + parkingAltKm, vInfDepartKms);
  const arrivalPeriapsisKm = to.radiusKm + to.lowOrbitAltKm;
  const arrivalApoapsisKm = arrival === "capture" ? Math.max(arrivalPeriapsisKm * 2, soiKm(to) / 4) : arrival === "orbit" ? arrivalPeriapsisKm : null;
  const arriveBurnKms = arrival === "flyby" ? 0 : captureBurn(to.mu, arrivalPeriapsisKm, arrivalApoapsisKm!, vInfArriveKms);

  // Asymptote direction: EQJ is Earth's equatorial frame, so for Earth this is the launch declination (DLA).
  const declinationDeg = (Math.asin(vInfDepart[2] / vInfDepartKms) * 180) / Math.PI;
  const rightAscensionDeg = (((Math.atan2(vInfDepart[1], vInfDepart[0]) * 180) / Math.PI) + 360) % 360;

  const el = elements(a.r, sol.v1, MU_SUN, ECLIPTIC_NORTH_EQJ);
  const sweep = angleBetween(a.r, b.r);
  return {
    origin,
    destination,
    departMs,
    arriveMs,
    tofDays: tof / 86_400,
    r1: a.r,
    v1: sol.v1,
    r2: b.r,
    v2: sol.v2,
    originAtDeparture: a,
    destinationAtArrival: b,
    vInfDepart,
    vInfDepartKms,
    c3: vInfDepartKms * vInfDepartKms,
    declinationDeg,
    rightAscensionDeg,
    vInfArrive,
    vInfArriveKms,
    departBurnKms,
    arriveBurnKms,
    totalKms: departBurnKms + arriveBurnKms,
    orbit: {
      aAu: el.a / AU_KM,
      e: el.e,
      inclinationDeg: (el.i * 180) / Math.PI,
      periAu: el.periapsis / AU_KM,
      apoAu: el.apoapsis / AU_KM,
      sweepDeg: ((sol.longWay ? 2 * Math.PI - sweep : sweep) * 180) / Math.PI,
      longWay: sol.longWay,
    },
    parkingAltKm,
    arrival,
    arrivalPeriapsisKm,
    arrivalApoapsisKm,
  };
}

/** From a circular orbit of radius r to a hyperbola leaving at vInf, burning at the low point (Oberth effect). */
export function escapeBurn(mu: number, r: number, vInf: number): number {
  return Math.sqrt(vInf * vInf + (2 * mu) / r) - Math.sqrt(mu / r);
}

/** From a hyperbola arriving at vInf to an orbit with low point rp and high point ra, braking at the low point. */
export function captureBurn(mu: number, rp: number, ra: number, vInf: number): number {
  const a = (rp + ra) / 2;
  return Math.sqrt(vInf * vInf + (2 * mu) / rp) - Math.sqrt(mu * (2 / rp - 1 / a));
}

/** The spacecraft's heliocentric EQJ position (km) at time ms, on the transfer arc (clamped to its ends). */
export function transferPosition(t: Transfer, ms: number): Vec3 {
  const clamped = Math.min(t.arriveMs, Math.max(t.departMs, ms));
  return propagate(t.r1, t.v1, (clamped - t.departMs) / 1000, MU_SUN).r;
}

/** Points along the arc in ecliptic AU, for drawing. */
export function sampleTransfer(t: Transfer, n = 240): Vec3[] {
  const out: Vec3[] = [];
  for (let i = 0; i <= n; i++) {
    const ms = t.departMs + ((t.arriveMs - t.departMs) * i) / n;
    out.push(eqjToEcl(scale(transferPosition(t, ms), 1 / AU_KM)));
  }
  return out;
}

/** Fuel to make a burn, from the rocket equation: the fraction of the starting mass that must be propellant. */
export function propellantFraction(dvKms: number, ispS: number): number {
  return 1 - Math.exp(-(dvKms * 1000) / (ispS * 9.80665));
}

export const daysToMs = (d: number) => d * DAY_MS;
