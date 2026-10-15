import { useEffect, useState } from "react";

/**
 * Mission Control data: outside feeds the backend caches (news, launches, crew, space weather, flybys) and what
 * Lune's own catalog shows. Every endpoint answers at once from the backend's memory; loading=true means a download
 * is still running, so ask again shortly.
 */
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

export type Feed<T> = { data: T | null; updatedAt: string | null; loading: boolean; error: string | null };

export type NewsArticle = {
  id: number;
  title: string;
  summary: string | null;
  url: string;
  imageUrl: string | null;
  site: string | null;
  publishedAt: string;
  /** Launch Library ids of the launches the article is about. */
  launchIds: string[];
};

export type Launch = {
  id: string;
  name: string;
  missionName: string | null;
  /** "Go", "TBD", "TBC", "Hold", "In Flight", "Success", "Failure", "Partial Failure". */
  status: string | null;
  statusName: string | null;
  net: string;
  /** "MIN", "HR", "DAY", "MONTH", "Q", "Y"... how exact net is. */
  netPrecision: string | null;
  windowStart: string | null;
  windowEnd: string | null;
  provider: string | null;
  rocket: string | null;
  missionType: string | null;
  missionDescription: string | null;
  orbit: string | null;
  padName: string | null;
  location: string | null;
  countryCode: string | null;
  padLatitude: number | null;
  padLongitude: number | null;
  imageUrl: string | null;
  thumbnailUrl: string | null;
  /** "2026-234" once it has flown: its satellites' TLEs carry this designator. */
  designator: string | null;
  webcastLive: boolean;
  videoUrl: string | null;
  failReason: string | null;
  probability: number | null;
};

export type CrewMember = {
  name: string;
  role: string | null;
  agency: string | null;
  countryCode: string | null;
  imageUrl: string | null;
  wikiUrl: string | null;
  flights: number | null;
  /** ISO-8601 duration, e.g. "P182DT23H17M53S". */
  timeInSpace: string | null;
};

export type Expedition = { name: string; station: string; stationNoradId: number | null; start: string | null; crew: CrewMember[] };

export type KpPoint = { time: string; kp: number; kind: "observed" | "estimated" | "predicted"; scale: string | null };
export type ScaleLevels = { r: number; s: number; g: number };
export type ScaleOutlook = { date: string; rMinorPercent: number | null; rMajorPercent: number | null; sPercent: number | null; g: number };
export type SpaceWeather = {
  kp: Feed<KpPoint[]>;
  scales: Feed<{ now: ScaleLevels; last24h: ScaleLevels; forecast: ScaleOutlook[] }>;
  flare: Feed<{ peakClass: string | null; peakTime: string | null; beginTime: string | null; endTime: string | null; currentClass: string | null }>;
};

export type Flyby = {
  designation: string;
  time: string;
  distanceKm: number;
  lunarDistances: number;
  speedKmS: number;
  magnitude: number;
  diameterMinM: number;
  diameterMaxM: number;
};

export type OrbitChangeSummary = {
  satelliteId: number;
  name: string;
  latestAltitudeKm: number;
  altitudeRateKmPerDay: number | null;
  daysToReentry: number | null;
};

export type Manoeuvre = {
  satelliteId: number;
  name: string;
  type: "raise" | "lower" | "plane_change";
  at: string;
  deltaAltitudeKm: number;
  deltaInclinationDeg: number;
  altitudeKm: number;
};

export type LaunchObjects = { designator: string; count: number; names: string[]; ids: number[] };

export type CatalogPulse = {
  tracked: number;
  catalogUpdatedAt: string | null;
  loading: boolean;
  historySince: string | null;
  withHistory: number;
  reentries: OrbitChangeSummary[];
  manoeuvreCounts: Record<string, number>;
  manoeuvres: Manoeuvre[];
  launches: LaunchObjects[];
};

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

/** How soon to ask again while the backend is still downloading something. */
const LOADING_RETRY_MS = 4000;

/**
 * Fetch an endpoint, then again every refreshMs (sooner while the backend reports loading). The last good answer is
 * kept if a later request fails.
 */
export function usePolled<T>(path: string, refreshMs: number, isLoading: (value: T) => boolean): { value: T | null; failed: boolean } {
  const [value, setValue] = useState<T | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let timer = 0;
    let cancelled = false;
    const load = async () => {
      let next = refreshMs;
      try {
        const v = await getJson<T>(path);
        if (cancelled) return;
        setValue(v);
        setFailed(false);
        if (isLoading(v)) next = LOADING_RETRY_MS;
      } catch {
        if (!cancelled) setFailed(true);
        next = Math.min(refreshMs, 30_000);
      }
      if (!cancelled) timer = window.setTimeout(load, next);
    };
    void load();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // isLoading is a pure function of the response; a new closure each render shouldn't restart polling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, refreshMs]);
  return { value, failed };
}

export function useFeed<T>(path: string, refreshMs: number) {
  return usePolled<Feed<T>>(path, refreshMs, (f) => f.loading && f.data === null);
}

/** Launch Library still lists a launch as "upcoming" for a while after it has flown. */
const FLOWN = new Set(["Success", "Failure", "Partial Failure"]);
export function hasFlown(launch: Launch): boolean {
  return launch.status !== null && FLOWN.has(launch.status);
}

const MAX_LINK_IDS = 400;

/**
 * A Satellite Tracker link. With `ids` the tracker shows exactly those satellites (e.g. one launch's); `select`
 * picks up to 10 of them, and a single one is followed.
 */
export function trackerLink({ ids, select = [], label }: { ids?: number[]; select?: number[]; label?: string }): string {
  const params = new URLSearchParams();
  // The list travels in the URL; past a few hundred satellites it outgrows what servers accept in a request line.
  if (ids && ids.length > 0) params.set("ids", ids.slice(0, MAX_LINK_IDS).join(","));
  if (label) params.set("label", label);
  const picked = select.slice(0, 10);
  if (picked.length > 0) params.set("sats", picked.join(","));
  if (picked.length === 1) params.set("follow", String(picked[0]));
  return `/?${params.toString().replace(/%2C/g, ",")}`;
}

/** "in 2 d 4 h", "in 3 h 12 m", "5 m ago". */
export function relativeTime(ms: number, nowMs: number): string {
  const diff = ms - nowMs;
  const abs = Math.abs(diff);
  const m = Math.round(abs / 60_000);
  let text: string;
  if (m < 1) text = "now";
  else if (m < 60) text = `${m} m`;
  else if (m < 48 * 60) text = `${Math.floor(m / 60)} h${m % 60 && m < 600 ? ` ${m % 60} m` : ""}`;
  else text = `${Math.floor(m / 1440)} d${Math.floor((m % 1440) / 60) ? ` ${Math.floor((m % 1440) / 60)} h` : ""}`;
  if (text === "now") return text;
  return diff > 0 ? `in ${text}` : `${text} ago`;
}

/** Days from an ISO-8601 duration ("P182DT23H17M53S" → 182.96). */
export function durationDays(iso: string | null): number | null {
  const m = iso?.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?/);
  if (!m) return null;
  return Number(m[1] ?? 0) + Number(m[2] ?? 0) / 24 + Number(m[3] ?? 0) / 1440;
}

/** 🇺🇸 from "US". */
export function flag(countryCode: string | null): string {
  if (!countryCode || countryCode.length !== 2) return "";
  return String.fromCodePoint(...[...countryCode.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}
