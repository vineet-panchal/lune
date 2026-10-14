/** Colours and names for the labels the analytics service returns, shared by the globe, legend and CSV export. */
export type ClusterAlgorithm = "kmeans" | "gmm" | "dbscan" | "hdbscan" | "isolation_forest";

export const ALGORITHM_LABELS: Record<ClusterAlgorithm, string> = {
  kmeans: "K-means",
  gmm: "Gaussian mixture",
  dbscan: "DBSCAN",
  hdbscan: "HDBSCAN",
  isolation_forest: "Isolation forest",
};

/** Algorithms whose label -1 means "not in any cluster". */
const HAS_NOISE: ClusterAlgorithm[] = ["dbscan", "hdbscan"];

const CLUSTER_PALETTE = [
  "#4fc3f7",
  "#81c784",
  "#ffd54f",
  "#ff8a65",
  "#f06292",
  "#ba68c8",
  "#90a4ae",
  "#fff176",
];

export function clusterLabelToColor(label: number, algorithm: ClusterAlgorithm | null): string {
  if (algorithm && HAS_NOISE.includes(algorithm) && label === -1) return "#78909c";
  if (algorithm === "isolation_forest") {
    if (label === -1) return "#ff6e6e";
    return "#69f0ae";
  }
  return CLUSTER_PALETTE[Math.abs(label) % CLUSTER_PALETTE.length];
}

export function clusterLabelName(algorithm: ClusterAlgorithm, label: number): string {
  if (HAS_NOISE.includes(algorithm) && label === -1) return "Noise (unclustered)";
  if (algorithm === "isolation_forest") {
    if (label === -1) return "Outliers (anomalous)";
    return "Inliers (typical)";
  }
  return `Cluster ${label}`;
}

/** Groups that are "the odd ones out" rather than a cluster: their members get a reason they stand out. */
export function isOutlierGroup(algorithm: ClusterAlgorithm, label: number): boolean {
  return label === -1 && (HAS_NOISE.includes(algorithm) || algorithm === "isolation_forest");
}
