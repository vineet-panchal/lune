import * as satellite from "satellite.js";
import { Body, Equator, EquatorFromVector, GeoVector, Illumination, Observer as AstroObserver } from "astronomy-engine";
import { sunEci, type Observer } from "../passes";
import type { Constellation, StarCatalog } from "./skyData";

/**
 * Sky positions: equatorial (RA / Dec) ⇄ horizontal (altitude / azimuth) for an observer, star colours, and when
 * and from where a constellation can be seen.
 *
 * Stars are J2000 coordinates and the sidereal time is of date, so positions are off by precession (~0.4° in 2026):
 * invisible at the scale of a constellation, and far below what a sky chart needs.
 */

const DEG = Math.PI / 180;

/** Local sidereal time (radians): Greenwich sidereal time plus the observer's longitude. */
export function localSiderealRad(ms: number, lngDeg: number): number {
  return satellite.gstime(new Date(ms)) + lngDeg * DEG;
}

export type Horizontal = { altDeg: number; azDeg: number };

/** Altitude above the horizon and azimuth (from north, through east) of a point on the sky. */
export function equatorialToHorizontal(raDeg: number, decDeg: number, latDeg: number, lstRad: number): Horizontal {
  const h = lstRad - raDeg * DEG; // hour angle
  const dec = decDeg * DEG;
  const lat = latDeg * DEG;
  const sinAlt = Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(h);
  const az = Math.atan2(-Math.cos(dec) * Math.sin(h), Math.cos(lat) * Math.sin(dec) - Math.sin(lat) * Math.cos(dec) * Math.cos(h));
  return { altDeg: Math.asin(Math.max(-1, Math.min(1, sinAlt))) / DEG, azDeg: (az / DEG + 360) % 360 };
}

/** The inverse: which RA / Dec is at this altitude and azimuth. */
export function horizontalToEquatorial(altDeg: number, azDeg: number, latDeg: number, lstRad: number): { raDeg: number; decDeg: number } {
  const alt = altDeg * DEG;
  const az = azDeg * DEG;
  const lat = latDeg * DEG;
  const sinDec = Math.sin(lat) * Math.sin(alt) + Math.cos(lat) * Math.cos(alt) * Math.cos(az);
  const h = Math.atan2(-Math.sin(az) * Math.cos(alt), Math.cos(lat) * Math.sin(alt) - Math.sin(lat) * Math.cos(alt) * Math.cos(az));
  return { raDeg: (((lstRad - h) / DEG) % 360 + 360) % 360, decDeg: Math.asin(Math.max(-1, Math.min(1, sinDec))) / DEG };
}

/** Every star's altitude and azimuth (degrees) into the given arrays; one pass, for redrawing a sky chart each frame. */
export function starsToHorizontal(stars: StarCatalog, latDeg: number, lstRad: number, alt: Float32Array, az: Float32Array) {
  const sinLat = Math.sin(latDeg * DEG);
  const cosLat = Math.cos(latDeg * DEG);
  for (let i = 0; i < stars.count; i++) {
    const h = lstRad - stars.ra[i] * DEG;
    const dec = stars.dec[i] * DEG;
    const sinDec = Math.sin(dec);
    const cosDec = Math.cos(dec);
    const cosH = Math.cos(h);
    alt[i] = Math.asin(Math.max(-1, Math.min(1, sinLat * sinDec + cosLat * cosDec * cosH))) / DEG;
    az[i] = Math.atan2(-cosDec * Math.sin(h), cosLat * sinDec - sinLat * cosDec * cosH) / DEG;
  }
}

/** The Sun's altitude (degrees) at the observer: below −6° the sky is dark enough to see stars and satellites. */
export function sunAltitudeDeg(observer: Observer, ms: number): number {
  const gd = { latitude: observer.latDeg * DEG, longitude: observer.lngDeg * DEG, height: observer.heightKm ?? 0 };
  return satellite.ecfToLookAngles(gd, satellite.eciToEcf(sunEci(ms), satellite.gstime(new Date(ms)))).elevation / DEG;
}

// ── Star colour ──

/** B−V colour index → RGB (0..1), from blue-white hot stars to orange-red cool ones. */
const BV_STOPS: [number, [number, number, number]][] = [
  [-0.4, [0.61, 0.69, 1.0]],
  [0.0, [0.79, 0.84, 1.0]],
  [0.4, [0.97, 0.97, 1.0]],
  [0.65, [1.0, 0.96, 0.9]],
  [1.0, [1.0, 0.84, 0.64]],
  [1.5, [1.0, 0.72, 0.45]],
  [2.0, [1.0, 0.6, 0.32]],
];

export function bvToRgb(bv: number): [number, number, number] {
  if (!(bv > BV_STOPS[0][0])) return BV_STOPS[0][1];
  for (let i = 1; i < BV_STOPS.length; i++) {
    const [b1, c1] = BV_STOPS[i];
    if (bv <= b1) {
      const [b0, c0] = BV_STOPS[i - 1];
      const t = (bv - b0) / (b1 - b0);
      return [c0[0] + (c1[0] - c0[0]) * t, c0[1] + (c1[1] - c0[1]) * t, c0[2] + (c1[2] - c0[2]) * t];
    }
  }
  return BV_STOPS[BV_STOPS.length - 1][1];
}

export function bvToCss(bv: number, alpha = 1): string {
  const [r, g, b] = bvToRgb(bv);
  return `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)},${alpha})`;
}

// ── When and where a constellation can be seen ──

export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/**
 * The month it's highest in the evening sky (due south or north at about 9 pm). A star crosses the meridian at
 * 9 pm when the Sun's RA is 135° (9 h) less than its own; the Sun's RA is 0 at the March equinox (day 79) and
 * moves ~1° a day.
 */
export function bestEveningMonth(raDeg: number): number {
  const sunRa = (((raDeg - 135) % 360) + 360) % 360;
  const dayOfYear = (79 + (sunRa / 360) * 365.25) % 365.25;
  return Math.min(11, Math.floor((dayOfYear / 365.25) * 12));
}

/** Lowest and highest declination of a constellation's boundary. */
export function declinationRange(c: Constellation): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const ring of c.bounds) {
    for (const [, dec] of ring) {
      min = Math.min(min, dec);
      max = Math.max(max, dec);
    }
  }
  return [min, max];
}

/** Can this declination ever rise from this latitude? */
function rises(decDeg: number, latDeg: number): boolean {
  return latDeg >= 0 ? decDeg > latDeg - 90 : decDeg < latDeg + 90;
}

export type LatitudeVisibility = "full" | "partial" | "never";

/** Whether all, some or none of a constellation ever rises above the horizon from this latitude. */
export function visibilityFrom(c: Constellation, latDeg: number): LatitudeVisibility {
  const [min, max] = declinationRange(c);
  const a = rises(min, latDeg);
  const b = rises(max, latDeg);
  return a && b ? "full" : a || b ? "partial" : "never";
}

/** "90°N to 50°S": the latitudes from which the whole constellation rises. */
export function visibleLatitudes(c: Constellation): string {
  const [min, max] = declinationRange(c);
  // From latitude φ ≥ 0 everything above φ − 90 rises; from φ < 0 everything below φ + 90.
  const north = Math.min(90, Math.round(min + 90));
  const south = Math.max(-90, Math.round(max - 90));
  const fmt = (lat: number) => `${Math.abs(lat)}°${lat >= 0 ? "N" : "S"}`;
  return `${fmt(north)} to ${fmt(south)}`;
}

export type DarkStep = { ms: number; lstRad: number };

/**
 * Moments (every 15 min over the next 24 h) when the observer's sky is dark: Sun below −12°, or −6° where it never
 * gets that dark (summer near the poles). Shared by every constellation's "tonight" check.
 */
export function darkSteps(observer: Observer, fromMs: number): DarkStep[] {
  const steps: { ms: number; sun: number }[] = [];
  for (let ms = fromMs; ms <= fromMs + 86_400_000; ms += 15 * 60_000) steps.push({ ms, sun: sunAltitudeDeg(observer, ms) });
  let dark = steps.filter((s) => s.sun < -12);
  if (dark.length === 0) dark = steps.filter((s) => s.sun < -6);
  return dark.map((s) => ({ ms: s.ms, lstRad: localSiderealRad(s.ms, observer.lngDeg) }));
}

/** Highest point of a sky position during the dark steps, or null if there are none. */
export function bestDuringDark(raDeg: number, decDeg: number, latDeg: number, steps: DarkStep[]): { altDeg: number; azDeg: number; ms: number } | null {
  let best: { altDeg: number; azDeg: number; ms: number } | null = null;
  for (const s of steps) {
    const h = equatorialToHorizontal(raDeg, decDeg, latDeg, s.lstRad);
    if (!best || h.altDeg > best.altDeg) best = { ...h, ms: s.ms };
  }
  return best;
}

// ── Sun, Moon and planets ──

export type SkyBody = {
  id: string;
  name: string;
  raDeg: number;
  decDeg: number;
  /** Apparent magnitude (smaller is brighter). */
  mag: number;
  color: string;
  /** Moon only: lit fraction 0..1. */
  phase?: number;
};

const BODIES: { body: Body; name: string; color: string }[] = [
  { body: Body.Sun, name: "Sun", color: "#ffe082" },
  { body: Body.Moon, name: "Moon", color: "#eceff1" },
  { body: Body.Mercury, name: "Mercury", color: "#bcaaa4" },
  { body: Body.Venus, name: "Venus", color: "#fff8e1" },
  { body: Body.Mars, name: "Mars", color: "#ff8a65" },
  { body: Body.Jupiter, name: "Jupiter", color: "#ffe0b2" },
  { body: Body.Saturn, name: "Saturn", color: "#ffecb3" },
  { body: Body.Uranus, name: "Uranus", color: "#b2ebf2" },
  { body: Body.Neptune, name: "Neptune", color: "#90caf9" },
];

/**
 * Where the Sun, Moon and planets are against the stars (J2000, like the star catalogue). Seen from the observer if
 * given (the Moon shifts by up to 1° depending on where you stand), otherwise from the centre of the Earth.
 */
export function solarSystemBodies(ms: number, observer: Observer | null): SkyBody[] {
  const date = new Date(ms);
  const where = observer ? new AstroObserver(observer.latDeg, observer.lngDeg, (observer.heightKm ?? 0) * 1000) : null;
  return BODIES.map(({ body, name, color }) => {
    const eq = where ? Equator(body, date, where, false, true) : EquatorFromVector(GeoVector(body, date, true));
    const illumination = Illumination(body, date);
    return {
      id: name.toLowerCase(),
      name,
      raDeg: eq.ra * 15,
      decDeg: eq.dec,
      mag: illumination.mag,
      color,
      phase: body === Body.Moon ? illumination.phase_fraction : undefined,
    };
  });
}
