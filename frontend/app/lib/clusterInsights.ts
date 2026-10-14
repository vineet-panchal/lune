import type { ClusterRun } from "./clusterExport";
import type { OrbitQuantities } from "./clusterFeatures";

/** Summary of one group's orbits, for the cluster inspector. */
export type ClusterStats = {
  count: number;
  altitudeKm: Range;
  inclinationDeg: Range;
  /** Circular mean of the orbital planes, and how widely they spread (circular std, degrees). */
  raanMeanDeg: number;
  raanSpreadDeg: number;
  periodMinMean: number;
};

type Range = { mean: number; min: number; max: number };

export function clusterStats(members: OrbitQuantities[]): ClusterStats | null {
  if (members.length === 0) return null;
  const range = (pick: (q: OrbitQuantities) => number): Range => {
    let sum = 0;
    let min = Infinity;
    let max = -Infinity;
    for (const q of members) {
      const v = pick(q);
      sum += v;
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
    return { mean: sum / members.length, min, max };
  };
  let s = 0;
  let c = 0;
  for (const q of members) {
    s += Math.sin(q.raanDeg * DEG);
    c += Math.cos(q.raanDeg * DEG);
  }
  const meanResultant = Math.min(1, Math.hypot(s, c) / members.length);
  const raanMean = (Math.atan2(s, c) / DEG + 360) % 360;
  return {
    count: members.length,
    altitudeKm: range((q) => q.altitudeKm),
    inclinationDeg: range((q) => q.inclinationDeg),
    raanMeanDeg: raanMean,
    raanSpreadDeg: Math.sqrt(-2 * Math.log(Math.max(meanResultant, 1e-9))) / DEG,
    periodMinMean: range((q) => q.periodMin).mean,
  };
}

/** Why one satellite stands out: the feature furthest from typical (score: robust standard deviations, for ranking). */
export type OutlierReason = { text: string; score: number };

/**
 * For every member of an outlier group (label -1: DBSCAN / HDBSCAN noise, isolation-forest anomalies), the feature
 * that sets it apart most from the satellites that were clustered normally. Distances use the median and MAD, so
 * the outliers themselves don't drag "typical" towards them.
 */
export function explainOutliers(run: ClusterRun, label = -1): Map<number, OutlierReason> {
  const reference = run.rows.filter((r) => r.label !== label);
  const base = reference.length >= 2 ? reference : run.rows;
  const columns = run.featureNames.map((name, i) => {
    const values = base.map((r) => r.features[i]);
    const median = quantile(values, 0.5);
    let spread = 1.4826 * quantile(values.map((v) => Math.abs(v - median)), 0.5);
    if (!(spread > 0)) spread = std(values);
    return { name, i, median, spread };
  });

  const reasons = new Map<number, OutlierReason>();
  for (const row of run.rows) {
    if (row.label !== label) continue;
    let best: { text: string; score: number } | null = null;
    for (const col of columns) {
      if (!(col.spread > 0)) continue;
      const z = (row.features[col.i] - col.median) / col.spread;
      if (best && Math.abs(z) <= best.score) continue;
      best = { text: describe(col.name, row.features[col.i], col.median), score: Math.abs(z) };
    }
    if (best) reasons.set(row.satelliteId, best);
  }
  return reasons;
}

/**
 * A readable reason for one feature column (names from clusterFeatures.featureNames). Scores rank the members but
 * aren't shown: a fleet like Starlink has near-identical inclinations, so robust σ values run into the hundreds.
 */
function describe(name: string, value: number, typical: number): string {
  switch (name) {
    case "mean_altitude_km":
      return `altitude ${Math.round(value)} km vs typical ${Math.round(typical)} km`;
    case "inclination_deg":
      return `inclination ${value.toFixed(1)}° vs typical ${typical.toFixed(1)}°`;
    case "raan_sin":
    case "raan_cos":
      return "in an orbital plane few others share";
    case "eccentricity":
      return `eccentricity ${value.toFixed(4)} vs typical ${typical.toFixed(4)}`;
    default:
      return "positioned far from the other satellites";
  }
}

const DEG = Math.PI / 180;

function quantile(values: number[], q: number): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function std(values: number[]): number {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((a, v) => a + (v - mean) ** 2, 0) / values.length);
}
