/**
 * Spring API base. Default "" = same-origin `/api/...` via Next rewrites (next.config.ts),
 * which avoids cross-origin / private-network fetch failures in local dev.
 * Set NEXT_PUBLIC_API_URL when the UI and API are on different hosts (e.g. production).
 */
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

export async function fetchSatellites(
  page = 1,
  pageSize = 20,
  opts?: { search?: string; sort?: string; group?: string; type?: string }
) {
  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
  });
  if (opts?.search) params.set("search", opts.search);
  if (opts?.sort) params.set("sort", opts.sort);
  if (opts?.group) params.set("group", opts.group);
  if (opts?.type) params.set("type", opts.type);
  const url = `${API_BASE}/api/satellites?${params.toString()}`;
  const maxAttempts = 4;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let res: Response;
    try {
      res = await fetch(url);
    } catch (netErr) {
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 250 * attempt));
        continue;
      }
      throw netErr instanceof Error ? netErr : new Error(String(netErr));
    }

    if (res.ok) {
      return res.json();
    }

    if (res.status >= 500 && res.status < 600 && attempt < maxAttempts) {
      await new Promise((r) => setTimeout(r, 250 * attempt));
      continue;
    }

    let msg = `Satellites: ${res.status}`;
    try {
      const text = await res.text();
      if (text) msg += ` — ${text.slice(0, 240)}`;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }

  throw new Error("Satellites: request failed after retries");
}

export async function fetchSatellite(id: number) {
  const res = await fetch(`${API_BASE}/api/satellites/${id}`);
  if (!res.ok) throw new Error(`Satellite ${id}: ${res.status}`);
  return res.json();
}

export async function fetchSatellitePosition(
  id: number,
  datetime?: string
) {
  const q = datetime ? `?datetime=${encodeURIComponent(datetime)}` : "";
  const res = await fetch(`${API_BASE}/api/satellites/${id}/position${q}`);
  if (!res.ok) throw new Error(`Position ${id}: ${res.status}`);
  return res.json();
}

export async function fetchSatelliteTrail(
  id: number,
  trailKm = 30,
  datetime?: string
) {
  const params = new URLSearchParams({ trailKm: String(trailKm) });
  if (datetime) params.set("datetime", datetime);
  const res = await fetch(
    `${API_BASE}/api/satellites/${id}/trail?${params.toString()}`
  );
  if (!res.ok) throw new Error(`Trail ${id}: ${res.status}`);
  return res.json();
}

export async function fetchSatellitePositions(ids: number[], datetime?: string) {
  const params = new URLSearchParams({ ids: ids.join(",") });
  if (datetime) params.set("datetime", datetime);
  const res = await fetch(
    `${API_BASE}/api/satellites/positions?${params.toString()}`
  );
  if (!res.ok) throw new Error(`Positions: ${res.status}`);
  return res.json();
}

export async function fetchLaunches(limit = 20) {
  const res = await fetch(`${API_BASE}/api/launches?limit=${limit}`);
  if (!res.ok) throw new Error(`Launches: ${res.status}`);
  return res.json();
}

export async function fetchLaunchTrajectory(launchId: string) {
  const res = await fetch(
    `${API_BASE}/api/launches/${encodeURIComponent(launchId)}/trajectory`
  );
  if (!res.ok) throw new Error(`Trajectory ${launchId}: ${res.status}`);
  return res.json();
}

export async function planTrajectory(body: {
  originLat: number;
  originLon: number;
  destination: string;
  launchDate?: string;
}) {
  const res = await fetch(`${API_BASE}/api/trajectory/plan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Trajectory plan: ${res.status}`);
  return res.json();
}

export type ClusteringFeaturePoint = {
  satelliteId: number;
  name: string;
  /** Same features in the same order for every point (see lib/clusterFeatures). */
  features: number[];
};

export type ClusterAnalyticsResponse = {
  labels: number[];
  nClusters: number;
  inertia: number | null;
  algorithm?: string;
  noiseCount?: number | null;
};

export type ClusterAnalyticsRequest = {
  algorithm: "kmeans" | "dbscan" | "isolation_forest";
  points: ClusteringFeaturePoint[];
  k?: number;
  dbscanEps?: number;
  dbscanMinSamples?: number;
  isolationContamination?: number;
};

/** Whether Spring can reach the Python analytics service. False on any failure, including Spring being down. */
export async function fetchAnalyticsHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/api/analytics/health`, { cache: "no-store" });
    if (!res.ok) return false;
    const body = await res.json();
    return body?.status === "ok";
  } catch {
    return false;
  }
}

export async function fetchClusterAnalytics(
  body: ClusterAnalyticsRequest
): Promise<ClusterAnalyticsResponse> {
  const res = await fetch(`${API_BASE}/api/analytics/cluster`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let msg = `Clustering failed (${res.status})`;
    try {
      const j = await res.json();
      if (j && typeof j.error === "string") msg = j.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return res.json();
}
