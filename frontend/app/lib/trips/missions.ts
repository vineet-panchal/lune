import { DAY_MS } from "./bodies";
import type { Vec3 } from "./vec";

/**
 * Real missions from the backend (/api/trips): the curated list and each spacecraft's path from JPL Horizons
 * (heliocentric, ecliptic J2000, AU and AU/day). Paths are thinned adaptively, so interpolate with velocities.
 */
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

export type MissionEvent = { time: string; kind: "launch" | "flyby" | "arrival" | "landing" | "milestone" | "end"; label: string; body: string | null };

export type MissionStatus = "operating" | "en-route" | "complete";

export type TripMission = {
  id: string;
  name: string;
  agency: string;
  launchVehicle: string;
  launchSite: string;
  status: MissionStatus;
  targets: string[];
  summary: string;
  dataStart: string;
  dataStop: string;
  events: MissionEvent[];
};

export type Trajectory = { t: number[]; p: number[]; v: number[] };

export type TrajectoryFeed = { data: Trajectory | null; updatedAt: string | null; loading: boolean; error: string | null };

export async function fetchMissions(): Promise<TripMission[]> {
  const res = await fetch(`${API_BASE}/api/trips/missions`);
  if (!res.ok) throw new Error(`Missions: ${res.status}`);
  return res.json();
}

export async function fetchTrajectory(id: string): Promise<TrajectoryFeed> {
  const res = await fetch(`${API_BASE}/api/trips/missions/${encodeURIComponent(id)}/trajectory`);
  if (!res.ok) throw new Error(`Trajectory: ${res.status}`);
  return res.json();
}

/** Index of the last point at or before ms (clamped to a valid segment start). */
function segmentAt(traj: Trajectory, ms: number): number {
  const t = traj.t;
  let lo = 0;
  let hi = t.length - 1;
  if (ms <= t[0]) return 0;
  if (ms >= t[hi]) return hi - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (t[mid] <= ms) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** Position (AU, ecliptic) at a moment by cubic Hermite interpolation; clamped to the path's ends. */
export function trajectoryPosition(traj: Trajectory, ms: number): Vec3 {
  const n = traj.t.length;
  if (n === 0) return [0, 0, 0];
  if (n === 1 || ms <= traj.t[0]) return [traj.p[0], traj.p[1], traj.p[2]];
  if (ms >= traj.t[n - 1]) return [traj.p[(n - 1) * 3], traj.p[(n - 1) * 3 + 1], traj.p[(n - 1) * 3 + 2]];
  return hermite(traj, segmentAt(traj, ms), ms);
}

function hermite(traj: Trajectory, a: number, ms: number): Vec3 {
  const b = a + 1;
  const h = (traj.t[b] - traj.t[a]) / DAY_MS;
  const u = (ms - traj.t[a]) / (traj.t[b] - traj.t[a]);
  const h00 = 2 * u * u * u - 3 * u * u + 1;
  const h10 = u * u * u - 2 * u * u + u;
  const h01 = -2 * u * u * u + 3 * u * u;
  const h11 = u * u * u - u * u;
  const out: Vec3 = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    out[k] = h00 * traj.p[a * 3 + k] + h10 * h * traj.v[a * 3 + k] + h01 * traj.p[b * 3 + k] + h11 * h * traj.v[b * 3 + k];
  }
  return out;
}

/** Speed relative to the Sun, km/s, at a moment (from the nearest point's velocity). */
export function trajectorySpeedKms(traj: Trajectory, ms: number): number {
  const i = segmentAt(traj, ms);
  const j = ms - traj.t[i] > traj.t[i + 1] - ms ? i + 1 : i;
  const kmPerS = 149_597_870.7 / 86_400;
  return Math.hypot(traj.v[j * 3], traj.v[j * 3 + 1], traj.v[j * 3 + 2]) * kmPerS;
}

/**
 * The path drawn as a line: each stored segment split into a few Hermite sub-steps, so flyby bends stay smooth.
 * Returns flat xyz (AU) plus each vertex's time, for drawing "travelled so far" up to a moment.
 */
export function trajectoryPolyline(traj: Trajectory, perSegment = 8): { xyz: Float32Array; times: Float64Array } {
  const n = traj.t.length;
  const count = (n - 1) * perSegment + 1;
  const xyz = new Float32Array(count * 3);
  const times = new Float64Array(count);
  let k = 0;
  for (let i = 0; i < n - 1; i++) {
    for (let s = 0; s < perSegment; s++) {
      const ms = traj.t[i] + ((traj.t[i + 1] - traj.t[i]) * s) / perSegment;
      const p = hermite(traj, i, ms);
      xyz.set(p, k * 3);
      times[k++] = ms;
    }
  }
  xyz.set([traj.p[(n - 1) * 3], traj.p[(n - 1) * 3 + 1], traj.p[(n - 1) * 3 + 2]], k * 3);
  times[k] = traj.t[n - 1];
  return { xyz, times };
}

export const STATUS_LABEL: Record<MissionStatus, string> = { operating: "Operating", "en-route": "En route", complete: "Complete" };
