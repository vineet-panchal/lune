import { useMemo, useState } from "react";
import { ALGORITHM_LABELS, clusterLabelName } from "../../../lib/clusterLabels";
import { compareRuns, deleteRun, type SavedRun } from "../../../lib/savedRuns";
import type { ClusterSummary } from "../OrbitalAnalyticsPanel";
import { MUTED, TEXT, buttonStyle, hintStyle, linkStyle } from "./ui";

type Props = {
  runs: SavedRun[];
  onRunsChange: (runs: SavedRun[]) => void;
  /** The run on the globe now: saved runs are compared against it. */
  current: ClusterSummary | null;
  /** Focus satellites that changed group (or null to stop). */
  focusedRunId: string | null;
  onFocusChanged: (runId: string | null, ids: number[]) => void;
  onShow: (satelliteId: number) => void;
  onHover: (satelliteId: number | null) => void;
};

/** Saved runs, and how the current run differs from one of them. */
export default function SavedRuns({ runs, onRunsChange, current, focusedRunId, onFocusChanged, onShow, onHover }: Props) {
  const [comparingId, setComparingId] = useState<string | null>(null);
  const comparing = runs.find((r) => r.id === comparingId) ?? null;
  const comparison = useMemo(() => {
    if (!comparing || !current) return null;
    const after = { ids: current.run.rows.map((r) => r.satelliteId), labels: current.run.rows.map((r) => r.label) };
    return compareRuns(comparing, after);
  }, [comparing, current]);
  const nameById = useMemo(() => new Map(current?.run.rows.map((r) => [r.satelliteId, r.name]) ?? []), [current]);

  if (runs.length === 0) {
    return <p style={hintStyle}>No saved runs yet. Use “Save run” on a result to keep it and compare later runs against it.</p>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {runs.map((run) => {
        const active = run.id === comparingId;
        return (
          <div key={run.id} style={{ fontSize: 10, color: MUTED, borderBottom: "1px solid rgba(255,255,255,0.06)", paddingBottom: 4 }}>
            <div style={{ color: TEXT, fontSize: 11 }}>
              {ALGORITHM_LABELS[run.algorithm]} · {run.paramsLine}
            </div>
            <div>
              {run.filter} · by {run.featuresLine} · {formatWhen(run.computedAtMs)} · {run.ids.length.toLocaleString()} sats
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 2 }}>
              <button type="button" disabled={!current} onClick={() => setComparingId(active ? null : run.id)} style={{ ...linkStyle, opacity: current ? 1 : 0.4 }}>
                {active ? "hide comparison" : "compare with last run"}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (active) setComparingId(null);
                  if (focusedRunId === run.id) onFocusChanged(null, []);
                  onRunsChange(deleteRun(run.id));
                }}
                style={{ ...linkStyle, color: "#ff8a80" }}
              >
                delete
              </button>
            </div>
            {active && comparison && current && (
              <div style={{ marginTop: 6, lineHeight: 1.5 }}>
                <div>
                  Agreement (adjusted Rand index):{" "}
                  <span style={{ color: TEXT }}>{comparison.agreement.toFixed(2)}</span>{" "}
                  {comparison.agreement > 0.9 ? "· nearly the same groups" : comparison.agreement > 0.5 ? "· broadly similar" : "· quite different groupings"}
                </div>
                <div>
                  <span style={{ color: TEXT }}>{comparison.changed.length.toLocaleString()}</span> of {comparison.common.toLocaleString()} satellites
                  changed group
                  {comparison.onlyAfter > 0 ? ` · ${comparison.onlyAfter.toLocaleString()} new` : ""}
                  {comparison.onlyBefore > 0 ? ` · ${comparison.onlyBefore.toLocaleString()} no longer loaded` : ""}
                </div>
                {comparison.changed.length > 0 && (
                  <>
                    <button
                      type="button"
                      onClick={() =>
                        onFocusChanged(focusedRunId === run.id ? null : run.id, comparison.changed.map((c) => c.satelliteId))
                      }
                      style={{ ...buttonStyle(), fontSize: 10, padding: "3px 8px", margin: "4px 0" }}
                    >
                      {focusedRunId === run.id ? "Stop focusing" : "Focus changed satellites"}
                    </button>
                    {comparison.changed.slice(0, 40).map((c) => (
                      <div
                        key={c.satelliteId}
                        onMouseEnter={() => onHover(c.satelliteId)}
                        onMouseLeave={() => onHover(null)}
                        style={{ display: "flex", gap: 6, alignItems: "baseline", flexWrap: "wrap" }}
                      >
                        <span style={{ color: TEXT, flex: "1 1 120px", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {nameById.get(c.satelliteId) ?? c.satelliteId}
                        </span>
                        <span title={`Was in ${clusterLabelName(run.algorithm, c.before)} of the saved run`}>
                          now {clusterLabelName(current.algorithm, c.after)} · rest of its group: {clusterLabelName(current.algorithm, c.expected)}
                        </span>
                        <button type="button" onClick={() => onShow(c.satelliteId)} style={linkStyle}>show</button>
                      </div>
                    ))}
                    {comparison.changed.length > 40 && <div>+ {(comparison.changed.length - 40).toLocaleString()} more</div>}
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function formatWhen(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
