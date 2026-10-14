import type { MouseEvent, ReactNode } from "react";
import type { KDistanceResponse, KSweepResponse } from "../../../lib/api";
import { ACCENT, MUTED } from "./ui";

/**
 * Charts that help pick a model's settings; clicking the chart picks a value.
 *  - k sweep: silhouette per k (how well separated the groups are, higher is better), plus inertia (k-means)
 *    or BIC (Gaussian mixture) as a faint second line.
 *  - k-distance: every satellite's distance to its nearest neighbours, sorted; DBSCAN's eps belongs at the bend.
 */
const W = 300;
const H = 120;
const PAD = { left: 30, right: 8, top: 10, bottom: 20 };
const PLOT_W = W - PAD.left - PAD.right;
const PLOT_H = H - PAD.top - PAD.bottom;
const SECOND_LINE = "rgba(255,213,79,0.55)";

export function KSweepChart({ result, k, onPick }: { result: KSweepResponse; k: number; onPick: (k: number) => void }) {
  const rows = result.results;
  const ks = rows.map((r) => r.k);
  const kMin = ks[0];
  const kMax = ks[ks.length - 1];
  const x = (value: number) => PAD.left + (kMax === kMin ? PLOT_W / 2 : ((value - kMin) / (kMax - kMin)) * PLOT_W);
  const sil = rows.map((r) => r.silhouette ?? 0);
  const silMax = Math.max(0.05, ...sil);
  const ySil = (v: number) => PAD.top + PLOT_H - (Math.max(0, v) / silMax) * PLOT_H;
  const second = rows.map((r) => (result.kind === "gmm" ? r.bic : r.inertia) ?? 0);
  const sMin = Math.min(...second);
  const sMax = Math.max(...second);
  const ySecond = (v: number) => PAD.top + PLOT_H - (sMax === sMin ? 0.5 : (v - sMin) / (sMax - sMin)) * PLOT_H;
  const colW = PLOT_W / Math.max(1, ks.length - 1);

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", display: "block", cursor: "pointer" }} role="img" aria-label="Score for each number of clusters">
        <Axes yTop={silMax.toFixed(2)} yBottom="0" />
        {ks.map((value) => (
          <g key={value} onClick={() => onPick(value)}>
            <rect x={x(value) - colW / 2} y={PAD.top} width={colW} height={PLOT_H} fill={value === k ? "rgba(123,164,232,0.16)" : "transparent"} />
            <text x={x(value)} y={H - 6} fontSize={8} fill={value === result.suggestedK ? "#e8f0ff" : MUTED} textAnchor="middle" fontWeight={value === result.suggestedK ? 700 : 400}>
              {value}
            </text>
          </g>
        ))}
        <polyline points={rows.map((r, i) => `${x(r.k)},${ySecond(second[i])}`).join(" ")} fill="none" stroke={SECOND_LINE} strokeWidth={1} strokeDasharray="3 2" pointerEvents="none" />
        <polyline points={rows.map((r, i) => `${x(r.k)},${ySil(sil[i])}`).join(" ")} fill="none" stroke={ACCENT} strokeWidth={1.5} pointerEvents="none" />
        {rows.map((r, i) => (
          <circle key={r.k} cx={x(r.k)} cy={ySil(sil[i])} r={r.k === result.suggestedK ? 3.5 : 2} fill={r.k === result.suggestedK ? "#e8f0ff" : ACCENT} pointerEvents="none" />
        ))}
      </svg>
      <Caption>
        <span style={{ color: ACCENT }}>━</span> silhouette (higher = clearer groups) ·{" "}
        <span style={{ color: SECOND_LINE }}>┅</span> {result.kind === "gmm" ? "BIC (lower = better fit)" : "inertia (always falls; look for the elbow)"}.
        Suggested k = {result.suggestedK}. Click a column to use it.
        {result.kind === "kmeans" && result.suggestedK === kMax && (
          <>
            {" "}
            The best score is at the largest k tried, so there are probably more natural groups than this (e.g. many
            orbital planes). HDBSCAN finds them without choosing k.
          </>
        )}
      </Caption>
    </div>
  );
}

export function KDistanceChart({ result, eps, onPick }: { result: KDistanceResponse; eps: number; onPick: (eps: number) => void }) {
  const dMax = result.distances[result.distances.length - 1] || 1;
  // The last few percent shoot up (isolated satellites); cap the axis so the bend stays readable.
  const top = Math.min(dMax, Math.max(result.suggestedEps * 3, quantileOf(result.distances, 0.97)));
  const x = (f: number) => PAD.left + f * PLOT_W;
  const y = (d: number) => PAD.top + PLOT_H - (Math.min(d, top) / top) * PLOT_H;
  const pick = (event: MouseEvent<SVGSVGElement>) => {
    const svg = event.currentTarget.getBoundingClientRect();
    const py = ((event.clientY - svg.top) / svg.height) * H;
    const value = ((PAD.top + PLOT_H - py) / PLOT_H) * top;
    onPick(Math.max(0.05, Math.round(value * 100) / 100));
  };
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", display: "block", cursor: "crosshair" }} onClick={pick} role="img" aria-label="Distance to nearest neighbours, sorted">
        <Axes yTop={top.toFixed(2)} yBottom="0" xLabel={`satellites, sorted by distance to their ${result.minSamples}th neighbour`} />
        <polyline points={result.distances.map((d, i) => `${x(result.fractions[i])},${y(d)}`).join(" ")} fill="none" stroke={ACCENT} strokeWidth={1.5} />
        <line x1={PAD.left} x2={W - PAD.right} y1={y(result.suggestedEps)} y2={y(result.suggestedEps)} stroke="#e8f0ff" strokeDasharray="3 2" strokeWidth={0.8} />
        <line x1={PAD.left} x2={W - PAD.right} y1={y(eps)} y2={y(eps)} stroke={SECOND_LINE} strokeWidth={1} />
      </svg>
      <Caption>
        Below the bend, satellites sit in dense groups; above it they&apos;re isolated. Suggested eps ={" "}
        {result.suggestedEps.toFixed(2)} (dashed); <span style={{ color: SECOND_LINE }}>━</span> current. Click the
        chart to set eps.
      </Caption>
    </div>
  );
}

function Axes({ yTop, yBottom, xLabel }: { yTop: string; yBottom: string; xLabel?: string }) {
  return (
    <g pointerEvents="none">
      <line x1={PAD.left} x2={PAD.left} y1={PAD.top} y2={PAD.top + PLOT_H} stroke="rgba(255,255,255,0.2)" />
      <line x1={PAD.left} x2={W - PAD.right} y1={PAD.top + PLOT_H} y2={PAD.top + PLOT_H} stroke="rgba(255,255,255,0.2)" />
      <text x={PAD.left - 4} y={PAD.top + 4} fontSize={8} fill={MUTED} textAnchor="end">{yTop}</text>
      <text x={PAD.left - 4} y={PAD.top + PLOT_H} fontSize={8} fill={MUTED} textAnchor="end">{yBottom}</text>
      {xLabel && <text x={PAD.left + PLOT_W / 2} y={H - 6} fontSize={8} fill={MUTED} textAnchor="middle">{xLabel}</text>}
    </g>
  );
}

function Caption({ children }: { children: ReactNode }) {
  return <div style={{ fontSize: 10, color: MUTED, lineHeight: 1.45, marginTop: 4 }}>{children}</div>;
}

function quantileOf(sorted: number[], q: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * q))];
}
