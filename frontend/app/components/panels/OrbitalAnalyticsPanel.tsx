"use client";

import { useState } from "react";

export type ClusterAlgorithm = "kmeans" | "dbscan" | "isolation_forest";

export type ClusterSummary = {
  algorithm: ClusterAlgorithm;
  nClusters: number;
  inertia: number | null;
  sizes: Record<number, number>;
  noiseCount: number | null;
  paramsLine: string;
};

export type ClusterRunPayload =
  | { algorithm: "kmeans"; k: number }
  | { algorithm: "dbscan"; eps: number; minSamples: number }
  | { algorithm: "isolation_forest"; contamination: number };

type OrbitalAnalyticsPanelProps = {
  satelliteSampleCount: number;
  satelliteTotalCount: number;
  loadingCatalog: boolean;
  clusteringBusy: boolean;
  clusterError: string | null;
  clusterSummary: ClusterSummary | null;
  onRunClustering: (payload: ClusterRunPayload) => void;
  onClearClustering: () => void;
};

const ALGO_OPTIONS: { id: ClusterAlgorithm; label: string }[] = [
  { id: "kmeans", label: "K-means" },
  { id: "dbscan", label: "DBSCAN" },
  { id: "isolation_forest", label: "Isolation forest" },
];

function formatSizeLabel(algorithm: ClusterAlgorithm, label: number): string {
  if (algorithm === "dbscan" && label === -1) return "Noise (unclustered)";
  if (algorithm === "isolation_forest") {
    if (label === -1) return "Outliers (anomalous)";
    return "Inliers (typical)";
  }
  return `Cluster ${label}`;
}

export default function OrbitalAnalyticsPanel({
  satelliteSampleCount,
  satelliteTotalCount,
  loadingCatalog,
  clusteringBusy,
  clusterError,
  clusterSummary,
  onRunClustering,
  onClearClustering,
}: OrbitalAnalyticsPanelProps) {
  const [algorithm, setAlgorithm] = useState<ClusterAlgorithm>("kmeans");
  const [k, setK] = useState(5);
  const [dbscanEps, setDbscanEps] = useState(0.4);
  const [dbscanMinSamples, setDbscanMinSamples] = useState(5);
  const [isolationContamination, setIsolationContamination] = useState(0.06);

  const maxK = Math.max(2, Math.min(12, satelliteSampleCount || 2));
  const kEffective = Math.min(k, maxK);

  const canRunKMeans =
    !loadingCatalog &&
    !clusteringBusy &&
    satelliteSampleCount >= 2 &&
    kEffective >= 2 &&
    kEffective <= satelliteSampleCount;

  const canRunDbscan =
    !loadingCatalog && !clusteringBusy && satelliteSampleCount >= 2 && dbscanMinSamples <= satelliteSampleCount;

  const canRunIsolation =
    !loadingCatalog && !clusteringBusy && satelliteSampleCount >= 2;

  const canRun =
    algorithm === "kmeans" ? canRunKMeans : algorithm === "dbscan" ? canRunDbscan : canRunIsolation;

  const run = () => {
    if (!canRun) return;
    if (algorithm === "kmeans") {
      onRunClustering({ algorithm: "kmeans", k: Math.min(kEffective, Math.max(2, satelliteSampleCount)) });
      return;
    }
    if (algorithm === "dbscan") {
      onRunClustering({
        algorithm: "dbscan",
        eps: dbscanEps,
        minSamples: Math.min(dbscanMinSamples, satelliteSampleCount),
      });
      return;
    }
    onRunClustering({ algorithm: "isolation_forest", contamination: isolationContamination });
  };

  const algoTitle =
    algorithm === "kmeans"
      ? "K-means partitions satellites into k spatial groups."
      : algorithm === "dbscan"
        ? "DBSCAN finds density-based clusters and marks sparse points as noise."
        : "Isolation forest highlights points that look unlike the bulk of the fleet (anomalies).";

  return (
    <aside
      style={{
        position: "absolute",
        top: 0,
        right: 0,
        bottom: 0,
        width: 392,
        boxSizing: "border-box",
        padding: "72px 18px 20px",
        background: "linear-gradient(180deg, rgba(6,8,14,0.92) 0%, rgba(4,6,12,0.96) 100%)",
        borderLeft: "1px solid rgba(255,255,255,0.10)",
        color: "#e8ecf4",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        fontSize: 12,
        zIndex: 8,
        overflowY: "auto",
        backdropFilter: "blur(10px)",
      }}
    >
      <div style={{ fontWeight: 700, fontSize: 13, letterSpacing: 0.6, marginBottom: 6 }}>
        Orbital analytics
      </div>
      <p style={{ margin: "0 0 16px", color: "rgba(220,228,240,0.72)", lineHeight: 1.5 }}>
        Each satellite is a point in Earth-centered Cartesian space (x, y, z in km) from its current propagated
        position. Models run in the Python analytics service (scikit-learn) via Spring Boot; the globe colors
        update from the returned labels.
      </p>

      <section
        style={{
          padding: 14,
          borderRadius: 10,
          background: "rgba(255,255,255,0.04)",
          border: "1px solid rgba(255,255,255,0.08)",
          marginBottom: 14,
        }}
      >
        <div style={{ fontWeight: 600, marginBottom: 10, color: "#c5d5f1" }}>Model</div>
        <div
          role="tablist"
          aria-label="Clustering model"
          style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}
        >
          {ALGO_OPTIONS.map((opt) => {
            const active = algorithm === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setAlgorithm(opt.id)}
                disabled={clusteringBusy}
                style={{
                  padding: "6px 10px",
                  borderRadius: 8,
                  border: active ? "1px solid rgba(123, 164, 232, 0.75)" : "1px solid rgba(255,255,255,0.12)",
                  background: active ? "rgba(86, 132, 214, 0.35)" : "rgba(255,255,255,0.05)",
                  color: active ? "#e8f0ff" : "rgba(200,210,230,0.75)",
                  cursor: clusteringBusy ? "not-allowed" : "pointer",
                  fontFamily: "inherit",
                  fontSize: 11,
                  fontWeight: 600,
                }}
              >
                {opt.label}
              </button>
            );
          })}
        </div>

        <p style={{ margin: "0 0 12px", fontSize: 11, color: "rgba(190,200,220,0.7)", lineHeight: 1.45 }}>
          {algoTitle}
        </p>

        {algorithm === "kmeans" && (
          <>
            <label style={{ display: "block", fontSize: 11, color: "rgba(200,210,230,0.65)", marginBottom: 6 }}>
              Clusters (k)
            </label>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <input
                type="range"
                min={2}
                max={maxK}
                step={1}
                value={kEffective}
                onChange={(e) => setK(parseInt(e.target.value, 10))}
                disabled={satelliteSampleCount < 2}
                style={{ flex: "1 1 140px", minWidth: 120 }}
              />
              <span style={{ minWidth: 28, textAlign: "right", color: "rgba(200,210,230,0.85)" }}>
                {kEffective}
              </span>
            </div>
          </>
        )}

        {algorithm === "dbscan" && (
          <>
            <label style={{ display: "block", fontSize: 11, color: "rgba(200,210,230,0.65)", marginBottom: 6 }}>
              Neighborhood radius (eps, standardized feature space)
            </label>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
              <input
                type="range"
                min={0.15}
                max={1.2}
                step={0.05}
                value={dbscanEps}
                onChange={(e) => setDbscanEps(parseFloat(e.target.value))}
                disabled={satelliteSampleCount < 2}
                style={{ flex: "1 1 140px", minWidth: 120 }}
              />
              <span style={{ minWidth: 40, textAlign: "right", color: "rgba(200,210,230,0.85)" }}>
                {dbscanEps.toFixed(2)}
              </span>
            </div>
            <label style={{ display: "block", fontSize: 11, color: "rgba(200,210,230,0.65)", marginBottom: 6 }}>
              Min. points to form a cluster
            </label>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <input
                type="range"
                min={2}
                max={Math.max(2, Math.min(20, satelliteSampleCount || 2))}
                step={1}
                value={Math.min(dbscanMinSamples, satelliteSampleCount || 2)}
                onChange={(e) => setDbscanMinSamples(parseInt(e.target.value, 10))}
                disabled={satelliteSampleCount < 2}
                style={{ flex: "1 1 140px", minWidth: 120 }}
              />
              <span style={{ minWidth: 28, textAlign: "right", color: "rgba(200,210,230,0.85)" }}>
                {Math.min(dbscanMinSamples, satelliteSampleCount || 2)}
              </span>
            </div>
          </>
        )}

        {algorithm === "isolation_forest" && (
          <>
            <label style={{ display: "block", fontSize: 11, color: "rgba(200,210,230,0.65)", marginBottom: 6 }}>
              Expected fraction of outliers (contamination)
            </label>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <input
                type="range"
                min={0.02}
                max={0.18}
                step={0.01}
                value={isolationContamination}
                onChange={(e) => setIsolationContamination(parseFloat(e.target.value))}
                disabled={satelliteSampleCount < 2}
                style={{ flex: "1 1 140px", minWidth: 120 }}
              />
              <span style={{ minWidth: 44, textAlign: "right", color: "rgba(200,210,230,0.85)" }}>
                {(100 * isolationContamination).toFixed(0)}%
              </span>
            </div>
          </>
        )}

        <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
          <button
            type="button"
            disabled={!canRun}
            onClick={run}
            style={{
              padding: "8px 14px",
              borderRadius: 8,
              border: "1px solid rgba(123, 164, 232, 0.45)",
              background: canRun ? "rgba(86, 132, 214, 0.28)" : "rgba(80,80,90,0.25)",
              color: canRun ? "#e8f0ff" : "rgba(255,255,255,0.35)",
              cursor: canRun ? "pointer" : "not-allowed",
              fontFamily: "inherit",
              fontSize: 11,
              fontWeight: 600,
            }}
          >
            {clusteringBusy ? "Running…" : "Run model"}
          </button>
          <button
            type="button"
            disabled={clusteringBusy || !clusterSummary}
            onClick={onClearClustering}
            style={{
              padding: "8px 14px",
              borderRadius: 8,
              border: "1px solid rgba(255,255,255,0.14)",
              background: "rgba(255,255,255,0.06)",
              color: clusterSummary && !clusteringBusy ? "rgba(230,236,246,0.85)" : "rgba(255,255,255,0.35)",
              cursor: clusterSummary && !clusteringBusy ? "pointer" : "not-allowed",
              fontFamily: "inherit",
              fontSize: 11,
            }}
          >
            Clear coloring
          </button>
        </div>
        <div style={{ marginTop: 10, fontSize: 10, color: "rgba(180,190,210,0.55)" }}>
          Loaded for analysis: {satelliteSampleCount.toLocaleString()} / {satelliteTotalCount.toLocaleString()}{" "}
          satellites
        </div>
      </section>

      {clusterError && (
        <div
          style={{
            padding: "10px 12px",
            borderRadius: 8,
            background: "rgba(160, 48, 48, 0.2)",
            border: "1px solid rgba(255,120,120,0.35)",
            color: "#ffd6d6",
            marginBottom: 12,
            fontSize: 11,
            lineHeight: 1.45,
          }}
        >
          {clusterError}
        </div>
      )}

      {clusterSummary && (
        <section
          style={{
            padding: 14,
            borderRadius: 10,
            background: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(255,255,255,0.07)",
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 8, color: "#c5d5f1" }}>Last run</div>
          <div style={{ color: "rgba(210,220,235,0.8)", marginBottom: 8 }}>
            {clusterSummary.algorithm === "kmeans" && "K-means"}
            {clusterSummary.algorithm === "dbscan" && "DBSCAN"}
            {clusterSummary.algorithm === "isolation_forest" && "Isolation forest"}
            <span style={{ color: "rgba(180,190,210,0.65)" }}> · {clusterSummary.paramsLine}</span>
            {clusterSummary.inertia != null && (
              <span style={{ color: "rgba(180,190,210,0.65)" }}>
                {" "}
                · inertia ≈ {clusterSummary.inertia.toFixed(1)}
              </span>
            )}
          </div>
          {clusterSummary.algorithm !== "kmeans" && (
            <div style={{ fontSize: 10, color: "rgba(170,182,200,0.65)", marginBottom: 8 }}>
              {clusterSummary.algorithm === "dbscan" &&
                `Density clusters found: ${clusterSummary.nClusters}${
                  clusterSummary.noiseCount != null ? ` · noise points: ${clusterSummary.noiseCount}` : ""
                }`}
              {clusterSummary.algorithm === "isolation_forest" &&
                clusterSummary.noiseCount != null &&
                `Flagged as anomalous: ${clusterSummary.noiseCount} satellites`}
            </div>
          )}
          <ul style={{ margin: 0, paddingLeft: 18, color: "rgba(200,210,230,0.82)", lineHeight: 1.55 }}>
            {Object.entries(clusterSummary.sizes)
              .sort((a, b) => Number(a[0]) - Number(b[0]))
              .map(([labelStr, count]) => {
                const label = Number(labelStr);
                return (
                  <li key={labelStr}>
                    {formatSizeLabel(clusterSummary.algorithm, label)}: {count} satellites
                  </li>
                );
              })}
          </ul>
        </section>
      )}

      <section style={{ marginTop: 16, color: "rgba(170,182,204,0.55)", fontSize: 10, lineHeight: 1.55 }}>
        Tip: start the Python analytics service on port 8000 and point Spring at{" "}
        <span style={{ color: "rgba(200,210,230,0.75)" }}>lune.analytics.base-url</span> so the API can reach
        scikit-learn.
      </section>
    </aside>
  );
}
