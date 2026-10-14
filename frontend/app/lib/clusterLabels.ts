/** Colours and names for the labels the analytics service returns, shared by the globe, legend and CSV export. */
export type ClusterAlgorithm = "kmeans" | "dbscan" | "isolation_forest";

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
  if (algorithm === "dbscan" && label === -1) return "#78909c";
  if (algorithm === "isolation_forest") {
    if (label === -1) return "#ff6e6e";
    return "#69f0ae";
  }
  return CLUSTER_PALETTE[Math.abs(label) % CLUSTER_PALETTE.length];
}

export function clusterLabelName(algorithm: ClusterAlgorithm, label: number): string {
  if (algorithm === "dbscan" && label === -1) return "Noise (unclustered)";
  if (algorithm === "isolation_forest") {
    if (label === -1) return "Outliers (anomalous)";
    return "Inliers (typical)";
  }
  return `Cluster ${label}`;
}
