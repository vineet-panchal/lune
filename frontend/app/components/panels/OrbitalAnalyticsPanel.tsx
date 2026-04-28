"use client";

import { useState } from "react";

export type ClusterSummary = {
  k: number;
  inertia: number | null;
  sizes: Record<number, number>;
};

type OrbitalAnalyticsPanelProps = {
  satelliteSampleCount: number;
  satelliteTotalCount: number;
  loadingCatalog: boolean;
  clusteringBusy: boolean;
  clusterError: string | null;
  clusterSummary: ClusterSummary | null;
  onRunKMeans: (k: number) => void;
  onClearClustering: () => void;
};

export default function OrbitalAnalyticsPanel({
  satelliteSampleCount,
  satelliteTotalCount,
  loadingCatalog,
  clusteringBusy,
  clusterError,
  clusterSummary,
  onRunKMeans,
  onClearClustering,
}: OrbitalAnalyticsPanelProps) {
  const [k, setK] = useState(5);

  const canRun =
    !loadingCatalog && !clusteringBusy && satelliteSampleCount >= 2 && k >= 2 && k <= satelliteSampleCount;

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
        Satellites are treated as points in 3D space. Run k-means on each satellite's current XYZ
        position (Earth-centered) to reveal visible spatial groupings in this scene; colors update via
        the Python-backed service through Spring Boot.
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
        <div style={{ fontWeight: 600, marginBottom: 10, color: "#c5d5f1" }}>K-means clustering</div>
        <label style={{ display: "block", fontSize: 11, color: "rgba(200,210,230,0.65)", marginBottom: 6 }}>
          Clusters (k)
        </label>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <input
            type="range"
            min={2}
            max={Math.max(2, Math.min(12, satelliteSampleCount || 2))}
            step={1}
            value={Math.min(k, Math.max(2, satelliteSampleCount || 2))}
            onChange={(e) => setK(parseInt(e.target.value, 10))}
            disabled={satelliteSampleCount < 2}
            style={{ flex: "1 1 140px", minWidth: 120 }}
          />
          <span style={{ minWidth: 28, textAlign: "right", color: "rgba(200,210,230,0.85)" }}>
            {Math.min(k, Math.max(2, satelliteSampleCount || 2))}
          </span>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
          <button
            type="button"
            disabled={!canRun}
            onClick={() => onRunKMeans(Math.min(k, Math.max(2, satelliteSampleCount)))}
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
            {clusteringBusy ? "Running…" : "Run clustering"}
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
            k = {clusterSummary.k}
            {clusterSummary.inertia != null && (
              <span style={{ color: "rgba(180,190,210,0.65)" }}>
                {" "}
                · inertia ≈ {clusterSummary.inertia.toFixed(1)}
              </span>
            )}
          </div>
          <ul style={{ margin: 0, paddingLeft: 18, color: "rgba(200,210,230,0.82)", lineHeight: 1.55 }}>
            {Object.entries(clusterSummary.sizes)
              .sort((a, b) => Number(a[0]) - Number(b[0]))
              .map(([label, count]) => (
                <li key={label}>
                  Cluster {label}: {count} satellites
                </li>
              ))}
          </ul>
        </section>
      )}

      <section style={{ marginTop: 16, color: "rgba(170,182,204,0.55)", fontSize: 10, lineHeight: 1.55 }}>
        Tip: start the Python analytics service on port 8000 and point Spring at{" "}
        <span style={{ color: "rgba(200,210,230,0.75)" }}>lune.analytics.base-url</span> so the API can
        reach scikit-learn.
      </section>
    </aside>
  );
}
