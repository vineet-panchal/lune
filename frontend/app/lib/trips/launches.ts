import type { PlanetId } from "./bodies";
import { LAUNCH_SITES, type LaunchSite } from "./launchSites";
import type { MoonId } from "./moons";
import { VEHICLE_BY_ID, type Vehicle } from "./vehicles";

/**
 * Upcoming launches to planets and moons, from Launch Library 2 via the backend (/api/trips/launches), and how
 * each maps onto what Trips models: the nearest pad it knows and a matching rocket, when there is one.
 */
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

export type UpcomingLaunch = {
  id: string;
  name: string;
  missionName: string | null;
  status: string | null;
  statusName: string | null;
  net: string | null;
  netPrecision: string | null;
  provider: string | null;
  rocket: string | null;
  missionDescription: string | null;
  orbit: string | null;
  padName: string | null;
  location: string | null;
  padLatitude: number | null;
  padLongitude: number | null;
  thumbnailUrl: string | null;
};

export type TripLaunch = { launch: UpcomingLaunch; destination: PlanetId | MoonId; planet: PlanetId; reason: string };

export type TripLaunchFeed = { data: TripLaunch[] | null; updatedAt: string | null; loading: boolean; error: string | null };

export async function fetchTripLaunches(): Promise<TripLaunchFeed> {
  const res = await fetch(`${API_BASE}/api/trips/launches`);
  if (!res.ok) throw new Error(`Launches: ${res.status}`);
  return res.json();
}

/** Launch Library rocket names → the vehicles Trips models. */
const ROCKETS: { match: RegExp; id: string }[] = [
  { match: /falcon heavy/i, id: "falcon-heavy" },
  { match: /falcon 9/i, id: "falcon-9" },
  { match: /atlas v/i, id: "atlas-v-551" },
  { match: /vulcan/i, id: "vulcan-vc6" },
  { match: /\bsls\b|space launch system/i, id: "sls-block-1" },
  { match: /ariane 6/i, id: "ariane-64" },
  { match: /long march 5\b|chang zheng 5\b/i, id: "long-march-5" },
  { match: /\bh3\b/i, id: "h3-24" },
];

export function vehicleFor(rocket: string | null): Vehicle | null {
  if (!rocket) return null;
  const hit = ROCKETS.find((r) => r.match.test(rocket));
  return hit ? VEHICLE_BY_ID.get(hit.id) ?? null : null;
}

/** The modelled pad nearest Launch Library's coordinates, and how far off it is (km). */
export function siteFor(lat: number | null, lng: number | null): { site: LaunchSite; km: number } | null {
  if (lat === null || lng === null) return null;
  let best: { site: LaunchSite; km: number } | null = null;
  for (const site of LAUNCH_SITES) {
    const km = greatCircleKm(lat, lng, site.latDeg, site.lngDeg);
    if (!best || km < best.km) best = { site, km };
  }
  return best;
}

function greatCircleKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const r = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lng2 - lng1) * r) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Launch Library precisions at which the time of day means something (else only the date, or less, is set). */
export const PRECISE = new Set(["SEC", "MIN", "HR"]);
