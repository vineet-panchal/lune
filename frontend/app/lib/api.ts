const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8080";

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
  const res = await fetch(`${API_BASE}/api/satellites?${params.toString()}`);
  if (!res.ok) throw new Error(`Satellites: ${res.status}`);
  return res.json();
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
  altitudeKm: number;
  inclinationDeg: number;
  meanMotionRpd: number;
};

export type KMeansClusterResponse = {
  labels: number[];
  nClusters: number;
  inertia: number | null;
};

export async function fetchKMeansClusters(body: {
  k: number;
  points: ClusteringFeaturePoint[];
}): Promise<KMeansClusterResponse> {
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
