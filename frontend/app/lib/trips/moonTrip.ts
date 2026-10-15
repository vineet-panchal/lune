import { DAY_MS, DAY_S, planet, soiKm, type PlanetId, type State } from "./bodies";
import { lambert, propagate } from "./kepler";
import { EARTH_MU, PARKING_RADIUS_KM, planFlight, type Flight } from "./launch";
import type { LaunchSite } from "./launchSites";
import { moon as moonBody, moonError, moonReady, moonState, type MoonBody, type MoonId } from "./moons";
import { captureBurn } from "./transfer";
import { add, cross, dot, norm, scale, sub, unit, type Vec3 } from "./vec";
import type { Vehicle } from "./vehicles";

/**
 * The last leg of a trip to a moon, inside its planet's sphere of influence, with patched conics like the rest:
 *  - from another planet: the arrival hyperbola, a braking burn at its low point into a long capture orbit, a
 *    few loops of that orbit while the moon comes round, then a burn at the low point onto a Lambert arc that
 *    meets the moon, and a last burn into a low orbit around it (or, for a moon too small to orbit, matching
 *    its speed). How low to brake, the arrival plane, the number of loops and the arc's flight time are
 *    searched for the cheapest combination.
 *  - from the moon's own planet (Earth to the Moon, Mars to Phobos): from the low parking orbit straight onto
 *    an ellipse whose high point is where the moon will be when the spacecraft gets there.
 * Planet-centred J2000 equatorial (EQJ), km and seconds. The moon's gravity only counts at the final burn, and
 * moon-to-moon gravity assists (how Galileo, Cassini and Europa Clipper really save fuel) aren't modelled.
 */

/** A coasting stretch: a two-body orbit around the planet through (r, v) at tRef, flown from t0 to t1. */
export type LegArc = { id: "approach" | "parking" | "capture" | "transfer"; label: string; tRef: number; r: Vec3; v: Vec3; t0: number; t1: number; mu: number };

export type LegBurn = { label: string; ms: number; dvKms: number; hint: string };

export type MoonLeg = {
  moon: MoonId;
  planet: PlanetId;
  /** Starts from a parking orbit around the moon's own planet (no interplanetary transfer before it). */
  local: boolean;
  arcs: LegArc[];
  burns: LegBurn[];
  startMs: number;
  /** Reaching the moon. */
  arriveMs: number;
  vInfMoonKms: number;
  insertion: "orbit" | "rendezvous";
  totalKms: number;
  capture: { periKm: number; apoKm: number; periodHours: number; loops: number } | null;
  transferDays: number;
  /** How far from the moon the coast ends (the small correction this leaves for a real mission), km. */
  missKm: number;
};

export type MoonLegResult = { leg: MoonLeg | null; loading: boolean; error: string | null };

const THETA_STEPS = 16;
const TOF_STEPS = 24;
const PERIAPSIS_STEPS = 6;

/** The burn into the moon's low orbit, or to match its speed when it is too small to orbit. */
export function insertionBurn(m: MoonBody, vInf: number): number {
  if (m.lowOrbitAltKm === null) return vInf;
  const r = m.radiusKm + m.lowOrbitAltKm;
  return captureBurn(m.mu, r, r, vInf);
}

/** After an interplanetary transfer: capture at the moon's planet, then on to the moon. */
export function moonLegAfterTransfer(id: MoonId, vInfArrive: Vec3, arriveMs: number): MoonLegResult {
  const m = moonBody(id);
  const P = planet(m.planet);
  const mu = P.mu;
  // Where to brake: low (the most help from the planet's gravity, the Oberth effect) up to near the moon's own
  // orbit (less speed to shed on reaching it). Which wins depends on the planet and the moon, so try a spread.
  const rpLow = P.radiusKm + P.lowOrbitAltKm;
  const rpHigh = Math.max(rpLow, 0.95 * m.smaKm);
  const configs = Array.from({ length: PERIAPSIS_STEPS }, (_, i) => captureConfig(m, rpLow * Math.pow(rpHigh / rpLow, i / (PERIAPSIS_STEPS - 1))));
  const endMs = arriveMs + Math.max(...configs.map((c) => c.loops * c.periodS + c.tofs[TOF_STEPS - 1] * 1.1)) * 1000;
  if (!moonReady(id, [arriveMs, endMs])) {
    const error = moonError(id, [arriveMs, endMs]);
    return { leg: null, loading: !error, error };
  }

  const vInf = norm(vInfArrive);
  const s = unit(vInfArrive);
  const m0 = moonState(id, arriveMs)!;
  const hMoon = unit(cross(m0.r, m0.v));
  // Planes through the arrival direction: theta = 0 is the one closest to the moon's orbit.
  let w1 = sub(hMoon, scale(s, dot(hMoon, s)));
  if (norm(w1) < 1e-6) w1 = cross(s, Math.abs(s[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]);
  w1 = unit(w1);
  const w2 = cross(s, w1);

  type Candidate = { cost: number; config: CaptureConfig; theta: number; k: number; tof: number; v1: Vec3; v2: Vec3; moonAt: State };
  let best: Candidate | null = null;
  // `best` is set inside closures, which TypeScript's narrowing can't see.
  const bestCost = () => (best as Candidate | null)?.cost ?? Infinity;

  for (const config of configs) {
    const { rp, aCap, periodS, loops, tofs } = config;
    const e = 1 + (rp * vInf * vInf) / mu;
    const beta = Math.atan2(e - 1 / e, Math.sin(Math.acos(-1 / e)));
    const vHyp = Math.sqrt(vInf * vInf + (2 * mu) / rp);
    const vCapP = Math.sqrt(mu * (2 / rp - 1 / aCap));
    const captureKms = vHyp - vCapP;
    if (captureKms >= bestCost()) continue;
    const vCapAt = (theta: number) => {
      const n = add(scale(w1, Math.cos(theta)), scale(w2, Math.sin(theta)));
      const pHat = sub(scale(s, Math.cos(beta)), scale(cross(n, s), Math.sin(beta)));
      return { rP: scale(pHat, rp), vCap: scale(cross(n, pHat), vCapP) };
    };
    const consider = (theta: number, k: number, tof: number, moonAt: State) => {
      const g = vCapAt(theta);
      const sol = lambert(g.rP, moonAt.r, tof, mu, hMoon);
      if (!sol) return;
      const cost = captureKms + norm(sub(sol.v1, g.vCap)) + insertionBurn(m, norm(sub(sol.v2, moonAt.v)));
      if (!(cost < bestCost())) return;
      // The solver returns its closest try when no arc fits the flight time: check this one really arrives.
      if (norm(sub(propagate(g.rP, sol.v1, tof, mu).r, moonAt.r)) > 1e-3 * m.smaKm) return;
      if (dipsBelow(g.rP, sol.v1, tof, mu, P.radiusKm)) return;
      best = { cost, config, theta, k, tof, v1: sol.v1, v2: sol.v2, moonAt };
    };
    // The moon's position only depends on the loop count and flight time, so look it up once per pair.
    const moonAt: State[][] = [];
    for (let k = 1; k <= loops; k++) moonAt.push(tofs.map((tof) => moonState(id, arriveMs + (k * periodS + tof) * 1000)!));
    const coarseBefore = best;
    for (let a = 0; a < THETA_STEPS; a++) {
      const theta = (2 * Math.PI * a) / THETA_STEPS;
      for (let k = 1; k <= loops; k++) for (let j = 0; j < TOF_STEPS; j++) consider(theta, k, tofs[j], moonAt[k - 1][j]);
    }
    // Refine around this periapsis's best cell: finer flight times and planes.
    const c = best as Candidate | null;
    if (!c || c === coarseBefore) continue;
    const dTof = tofs[1] - tofs[0];
    const dTheta = (2 * Math.PI) / THETA_STEPS;
    for (let i = -8; i <= 8; i++) {
      const tof = c.tof + (i / 8) * dTof;
      if (tof <= 0) continue;
      const at = moonState(id, arriveMs + (c.k * periodS + tof) * 1000)!;
      for (let q = -2; q <= 2; q++) consider(c.theta + (q / 4) * dTheta, c.k, tof, at);
    }
  }
  if (!best) return { leg: null, loading: false, error: `No transfer to ${id} found from this arrival.` };

  const b: Candidate = best;
  const { rp, ra, aCap, periodS } = b.config;
  const e = 1 + (rp * vInf * vInf) / mu;
  const beta = Math.atan2(e - 1 / e, Math.sin(Math.acos(-1 / e)));
  const n = add(scale(w1, Math.cos(b.theta)), scale(w2, Math.sin(b.theta)));
  const pHat = sub(scale(s, Math.cos(beta)), scale(cross(n, s), Math.sin(beta)));
  const qHat = cross(n, pHat);
  const rP = scale(pHat, rp);
  const vHyp = Math.sqrt(vInf * vInf + (2 * mu) / rp);
  const vCap = scale(qHat, Math.sqrt(mu * (2 / rp - 1 / aCap)));
  const tTr = arriveMs + b.k * periodS * 1000;
  const tM = tTr + b.tof * 1000;
  const captureKms = vHyp - norm(vCap);
  const transferKms = norm(sub(b.v1, vCap));
  const vInfMoon = norm(sub(b.v2, b.moonAt.v));
  const insertKms = insertionBurn(m, vInfMoon);
  const alt = (r: number) => Math.round(r - P.radiusKm).toLocaleString("en-US");

  // The approach: from well outside the capture orbit down to its low point.
  const aHyp = -mu / (vInf * vInf);
  const rFar = Math.min(soiKm(P), 4 * ra);
  const F = Math.acosh((1 - rFar / aHyp) / e);
  const approachS = Math.sqrt(Math.pow(-aHyp, 3) / mu) * (e * Math.sinh(F) - F);

  const arcs: LegArc[] = [
    { id: "approach", label: `Arrival at ${P.id}`, tRef: arriveMs, r: rP, v: scale(qHat, vHyp), t0: arriveMs - approachS * 1000, t1: arriveMs, mu },
    { id: "capture", label: "Capture orbit", tRef: arriveMs, r: rP, v: vCap, t0: arriveMs, t1: tTr, mu },
    { id: "transfer", label: `Transfer to ${id}`, tRef: tTr, r: rP, v: b.v1, t0: tTr, t1: tM, mu },
  ];
  const burns: LegBurn[] = [
    { label: `Capture at ${P.id}`, ms: arriveMs, dvKms: captureKms, hint: `Brake at the low point (${alt(rp)} km up) into a ${alt(rp)} × ${alt(ra)} km orbit.` },
    { label: `Transfer burn to ${id}`, ms: tTr, dvKms: transferKms, hint: `After ${b.k} loop${b.k === 1 ? "" : "s"} of the capture orbit, at its low point: onto an arc that meets ${id}, turning the orbit's plane if needed.` },
    insertion(m, tM, insertKms, vInfMoon),
  ];
  return {
    leg: {
      moon: id,
      planet: P.id,
      local: false,
      arcs,
      burns,
      startMs: arcs[0].t0,
      arriveMs: tM,
      vInfMoonKms: vInfMoon,
      insertion: m.lowOrbitAltKm === null ? "rendezvous" : "orbit",
      totalKms: captureKms + transferKms + insertKms,
      capture: { periKm: rp, apoKm: ra, periodHours: periodS / 3600, loops: b.k },
      transferDays: b.tof / DAY_S,
      missKm: 0,
    },
    loading: false,
    error: null,
  };
}

type CaptureConfig = { rp: number; ra: number; aCap: number; periodS: number; loops: number; tofs: number[] };

/** A capture orbit with its low point at rp, reaching twice the moon's distance, and the flight times to try from it. */
function captureConfig(m: MoonBody, rp: number): CaptureConfig {
  const P = planet(m.planet);
  const ra = Math.min(soiKm(P) / 4, Math.max(2 * rp, 2 * m.smaKm));
  const aCap = (rp + ra) / 2;
  const periodS = 2 * Math.PI * Math.sqrt((aCap * aCap * aCap) / P.mu);
  const aH = (rp + m.smaKm) / 2;
  const tH = Math.PI * Math.sqrt((aH * aH * aH) / P.mu);
  // Enough loops that the moon comes round to every position at least twice.
  const loops = Math.min(16, Math.max(3, Math.ceil((2 * m.periodDays * DAY_S) / periodS) + 1));
  // From a quick arc up to about one moon orbit: near the moon's distance a Hohmann half-orbit is too short.
  const tofMax = Math.max(1.8 * tH, 0.9 * m.periodDays * DAY_S);
  const tofs = Array.from({ length: TOF_STEPS }, (_, j) => 0.3 * tH + ((tofMax - 0.3 * tH) * j) / (TOF_STEPS - 1));
  return { rp, ra, aCap, periodS, loops, tofs };
}

/**
 * From a parking orbit around the moon's own planet, given the state just after the departure burn at its low
 * point (rP, vP at departMs): coast to the high point and meet the moon there.
 */
export function moonLegLocal(id: MoonId, departMs: number, rP: Vec3, vP: Vec3): MoonLegResult {
  const m = moonBody(id);
  const P = planet(m.planet);
  const mu = P.mu;
  const rp = norm(rP);
  const vc = Math.sqrt(mu / rp);
  const energy = dot(vP, vP) / 2 - mu / rp;
  const a = -mu / (2 * energy);
  const halfS = Math.PI * Math.sqrt((a * a * a) / mu);
  const tM = departMs + halfS * 1000;
  if (!moonReady(id, [departMs, tM])) {
    const error = moonError(id, [departMs, tM]);
    return { leg: null, loading: !error, error };
  }
  const craft = propagate(rP, vP, halfS, mu);
  const mAt = moonState(id, tM)!;
  const vInfMoon = norm(sub(craft.v, mAt.v));
  const departKms = norm(vP) - vc;
  const insertKms = insertionBurn(m, vInfMoon);
  const parkingS = 2 * Math.PI * Math.sqrt((rp * rp * rp) / mu);
  const vParking = scale(unit(vP), vc);
  const arcs: LegArc[] = [
    { id: "parking", label: "Parking orbit", tRef: departMs, r: rP, v: vParking, t0: departMs - parkingS * 1000, t1: departMs, mu },
    { id: "transfer", label: `Transfer to ${id}`, tRef: departMs, r: rP, v: vP, t0: departMs, t1: tM, mu },
  ];
  const isMoon = id === "Moon";
  const burns: LegBurn[] = [
    {
      label: isMoon ? "Trans-lunar injection" : `Departure burn to ${id}`,
      ms: departMs,
      dvKms: departKms,
      hint: `From the ${Math.round(rp - P.radiusKm)} km parking orbit onto an ellipse whose high point is where ${id} will be.`,
    },
    insertion(m, tM, insertKms, vInfMoon),
  ];
  return {
    leg: {
      moon: id,
      planet: P.id,
      local: true,
      arcs,
      burns,
      startMs: arcs[0].t0,
      arriveMs: tM,
      vInfMoonKms: vInfMoon,
      insertion: m.lowOrbitAltKm === null ? "rendezvous" : "orbit",
      totalKms: departKms + insertKms,
      capture: null,
      transferDays: halfS / DAY_S,
      missKm: norm(sub(craft.r, mAt.r)),
    },
    loading: false,
    error: null,
  };
}

/**
 * Leaving a low orbit around the moon's planet without a launch to plan (any planet but Earth, or Earth when
 * no pad can reach the right plane): the parking orbit lies in the moon's orbital plane, and the departure is
 * timed so the ellipse's high point meets the moon. Returns the state just after the burn.
 */
export function localDeparture(id: MoonId, dayStartMs: number): { departMs: number; rP: Vec3; vP: Vec3 } | null {
  const m = moonBody(id);
  const P = planet(m.planet);
  const mu = P.mu;
  const rp = P.radiusKm + P.lowOrbitAltKm;
  const departMs = dayStartMs + DAY_MS / 2;
  let tM = departMs + Math.PI * Math.sqrt(((rp + m.smaKm) / 2) ** 3 / mu) * 1000;
  let out: { departMs: number; rP: Vec3; vP: Vec3 } | null = null;
  for (let i = 0; i < 4; i++) {
    if (!moonReady(id, [tM])) return null;
    const target = moonState(id, tM)!;
    const pHat = scale(unit(target.r), -1);
    const qHat = unit(cross(cross(target.r, target.v), pHat));
    const ra = norm(target.r);
    const a = (rp + ra) / 2;
    out = { departMs, rP: scale(pHat, rp), vP: scale(qHat, Math.sqrt(mu * (2 / rp - 1 / a))) };
    tM = departMs + Math.PI * Math.sqrt((a * a * a) / mu) * 1000;
  }
  return out;
}

/**
 * Launching to the Moon: the parking orbit must contain the pad at liftoff and the point where the Moon will be
 * at arrival (the transfer ellipse's high point). Arrival depends on when the burn happens, which depends on the
 * launch time, so this settles in a few rounds; after the first, the search stays near the window it found (a
 * pad usually has two a day, and hopping between them would never settle). With preferMs (a real launch's
 * planned time), the window nearest it is tried first. Null when the pad can't reach the plane that day.
 */
export function planLunarFlight(vehicle: Vehicle, site: LaunchSite, payloadKg: number, dayStartMs: number, preferMs: number | null = null): Flight | null {
  const rp = PARKING_RADIUS_KM;
  let target = moonState("Moon", dayStartMs + 5.5 * DAY_MS)!.r;
  let flight: Flight | null = null;
  for (let i = 0; i < 8; i++) {
    const a = (rp + norm(target)) / 2;
    const near: number | null = (flight as Flight | null)?.window.launchMs ?? preferMs;
    flight = (near !== null && planFlight(vehicle, site, payloadKg, -EARTH_MU / a, target, near - 3 * 3_600_000, 6 * 60)) || planFlight(vehicle, site, payloadKg, -EARTH_MU / a, target, dayStartMs);
    if (!flight) return null;
    const next = moonState("Moon", flight.departMs + Math.PI * Math.sqrt((a * a * a) / EARTH_MU) * 1000)!.r;
    const moved = norm(sub(next, target));
    target = next;
    if (moved < 20) break;
  }
  return flight;
}

function insertion(m: MoonBody, ms: number, dvKms: number, vInf: number): LegBurn {
  return m.lowOrbitAltKm === null
    ? { label: `Match speed with ${m.id}`, ms, dvKms, hint: `${m.id} is too small to orbit usefully (its gravity is tiny), so arriving means matching its speed: the whole ${vInf.toFixed(2)} km/s.` }
    : { label: `${m.id} orbit insertion`, ms, dvKms, hint: `Arriving at ${vInf.toFixed(2)} km/s relative to ${m.id}; brake at the low point into a ${m.lowOrbitAltKm} km circular orbit.` };
}

/** Whether an arc from (r, v) dips below the planet's surface within tof. */
function dipsBelow(r: Vec3, v: Vec3, tof: number, mu: number, radiusKm: number): boolean {
  for (let i = 1; i < 12; i++) if (norm(propagate(r, v, (tof * i) / 12, mu).r) < radiusKm) return true;
  return false;
}

/** Where the spacecraft is on the leg (planet-centred EQJ km): null before it starts; on the moon after arriving. */
export function legPosition(leg: MoonLeg, ms: number): Vec3 | null {
  if (ms < leg.startMs) return null;
  for (const arc of leg.arcs) {
    if (ms >= arc.t0 && ms <= arc.t1) return propagate(arc.r, arc.v, (ms - arc.tRef) / 1000, arc.mu).r;
  }
  return moonState(leg.moon, ms)?.r ?? null;
}

/** Points along each arc (planet-centred EQJ km) with their times, for drawing. */
export function sampleLeg(leg: MoonLeg, perArc = 160): { arc: LegArc; points: Vec3[]; times: number[] }[] {
  return leg.arcs.map((arc) => {
    // A long capture coast is many loops: sample each loop evenly.
    const loops = arc.id === "capture" && leg.capture ? leg.capture.loops : 1;
    const n = perArc * loops;
    const points: Vec3[] = [];
    const times: number[] = [];
    for (let i = 0; i <= n; i++) {
      const ms = arc.t0 + ((arc.t1 - arc.t0) * i) / n;
      points.push(propagate(arc.r, arc.v, (ms - arc.tRef) / 1000, arc.mu).r);
      times.push(ms);
    }
    return { arc, points, times };
  });
}
