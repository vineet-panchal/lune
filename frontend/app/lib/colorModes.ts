import type * as satellite from "satellite.js";
import { parseLaunch } from "./orbitInfo";

/**
 * "Colour by" modes for the satellite dots. Altitude depends on where each satellite is right now,
 * so GlobeView colours it per update; every other mode depends only on the TLE, so colours are
 * computed once per catalog load and looked up.
 */
export type ColorMode =
  | "altitude"
  | "period"
  | "inclination"
  | "plane"
  | "shape"
  | "constellation"
  | "launch"
  | "launchYear"
  | "tleAge";

export const COLOR_MODE_GROUPS: { label: string; modes: { id: ColorMode; label: string }[] }[] = [
  {
    label: "Orbit",
    modes: [
      { id: "altitude", label: "Altitude" },
      { id: "period", label: "Orbital period" },
      { id: "inclination", label: "Inclination" },
      { id: "plane", label: "Orbital plane" },
      { id: "shape", label: "Orbit shape" },
    ],
  },
  {
    label: "Origin",
    modes: [
      { id: "constellation", label: "Constellation" },
      { id: "launch", label: "Launch" },
      { id: "launchYear", label: "Launch year" },
    ],
  },
  { label: "Data", modes: [{ id: "tleAge", label: "TLE age" }] },
];

export function isColorMode(value: string | null): value is ColorMode {
  return COLOR_MODE_GROUPS.some((g) => g.modes.some((m) => m.id === value));
}

export type LegendItem = { key: string; label: string; detail?: string; color: string; count: number };

export type StaticColoring = {
  colorById: Map<number, string>;
  /** Bands in order (banded modes) or largest groups first (constellation, launch). */
  legend: LegendItem[];
  /** Constellation and launch have open-ended groups, so the legend is truncated; bands are always listed in full. */
  categorical: boolean;
};

type ColorableSat = { satelliteId: number; name: string; satrec: satellite.SatRec; line1?: string };

type Band = { label: string; detail: string; max: number; color: string };

const RAD_TO_DEG = 180 / Math.PI;

const PERIOD_BANDS: Band[] = [
  { label: "Under 90 min", detail: "very low orbit", max: 90, color: "#00e5ff" },
  { label: "90–100 min", detail: "e.g. ISS, Starlink", max: 100, color: "#76ff03" },
  { label: "100–128 min", detail: "upper LEO, e.g. OneWeb", max: 128, color: "#ffeb3b" },
  { label: "2–12 h", detail: "medium orbit, e.g. GPS", max: 720, color: "#ff9800" },
  { label: "12–23 h", detail: "high orbit", max: 1380, color: "#ff5252" },
  { label: "~24 h", detail: "geosynchronous", max: 1500, color: "#e040fb" },
  { label: "Over 25 h", detail: "beyond GEO", max: Infinity, color: "#82b1ff" },
];

const INCLINATION_BANDS: Band[] = [
  { label: "Equatorial", detail: "0–30°", max: 30, color: "#4fc3f7" },
  { label: "Mid-inclination", detail: "30–60°", max: 60, color: "#76ff03" },
  { label: "High-inclination", detail: "60–80°", max: 80, color: "#ffeb3b" },
  { label: "Polar", detail: "80–95°", max: 95, color: "#ff9800" },
  { label: "Sun-synchronous / retrograde", detail: "95–180°", max: Infinity, color: "#e040fb" },
];

/** Right ascension of the ascending node (RAAN) in 30° slices; satellites in the same orbital plane share a slice. */
const PLANE_BANDS: Band[] = Array.from({ length: 12 }, (_, i) => ({
  label: `Plane ${i * 30}–${i * 30 + 30}°`,
  detail: "",
  max: i * 30 + 30,
  color: `hsl(${i * 30}, 90%, 60%)`,
}));

const SHAPE_BANDS: Band[] = [
  { label: "Circular", detail: "eccentricity < 0.01", max: 0.01, color: "#4fc3f7" },
  { label: "Near-circular", detail: "0.01–0.1", max: 0.1, color: "#76ff03" },
  { label: "Elliptical", detail: "0.1–0.5", max: 0.5, color: "#ffeb3b" },
  { label: "Highly elliptical", detail: "over 0.5", max: Infinity, color: "#ff5252" },
];

/** Oldest to newest, on a purple → yellow gradient. */
const LAUNCH_YEAR_BANDS: Band[] = [
  { label: "Before 2000", detail: "", max: 2000, color: "#440154" },
  { label: "2000–2009", detail: "", max: 2010, color: "#482878" },
  { label: "2010–2017", detail: "", max: 2018, color: "#3e4a89" },
  { label: "2018–2019", detail: "", max: 2020, color: "#31688e" },
  { label: "2020", detail: "", max: 2021, color: "#26828e" },
  { label: "2021", detail: "", max: 2022, color: "#1f9e89" },
  { label: "2022", detail: "", max: 2023, color: "#35b779" },
  { label: "2023", detail: "", max: 2024, color: "#6ece58" },
  { label: "2024", detail: "", max: 2025, color: "#b5de2b" },
  { label: "2025 and later", detail: "", max: Infinity, color: "#fde725" },
];

/** Age of the TLE (time since its epoch) in days: fresh data is green, stale data red. */
const TLE_AGE_BANDS: Band[] = [
  { label: "Under 1 day", detail: "fresh", max: 1, color: "#00e676" },
  { label: "1–3 days", detail: "", max: 3, color: "#b2ff59" },
  { label: "3–7 days", detail: "", max: 7, color: "#ffeb3b" },
  { label: "7–30 days", detail: "drifting", max: 30, color: "#ff9800" },
  { label: "Over 30 days", detail: "stale or decayed", max: Infinity, color: "#ff5252" },
];

/** Distinct colours for categories, assigned to the largest groups first and reused after that. */
const CATEGORY_PALETTE = [
  "#4fc3f7", "#76ff03", "#ffeb3b", "#ff9800", "#e040fb", "#ff5252",
  "#18ffff", "#b2ff59", "#ffd180", "#ea80fc", "#82b1ff", "#f4ff81",
];
const UNKNOWN_COLOR = "#9e9e9e";

export function computeStaticColoring(mode: ColorMode, sats: ColorableSat[], now = new Date()): StaticColoring | null {
  switch (mode) {
    case "altitude":
      return null;
    case "period":
      return colorByBands(sats, PERIOD_BANDS, (s) => (2 * Math.PI) / s.satrec.no);
    case "inclination":
      return colorByBands(sats, INCLINATION_BANDS, (s) => s.satrec.inclo * RAD_TO_DEG);
    case "plane":
      return colorByBands(sats, PLANE_BANDS, (s) => normalizeDeg(s.satrec.nodeo * RAD_TO_DEG));
    case "shape":
      return colorByBands(sats, SHAPE_BANDS, (s) => s.satrec.ecco);
    case "launchYear":
      return colorByBands(sats, LAUNCH_YEAR_BANDS, (s) => parseLaunch(s.line1)?.year ?? null);
    case "tleAge":
      return colorByBands(sats, TLE_AGE_BANDS, (s) => (now.getTime() - jdToMs(s.satrec.jdsatepoch)) / 86_400_000);
    case "constellation":
      return colorByCategory(sats, constellationOf);
    case "launch":
      return colorByCategory(sats, (s) => parseLaunch(s.line1)?.launch ?? null);
  }
}

function colorByBands(sats: ColorableSat[], bands: Band[], valueOf: (s: ColorableSat) => number | null): StaticColoring {
  const colorById = new Map<number, string>();
  const counts = bands.map(() => 0);
  let unknown = 0;
  for (const s of sats) {
    const value = valueOf(s);
    const band = value === null || Number.isNaN(value) ? -1 : bands.findIndex((b) => value < b.max);
    if (band < 0) {
      unknown++;
      colorById.set(s.satelliteId, UNKNOWN_COLOR);
      continue;
    }
    counts[band]++;
    colorById.set(s.satelliteId, bands[band].color);
  }
  const legend: LegendItem[] = bands.map((b, i) => ({
    key: b.label,
    label: b.label,
    detail: b.detail || undefined,
    color: b.color,
    count: counts[i],
  }));
  if (unknown > 0) legend.push({ key: "Unknown", label: "Unknown", color: UNKNOWN_COLOR, count: unknown });
  return { colorById, legend, categorical: false };
}

function colorByCategory(sats: ColorableSat[], keyOf: (s: ColorableSat) => string | null): StaticColoring {
  const groups = new Map<string, number[]>();
  for (const s of sats) {
    const key = keyOf(s) ?? "Unknown";
    const ids = groups.get(key);
    if (ids) ids.push(s.satelliteId);
    else groups.set(key, [s.satelliteId]);
  }
  const ranked = [...groups.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  const colorById = new Map<number, string>();
  const legend: LegendItem[] = ranked.map(([key, ids], rank) => {
    const color = key === "Unknown" ? UNKNOWN_COLOR : CATEGORY_PALETTE[rank % CATEGORY_PALETTE.length];
    for (const id of ids) colorById.set(id, color);
    return { key, label: key, color, count: ids.length };
  });
  return { colorById, legend, categorical: true };
}

/** "STARLINK-1007" → "STARLINK", "ONEWEB-0290" → "ONEWEB", "ISS (ZARYA)" → "ISS". */
function constellationOf(s: ColorableSat): string | null {
  const first = s.name.trim().toUpperCase().split(/[\s\-(/]+/)[0];
  return first || null;
}

function normalizeDeg(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

function jdToMs(jd: number): number {
  return (jd - 2440587.5) * 86_400_000;
}
