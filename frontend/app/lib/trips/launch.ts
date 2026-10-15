import * as Astronomy from "astronomy-engine";
import { planet } from "./bodies";
import { propagate } from "./kepler";
import { azimuthAllowed, SITE_BY_ID, type LaunchSite } from "./launchSites";
import { add, cross, dot, norm, scale, unit, type Vec3 } from "./vec";
import { G0, stageFlow, wetKg, type Vehicle } from "./vehicles";

/**
 * Getting off Earth: when to launch, in which direction, how much of each stage it takes and where the rocket
 * is along the way. Everything is geocentric J2000 equatorial (EQJ), km and seconds.
 *
 * What is computed and what is modelled:
 *  - The launch time and direction are geometry: the parking orbit must contain both the pad (at liftoff) and
 *    the direction the spacecraft has to leave Earth in, and the pad only allows some directions.
 *  - Propellant per stage is the rocket equation on each stage's real masses and Isp. Gravity, drag and
 *    steering losses aren't simulated; each vehicle's are set so it lifts exactly its published LEO payload.
 *  - The climb to orbit (altitude and speed against time) is a smooth profile shaped like a real ascent and
 *    timed by the stages' real burn times, not a guidance simulation.
 */

const EARTH = planet("Earth");
export const EARTH_MU = EARTH.mu;
export const EARTH_RADIUS_KM = EARTH.radiusKm;
export const PARKING_ALT_KM = 200;
export const PARKING_RADIUS_KM = EARTH_RADIUS_KM + PARKING_ALT_KM;
/** Circular speed in the parking orbit, km/s. */
export const V_PARKING = Math.sqrt(EARTH_MU / PARKING_RADIUS_KM);
/** Earth's surface speed at the equator, km/s. */
const V_EQUATOR = 0.4651;
/** Upper stage ignition after core shutdown (stage separation and settling). */
const STAGING_GAP_S = 8;
/** Spacecraft separation after the departure burn ends. */
const SEPARATION_DELAY_S = 300;
/** Shortest believable coast in the parking orbit before the departure burn (checkout, alignment). */
const MIN_COAST_S = 12 * 60;
/** Typical engine efficiency of a spacecraft's own (bipropellant) engine, for its braking burn on arrival. */
export const SPACECRAFT_ISP = 321;

// ── Performance ──

type Phase = { name: string; startS: number; endS: number; m0: number; mdot: number; isp: number; dvKms: number };

/** The full burns of everything below the upper stage, with a given payload, and what's left at upper ignition. */
function lowerPhases(v: Vehicle, payloadKg: number): { phases: Phase[]; upperStartMass: number; upperIgnitionS: number; mecoS: number; boosterSepS: number | null } {
  const core = stageFlow(v.core);
  const upperWet = wetKg(v.upper);
  let m = payloadKg + v.fairingKg + upperWet + wetKg(v.core) + (v.boosters ? wetKg(v.boosters) * v.boosters.count : 0);
  const phases: Phase[] = [];
  let t = 0;
  let coreLeft = v.core.propKg;
  let boosterSepS: number | null = null;

  if (v.boosters) {
    const b = stageFlow(v.boosters);
    const throttle = v.coreThrottleWithBoosters ?? 1;
    const dur = v.boosters.burnS;
    const mdot = b.mdot * v.boosters.count + core.mdot * throttle;
    // Thrust-weighted Isp over the climb out of the atmosphere (halfway between sea level and vacuum).
    const thrust = b.mdot * v.boosters.count * avgIsp(v.boosters, 0.5) + core.mdot * throttle * avgIsp(v.core, 0.5);
    const isp = thrust / mdot;
    phases.push(phase(`${v.boosters.count} boosters + ${v.core.name.toLowerCase()}`, t, dur, m, mdot, isp));
    m -= mdot * dur;
    coreLeft -= core.mdot * throttle * dur;
    t += dur;
    m -= v.boosters.dryKg * v.boosters.count;
    boosterSepS = t;
  }
  const coreDur = coreLeft / core.mdot;
  phases.push(phase(v.core.name, t, coreDur, m, core.mdot, avgIsp(v.core, v.boosters ? 0.8 : 0.5)));
  m -= coreLeft;
  t += coreDur;
  const mecoS = t;
  m -= v.core.dryKg + v.fairingKg;
  return { phases, upperStartMass: m, upperIgnitionS: t + STAGING_GAP_S, mecoS, boosterSepS };
}

function avgIsp(s: { ispSl: number; ispVac: number }, vacWeight: number) {
  return s.ispSl * (1 - vacWeight) + s.ispVac * vacWeight;
}

function phase(name: string, startS: number, dur: number, m0: number, mdot: number, isp: number): Phase {
  return { name, startS, endS: startS + dur, m0, mdot, isp, dvKms: (isp * G0 * Math.log(m0 / (m0 - mdot * dur))) / 1000 };
}

/** Total ideal Δv (km/s, no losses) the vehicle can give a payload, burning every stage dry. */
export function idealDeltaV(v: Vehicle, payloadKg: number): number {
  const lower = lowerPhases(v, payloadKg);
  const m0 = lower.upperStartMass;
  const upper = (v.upper.ispVac * G0 * Math.log(m0 / (m0 - v.upper.propKg))) / 1000;
  return lower.phases.reduce((s, p) => s + p.dvKms, 0) + upper;
}

/** Earth's spin along a launch direction, km/s. */
export function rotationBoost(latDeg: number, azimuthDeg: number): number {
  return V_EQUATOR * Math.cos((latDeg * Math.PI) / 180) * Math.sin((azimuthDeg * Math.PI) / 180);
}

/**
 * Gravity, drag and steering losses (km/s) that make the vehicle's published LEO payload come out exactly:
 * ideal Δv with that payload = orbital speed + losses − Earth's spin (due east from its reference pad).
 */
export function calibratedLosses(v: Vehicle): number {
  const site = SITE_BY_ID.get(v.leoReferenceSite)!;
  return idealDeltaV(v, v.leoKg) - V_PARKING + rotationBoost(site.latDeg, 90);
}

export type StageUse = {
  name: string;
  engines: string;
  propellant: string;
  propKg: number;
  usedKg: number;
  /** For the upper stage: split between reaching the parking orbit and the departure burn. */
  toOrbitKg?: number;
  departKg?: number;
  dvKms: number;
  count: number;
};

export type Performance = {
  payloadKg: number;
  lossesKms: number;
  rotationKms: number;
  toOrbitKms: number;
  departKms: number;
  requiredKms: number;
  capabilityKms: number;
  /** Positive: Δv to spare; negative: how far short it falls. */
  marginKms: number;
  canDo: boolean;
  maxPayloadKg: number;
  liftoffMassKg: number;
  liftoffThrustKn: number;
  stages: StageUse[];
  /** Seconds after liftoff. */
  boosterSepS: number | null;
  mecoS: number;
  upperIgnitionS: number;
  parkingInsertionS: number;
  /** Departure burn length, s (0 when it can't be done). */
  departBurnS: number;
  upperMdot: number;
};

export function performance(v: Vehicle, payloadKg: number, c3: number, latDeg: number, azimuthDeg: number): Performance {
  const losses = calibratedLosses(v);
  const rotation = rotationBoost(latDeg, azimuthDeg);
  const toOrbit = V_PARKING + losses - rotation;
  const depart = departureBurn(c3);
  const required = toOrbit + depart;

  const lower = lowerPhases(v, payloadKg);
  const lowerDv = lower.phases.reduce((s, p) => s + p.dvKms, 0);
  const ve = (v.upper.ispVac * G0) / 1000;
  const mU = lower.upperStartMass;
  const upperOrbitDv = Math.max(0, toOrbit - lowerDv);
  const toOrbitKg = Math.min(v.upper.propKg, mU * (1 - Math.exp(-upperOrbitDv / ve)));
  const afterOrbit = mU - toOrbitKg;
  const departKgNeeded = afterOrbit * (1 - Math.exp(-depart / ve));
  const departKg = Math.min(v.upper.propKg - toOrbitKg, departKgNeeded);
  const capability = lowerDv + (ve * Math.log(mU / (mU - v.upper.propKg)));
  const canDo = capability >= required;
  const upper = stageFlow(v.upper);

  const stages: StageUse[] = [];
  if (v.boosters) {
    stages.push({ name: v.boosters.name, engines: v.boosters.engines, propellant: v.boosters.propellant, propKg: v.boosters.propKg, usedKg: v.boosters.propKg, dvKms: lower.phases[0].dvKms, count: v.boosters.count });
  }
  stages.push({ name: v.core.name, engines: v.core.engines, propellant: v.core.propellant, propKg: v.core.propKg, usedKg: v.core.propKg, dvKms: lower.phases[lower.phases.length - 1].dvKms, count: 1 });
  stages.push({
    name: v.upper.name,
    engines: v.upper.engines,
    propellant: v.upper.propellant,
    propKg: v.upper.propKg,
    usedKg: toOrbitKg + departKg,
    toOrbitKg,
    departKg,
    dvKms: ve * Math.log(mU / (mU - toOrbitKg - departKg)),
    count: 1,
  });

  const liftoffThrustKn =
    (v.boosters ? stageFlow(v.boosters).thrustSlKn * v.boosters.count : 0) + stageFlow(v.core).thrustSlKn * (v.boosters ? (v.coreThrottleWithBoosters ?? 1) : 1);

  return {
    payloadKg,
    lossesKms: losses,
    rotationKms: rotation,
    toOrbitKms: toOrbit,
    departKms: depart,
    requiredKms: required,
    capabilityKms: capability,
    marginKms: capability - required,
    canDo,
    maxPayloadKg: maxPayload(v, required),
    liftoffMassKg: payloadKg + v.fairingKg + wetKg(v.upper) + wetKg(v.core) + (v.boosters ? wetKg(v.boosters) * v.boosters.count : 0),
    liftoffThrustKn,
    stages,
    boosterSepS: lower.boosterSepS,
    mecoS: lower.mecoS,
    upperIgnitionS: lower.upperIgnitionS,
    parkingInsertionS: lower.upperIgnitionS + toOrbitKg / upper.mdot,
    departBurnS: canDo ? departKg / upper.mdot : 0,
    upperMdot: upper.mdot,
  };
}

/**
 * From the parking orbit onto an orbit of launch energy c3 at its low point: an escape hyperbola when c3 > 0,
 * or (c3 < 0) a long ellipse still bound to Earth, like a trans-lunar injection.
 */
export function departureBurn(c3: number): number {
  return Math.sqrt(c3 + (2 * EARTH_MU) / PARKING_RADIUS_KM) - V_PARKING;
}

/** Heaviest payload (kg) with which the vehicle still reaches the required Δv. */
function maxPayload(v: Vehicle, requiredKms: number): number {
  if (idealDeltaV(v, 0) < requiredKms) return 0;
  let lo = 0;
  let hi = v.leoKg * 1.5;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (idealDeltaV(v, mid) >= requiredKms) lo = mid;
    else hi = mid;
  }
  return lo;
}

// ── Launch window ──

/** A unit vector rotated about a unit axis (Rodrigues). */
function rotate(x: Vec3, axis: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return add(add(scale(x, c), scale(cross(axis, x), s)), scale(axis, dot(axis, x) * (1 - c)));
}

/** The pad's direction from Earth's centre (EQJ) at a moment: latitude and longitude turned by sidereal time. */
export function siteDirection(site: LaunchSite, ms: number): Vec3 {
  const gst = Astronomy.SiderealTime(new Date(ms)) * 15; // hours → degrees
  const lon = ((gst + site.lngDeg) * Math.PI) / 180;
  const lat = (site.latDeg * Math.PI) / 180;
  return [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
}

/** Earth's rotation angle (radians) for turning the globe: Greenwich's right ascension. */
export function earthRotationRad(ms: number): number {
  return (Astronomy.SiderealTime(new Date(ms)) * 15 * Math.PI) / 180;
}

export type LaunchWindow = {
  launchMs: number;
  azimuthDeg: number;
  /** Of the parking orbit, to Earth's equator. */
  inclinationDeg: number;
  /** Unit normal of the parking orbit (motion is anticlockwise about it). */
  normal: Vec3;
  /** Direction from Earth's centre of the pad at liftoff. */
  padDir: Vec3;
  /** Where the departure burn happens: the low point of the escape hyperbola. */
  perigeeDir: Vec3;
};

/**
 * The best moment on a given day to launch from a pad onto a parking orbit whose plane contains the departure
 * direction: within the pad's allowed azimuths, the one flying most nearly east (the most help from Earth's
 * spin). Null when no minute of the day works. For a bound departure (c3 < 0, e.g. to the Moon) the direction
 * is where the orbit's high point must be, and the burn happens opposite it.
 */
export function findLaunchWindow(site: LaunchSite, asymptote: Vec3, c3: number, dayStartMs: number, spanMinutes = 24 * 60): LaunchWindow | null {
  const s = unit(asymptote);
  let best: LaunchWindow | null = null;
  let bestEast = -Infinity;
  for (let minute = 0; minute < spanMinutes; minute++) {
    const ms = dayStartMs + minute * 60_000;
    const r = siteDirection(site, ms);
    const rxs = cross(r, s);
    if (norm(rxs) < 1e-6) continue;
    const east = unit(cross([0, 0, 1], r));
    const north = cross(r, east);
    for (const sign of [1, -1]) {
      const n = scale(unit(rxs), sign);
      const d = cross(n, r); // direction of travel over the pad
      const az = (((Math.atan2(dot(d, east), dot(d, north)) * 180) / Math.PI) + 360) % 360;
      if (!azimuthAllowed(site, az)) continue;
      const eastness = dot(d, east);
      if (eastness > bestEast) {
        bestEast = eastness;
        best = { launchMs: ms, azimuthDeg: az, inclinationDeg: (Math.acos(Math.min(1, Math.abs(n[2]))) * 180) / Math.PI, normal: n, padDir: r, perigeeDir: perigeeDirection(s, n, c3) };
      }
    }
  }
  return best;
}

/**
 * The hyperbola's low point sits the asymptote's true anomaly (arccos(−1/e)) behind its outgoing direction; an
 * ellipse's low point is opposite its high point.
 */
function perigeeDirection(s: Vec3, n: Vec3, c3: number): Vec3 {
  if (c3 <= 0) return scale(s, -1);
  const e = 1 + (PARKING_RADIUS_KM * c3) / EARTH_MU;
  return rotate(s, n, -Math.acos(-1 / e));
}

// ── The flight ──

export type FlightEvent = { tS: number; label: string; kind: "liftoff" | "maxq" | "staging" | "fairing" | "engine" | "orbit" | "burn" | "separation" };

export type AscentSample = { tS: number; altKm: number; speedKms: number; downrangeRad: number; massKg: number; accelG: number };

export type Flight = {
  vehicle: Vehicle;
  site: LaunchSite;
  window: LaunchWindow;
  perf: Performance;
  /** Seconds after liftoff. */
  coastS: number;
  /** Middle of the departure burn, treated as instantaneous at the hyperbola's low point. */
  departMs: number;
  events: FlightEvent[];
  ascent: AscentSample[];
  insertionDir: Vec3;
  /** State just after the departure burn, geocentric EQJ. */
  perigeeR: Vec3;
  perigeeV: Vec3;
};

/**
 * Plans the flight from the pad to the departure burn: launch time, stage use, the climb, the coast and the
 * burn. c3 and the asymptote come from the transfer; the transfer is then re-timed to start at departMs.
 * For the Moon, c3 is negative and `asymptote` is the direction of the orbit's high point (see findLaunchWindow).
 */
export function planFlight(vehicle: Vehicle, site: LaunchSite, payloadKg: number, c3: number, asymptote: Vec3, dayStartMs: number, spanMinutes?: number): Flight | null {
  const window = findLaunchWindow(site, asymptote, c3, dayStartMs, spanMinutes);
  if (!window) return null;
  const perf = performance(vehicle, payloadKg, c3, site.latDeg, window.azimuthDeg);
  const ascent = ascentProfile(vehicle, perf);
  const end = ascent[ascent.length - 1];
  const insertionDir = rotate(window.padDir, window.normal, end.downrangeRad);

  // Coast round the parking orbit from orbit insertion to the departure point.
  let angle = Math.atan2(dot(window.normal, cross(insertionDir, window.perigeeDir)), dot(insertionDir, window.perigeeDir));
  if (angle < 0) angle += 2 * Math.PI;
  const omega = V_PARKING / PARKING_RADIUS_KM;
  let coastS = angle / omega;
  if (coastS < MIN_COAST_S) coastS += (2 * Math.PI) / omega;
  const departMidS = perf.parkingInsertionS + coastS;
  const departMs = window.launchMs + departMidS * 1000;

  const vp = Math.sqrt(c3 + (2 * EARTH_MU) / PARKING_RADIUS_KM);
  const perigeeR = scale(window.perigeeDir, PARKING_RADIUS_KM);
  const perigeeV = scale(unit(cross(window.normal, window.perigeeDir)), vp);

  const events: FlightEvent[] = [{ tS: 0, label: "Liftoff", kind: "liftoff" }, { tS: Math.min(75, perf.mecoS * 0.45), label: "Max Q: peak aerodynamic pressure", kind: "maxq" }];
  if (perf.boosterSepS !== null) events.push({ tS: perf.boosterSepS, label: `${vehicle.boosters!.count} boosters separate`, kind: "staging" });
  events.push({ tS: perf.mecoS, label: `${vehicle.core.name} engine cutoff`, kind: "engine" });
  events.push({ tS: perf.mecoS + 3, label: `${vehicle.core.name} separates`, kind: "staging" });
  events.push({ tS: perf.upperIgnitionS, label: `${vehicle.upper.name} ignition`, kind: "engine" });
  if (vehicle.fairingKg > 0) events.push({ tS: Math.max(vehicle.fairingSepS, perf.boosterSepS ?? 0), label: "Fairing separates", kind: "fairing" });
  events.push({ tS: perf.parkingInsertionS, label: `Parking orbit reached (${PARKING_ALT_KM} km)`, kind: "orbit" });
  if (perf.canDo) {
    const burn = c3 < 0 ? "Trans-lunar injection" : "Departure burn";
    events.push({ tS: departMidS - perf.departBurnS / 2, label: `${burn} starts`, kind: "burn" });
    events.push({ tS: departMidS + perf.departBurnS / 2, label: `${burn} ends: on the way`, kind: "burn" });
    events.push({ tS: departMidS + perf.departBurnS / 2 + SEPARATION_DELAY_S, label: "Spacecraft separates", kind: "separation" });
  }
  events.sort((a, b) => a.tS - b.tS);

  return { vehicle, site, window, perf, coastS, departMs, events, ascent, insertionDir, perigeeR, perigeeV };
}

/**
 * Altitude, speed and distance flown each second from liftoff to the parking orbit. Speed is Earth's spin
 * plus the stages' ideal Δv so far minus losses, which build up mostly early (gravity and drag); altitude
 * follows a typical gravity-turn shape. By construction it reaches exactly orbital speed at insertion.
 */
function ascentProfile(v: Vehicle, perf: Performance): AscentSample[] {
  const out: AscentSample[] = [];
  const T = perf.parkingInsertionS;
  const core = stageFlow(v.core);
  const booster = v.boosters ? stageFlow(v.boosters) : null;
  const throttle = v.coreThrottleWithBoosters ?? 1;
  const ve = (isp: number) => (isp * G0) / 1000;
  let m = perf.liftoffMassKg;
  let ideal = 0;
  let downrange = 0;
  let prevAlt = 0;
  const dt = 1;
  for (let t = 0; t <= Math.ceil(T); t += dt) {
    const x = Math.min(1, t / T);
    const altKm = PARKING_ALT_KM * Math.pow(Math.sin((Math.PI / 2) * x), 1.4);
    const speed = perf.rotationKms + ideal - perf.lossesKms * (1 - Math.pow(1 - x, 2.5));
    // Mass flow and Isp of whatever is burning now.
    let mdot = 0;
    let isp = 0;
    if (booster && perf.boosterSepS !== null && t < perf.boosterSepS) {
      mdot = booster.mdot * v.boosters!.count + core.mdot * throttle;
      isp = (booster.mdot * v.boosters!.count * avgIsp(v.boosters!, 0.5) + core.mdot * throttle * avgIsp(v.core, 0.5)) / mdot;
    } else if (t < perf.mecoS) {
      mdot = core.mdot;
      isp = avgIsp(v.core, v.boosters ? 0.8 : 0.5);
    } else if (t >= perf.upperIgnitionS) {
      mdot = perf.upperMdot;
      isp = v.upper.ispVac;
    }
    const accelG = mdot > 0 ? (mdot * isp * G0) / m / G0 : 0;
    out.push({ tS: t, altKm, speedKms: Math.max(0, speed), downrangeRad: downrange, massKg: m, accelG });

    // Step forward: staging drops dry mass, burning drops propellant.
    const vVert = (altKm - prevAlt) / dt;
    prevAlt = altKm;
    downrange += (Math.sqrt(Math.max(0, speed * speed - vVert * vVert)) * dt) / (EARTH_RADIUS_KM + altKm);
    if (mdot > 0) {
      ideal += ve(isp) * Math.log(m / (m - mdot * dt));
      m -= mdot * dt;
    }
    if (booster && perf.boosterSepS !== null && t < perf.boosterSepS && t + dt >= perf.boosterSepS) m -= v.boosters!.dryKg * v.boosters!.count;
    if (t < perf.mecoS && t + dt >= perf.mecoS) m -= v.core.dryKg + v.fairingKg;
  }
  return out;
}

export type FlightState = {
  /** Geocentric EQJ km. */
  r: Vec3;
  altKm: number;
  speedKms: number;
  accelG: number;
  massKg: number | null;
  phase: "pad" | "ascent" | "coast" | "burn" | "escape";
  /** Which stages are still attached, and which engine is firing. */
  attached: { boosters: boolean; core: boolean; fairing: boolean; upper: boolean };
  firing: "boosters+core" | "core" | "upper" | null;
};

/** Where the rocket (then spacecraft) is at a moment, from the pad to well past the Moon's distance. */
export function flightState(f: Flight, ms: number): FlightState {
  const tS = (ms - f.window.launchMs) / 1000;
  const p = f.perf;
  const departMidS = (f.departMs - f.window.launchMs) / 1000;
  const fairingOn = f.vehicle.fairingKg > 0 && tS < Math.max(f.vehicle.fairingSepS, p.boosterSepS ?? 0);
  const attached = {
    boosters: !!f.vehicle.boosters && (p.boosterSepS === null || tS < p.boosterSepS),
    core: tS < p.mecoS + 3,
    fairing: fairingOn,
    upper: tS < departMidS + p.departBurnS / 2 + SEPARATION_DELAY_S,
  };
  const padNow = siteDirection(f.site, ms);

  if (tS < 0) {
    return { r: scale(padNow, EARTH_RADIUS_KM), altKm: 0, speedKms: 0, accelG: 0, massKg: p.liftoffMassKg, phase: "pad", attached, firing: null };
  }
  if (tS < p.parkingInsertionS) {
    const i = Math.min(f.ascent.length - 1, Math.floor(tS));
    const a = f.ascent[i];
    const b = f.ascent[Math.min(f.ascent.length - 1, i + 1)];
    const k = tS - i;
    const alt = a.altKm + (b.altKm - a.altKm) * k;
    const dr = a.downrangeRad + (b.downrangeRad - a.downrangeRad) * k;
    // Blend from the pad's moving position into the inertial plane over the first minute, so the rocket
    // leaves the pad on the globe rather than from where the pad was at liftoff.
    const inPlane = rotate(f.window.padDir, f.window.normal, dr);
    const w = Math.min(1, tS / 60);
    const dir = unit(add(scale(padNow, 1 - w), scale(inPlane, w)));
    const firing = attached.boosters ? "boosters+core" : tS < p.mecoS ? "core" : tS >= p.upperIgnitionS ? "upper" : null;
    return { r: scale(dir, EARTH_RADIUS_KM + alt), altKm: alt, speedKms: a.speedKms + (b.speedKms - a.speedKms) * k, accelG: a.accelG, massKg: a.massKg, phase: "ascent", attached, firing };
  }
  const omega = V_PARKING / PARKING_RADIUS_KM;
  if (tS < departMidS) {
    const dir = rotate(f.insertionDir, f.window.normal, omega * (tS - p.parkingInsertionS));
    const burning = tS >= departMidS - p.departBurnS / 2;
    const frac = burning ? (tS - (departMidS - p.departBurnS / 2)) / Math.max(1, p.departBurnS) : 0;
    const vp = norm(f.perigeeV);
    return {
      r: scale(dir, PARKING_RADIUS_KM),
      altKm: PARKING_ALT_KM,
      speedKms: V_PARKING + (vp - V_PARKING) * frac * 0.5,
      accelG: burning ? (p.upperMdot * f.vehicle.upper.ispVac) / upperMassAt(f, tS) : 0,
      massKg: upperMassAt(f, tS),
      phase: burning ? "burn" : "coast",
      attached,
      firing: burning ? "upper" : null,
    };
  }
  const s = propagate(f.perigeeR, f.perigeeV, tS - departMidS, EARTH_MU);
  const burning = tS < departMidS + p.departBurnS / 2;
  return {
    r: s.r,
    altKm: norm(s.r) - EARTH_RADIUS_KM,
    speedKms: norm(s.v),
    accelG: burning ? (p.upperMdot * f.vehicle.upper.ispVac) / upperMassAt(f, tS) : 0,
    massKg: attached.upper ? upperMassAt(f, tS) : p.payloadKg,
    phase: burning ? "burn" : "escape",
    attached,
    firing: burning ? "upper" : null,
  };
}

/** Mass of upper stage + payload during the coast and the departure burn. */
function upperMassAt(f: Flight, tS: number): number {
  const p = f.perf;
  const upper = p.stages[p.stages.length - 1];
  const departMidS = (f.departMs - f.window.launchMs) / 1000;
  const start = departMidS - p.departBurnS / 2;
  const burnt = Math.max(0, Math.min(p.departBurnS, tS - start)) * p.upperMdot;
  return p.payloadKg + f.vehicle.upper.dryKg + f.vehicle.upper.propKg - (upper.toOrbitKg ?? 0) - burnt;
}

/** Points along the climb, parking orbit and escape hyperbola (geocentric EQJ km), for drawing. */
export function flightPath(f: Flight) {
  const ascent: Vec3[] = f.ascent
    .filter((_, i) => i % 5 === 0)
    .map((a) => scale(rotate(f.window.padDir, f.window.normal, a.downrangeRad), EARTH_RADIUS_KM + a.altKm));
  const parking: Vec3[] = [];
  for (let i = 0; i <= 180; i++) parking.push(scale(rotate(f.insertionDir, f.window.normal, (i / 180) * 2 * Math.PI), PARKING_RADIUS_KM));
  const escape: Vec3[] = [];
  for (let i = 0; i <= 200; i++) {
    // Denser near the planet, then out to about 3 days.
    const t = Math.pow(i / 200, 2) * 3 * 86_400;
    escape.push(propagate(f.perigeeR, f.perigeeV, t, EARTH_MU).r);
  }
  return { ascent, parking, escape };
}

/** Propellant a spacecraft needs for its own braking burn: fraction of its arrival mass, at SPACECRAFT_ISP. */
export function spacecraftPropellantKg(massKg: number, dvKms: number): number {
  return massKg * (1 - Math.exp(-(dvKms * 1000) / (SPACECRAFT_ISP * G0)));
}
