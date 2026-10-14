import { useMemo, useState } from "react";
import { clusterLabelName, clusterLabelToColor, isOutlierGroup } from "../../../lib/clusterLabels";
import { clusterStats, explainOutliers } from "../../../lib/clusterInsights";
import type { OrbitPoint } from "../../../lib/clusterFeatures";
import type { ClusterSummary } from "../OrbitalAnalyticsPanel";
import AltitudeHistory from "./AltitudeHistory";
import { LINK, MUTED, TEXT, buttonStyle, linkStyle } from "./ui";

type ClusterInspectorProps = {
  summary: ClusterSummary;
  /** Orbit values by satellite, for the focused group's stats. */
  orbitById: Map<number, OrbitPoint>;
  focusedLabel: number | null;
  onFocusLabel: (label: number | null) => void;
  /** Select a satellite on this globe and follow it. */
  onShow: (satelliteId: number) => void;
  /** Light a satellite up on the globe while the pointer is over it (null to stop). */
  onHover: (satelliteId: number | null) => void;
  trackerUrl: (ids: number[]) => string;
};

const PAGE = 40;
/** HDBSCAN can find 100+ groups (e.g. one per Starlink orbital plane): list the largest and fold the rest. */
const LEGEND_ROWS = 15;

/**
 * The legend of the last run: one row per group with its globe colour and size. Clicking a row focuses that group
 * (the globe dims everything else) and shows its orbits, its members and, for outlier groups, why each one
 * stands out.
 */
export default function ClusterInspector({ summary, orbitById, focusedLabel, onFocusLabel, onShow, onHover, trackerUrl }: ClusterInspectorProps) {
  const [showAll, setShowAll] = useState(false);
  const all = Object.entries(summary.sizes).map(([label, count]) => [Number(label), count] as const);
  const many = all.length > LEGEND_ROWS;
  // Few groups: in label order. Many: noise first, then largest first.
  const entries = all.sort((a, b) => (many ? (a[0] === -1 ? -1 : b[0] === -1 ? 1 : b[1] - a[1]) : a[0] - b[0]));
  const listed = many && !showAll ? entries.filter(([label], i) => i < LEGEND_ROWS || label === focusedLabel) : entries;
  const total = entries.reduce((sum, [, count]) => sum + count, 0) || 1;
  const confidenceByLabel = useMemo(() => meanConfidenceByLabel(summary), [summary]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <div style={{ fontSize: 10, color: MUTED, marginBottom: 4 }}>Click a group to focus it on the globe.</div>
      {listed.map(([label, count]) => {
        const focused = focusedLabel === label;
        const confidence = confidenceByLabel.get(label);
        return (
          <div key={label}>
            <button
              type="button"
              onClick={() => onFocusLabel(focused ? null : label)}
              aria-pressed={focused}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                width: "100%",
                padding: "4px 6px",
                borderRadius: 6,
                border: focused ? "1px solid rgba(123,164,232,0.55)" : "1px solid transparent",
                background: focused ? "rgba(86,132,214,0.18)" : "transparent",
                color: "rgba(200,210,230,0.85)",
                font: "inherit",
                fontSize: 12,
                cursor: "pointer",
                textAlign: "left",
                opacity: focusedLabel !== null && !focused ? 0.55 : 1,
              }}
            >
              <span style={{ width: 10, height: 10, borderRadius: 3, background: clusterLabelToColor(label, summary.algorithm), flexShrink: 0 }} />
              <span style={{ flex: 1, minWidth: 0 }}>{clusterLabelName(summary.algorithm, label)}</span>
              {confidence !== undefined && (
                <span title="Average membership probability" style={{ color: MUTED, fontSize: 10 }}>{Math.round(confidence * 100)}% sure</span>
              )}
              <span style={{ color: "rgba(180,190,210,0.65)", whiteSpace: "nowrap" }}>
                {count.toLocaleString()} ({((count / total) * 100).toFixed(1)}%)
              </span>
            </button>
            {focused && (
              <GroupDetails
                summary={summary}
                label={label}
                orbitById={orbitById}
                onShow={onShow}
                onHover={onHover}
                trackerUrl={trackerUrl}
              />
            )}
          </div>
        );
      })}
      {many && (
        <button type="button" onClick={() => setShowAll((v) => !v)} style={{ ...linkStyle, marginTop: 4, alignSelf: "flex-start" }}>
          {showAll ? "show the largest only" : `show all ${entries.length} groups (largest ${LEGEND_ROWS} listed)`}
        </button>
      )}
    </div>
  );
}

function GroupDetails({
  summary,
  label,
  orbitById,
  onShow,
  onHover,
  trackerUrl,
}: Pick<ClusterInspectorProps, "summary" | "orbitById" | "onShow" | "onHover" | "trackerUrl"> & { label: number }) {
  const [shown, setShown] = useState(PAGE);
  const [showHistory, setShowHistory] = useState(false);
  const outliers = isOutlierGroup(summary.algorithm, label);
  const reasons = useMemo(() => (outliers ? explainOutliers(summary.run, label) : null), [outliers, summary.run, label]);

  // Outliers: most unusual first. Gaussian mixture: least certain first. Otherwise alphabetical.
  const members = useMemo(() => {
    const rows = summary.run.rows.filter((r) => r.label === label);
    if (reasons) return rows.sort((a, b) => (reasons.get(b.satelliteId)?.score ?? 0) - (reasons.get(a.satelliteId)?.score ?? 0));
    if (rows.some((r) => r.confidence !== undefined)) return rows.sort((a, b) => (a.confidence ?? 1) - (b.confidence ?? 1));
    return rows.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  }, [summary.run, label, reasons]);

  const stats = useMemo(
    () => clusterStats(members.map((m) => orbitById.get(m.satelliteId)).filter((q): q is OrbitPoint => Boolean(q))),
    [members, orbitById]
  );

  return (
    <div style={{ margin: "6px 0 10px 18px", fontSize: 10, color: MUTED, lineHeight: 1.6 }}>
      {stats && (
        <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", columnGap: 10, marginBottom: 8 }}>
          <span>Altitude</span>
          <span style={{ color: TEXT }}>
            {Math.round(stats.altitudeKm.mean).toLocaleString()} km{" "}
            <span style={{ color: MUTED }}>({Math.round(stats.altitudeKm.min).toLocaleString()}–{Math.round(stats.altitudeKm.max).toLocaleString()})</span>
          </span>
          <span>Inclination</span>
          <span style={{ color: TEXT }}>
            {stats.inclinationDeg.mean.toFixed(1)}° <span style={{ color: MUTED }}>({stats.inclinationDeg.min.toFixed(1)}–{stats.inclinationDeg.max.toFixed(1)})</span>
          </span>
          <span>Orbital plane</span>
          <span style={{ color: TEXT }}>
            {Math.round(stats.raanMeanDeg)}° <span style={{ color: MUTED }}>{planeSpread(stats.raanSpreadDeg)}</span>
          </span>
          <span>Period</span>
          <span style={{ color: TEXT }}>{stats.periodMinMean.toFixed(1)} min</span>
        </div>
      )}

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
        <a href={trackerUrl(members.map((m) => m.satelliteId))} target="_blank" rel="noreferrer" style={{ ...buttonStyle(), textDecoration: "none", fontSize: 10, padding: "4px 8px" }}>
          Open in Tracker ↗
        </a>
        <span>{members.length > 10 ? `first 10 of ${members.length.toLocaleString()}` : ""}</span>
        <button type="button" onClick={() => setShowHistory((v) => !v)} style={{ ...linkStyle, marginLeft: "auto" }}>
          {showHistory ? "hide altitude history" : "altitude over time"}
        </button>
      </div>
      {showHistory && (
        <div style={{ marginBottom: 8 }}>
          <AltitudeHistory ids={members.map((m) => m.satelliteId)} />
        </div>
      )}

      <div style={{ color: MUTED, marginBottom: 2 }}>
        {reasons ? "Most unusual first:" : members.some((m) => m.confidence !== undefined) ? "Least certain first:" : "Members:"}
      </div>
      <div style={{ display: "flex", flexDirection: "column" }}>
        {members.slice(0, shown).map((m) => (
          <div
            key={m.satelliteId}
            onMouseEnter={() => onHover(m.satelliteId)}
            onMouseLeave={() => onHover(null)}
            style={{ display: "flex", alignItems: "baseline", gap: 6, padding: "1px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}
          >
            <span style={{ color: TEXT, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={m.name}>
              {m.name}
              {reasons?.get(m.satelliteId) && (
                <span style={{ display: "block", color: MUTED, whiteSpace: "normal" }}>{reasons.get(m.satelliteId)?.text}</span>
              )}
            </span>
            {m.confidence !== undefined && <span>{Math.round(m.confidence * 100)}%</span>}
            <button type="button" onClick={() => onShow(m.satelliteId)} style={linkStyle} title="Select it and keep the camera on it">
              show
            </button>
          </div>
        ))}
      </div>
      {members.length > shown && (
        <button type="button" onClick={() => setShown((n) => n + PAGE * 5)} style={{ ...linkStyle, color: LINK, marginTop: 4 }}>
          show more ({(members.length - shown).toLocaleString()} left)
        </button>
      )}
    </div>
  );
}

/** One plane, a few neighbouring planes, or spread all around the Earth. */
function planeSpread(spreadDeg: number): string {
  if (spreadDeg < 5) return "· one plane";
  if (spreadDeg < 40) return `· within ±${Math.round(spreadDeg)}°`;
  return "· spread all around";
}

function meanConfidenceByLabel(summary: ClusterSummary): Map<number, number> {
  const sums = new Map<number, { total: number; n: number }>();
  for (const r of summary.run.rows) {
    if (r.confidence === undefined) continue;
    const s = sums.get(r.label) ?? { total: 0, n: 0 };
    s.total += r.confidence;
    s.n++;
    sums.set(r.label, s);
  }
  return new Map([...sums].map(([label, s]) => [label, s.total / s.n]));
}
