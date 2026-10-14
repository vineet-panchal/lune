import { useState } from "react";
import type { CloseApproach, CloseApproachesResponse } from "../../../lib/api";
import { MUTED, TEXT, buttonStyle, errorStyle, hintStyle, linkStyle, selectStyle } from "./ui";

type Props = {
  loadedCount: number;
  /** Screen the loaded satellites from the globe's current time over the next `hours`. */
  onFind: (hours: number, thresholdKm: number) => Promise<CloseApproachesResponse>;
  /** Jump the globe to just before the approach, with both satellites selected and followed. */
  onShowApproach: (approach: CloseApproach) => void;
  /** Back to real time after looking at an approach. */
  onGoLive: () => void;
  /** Globe time, to show how far ahead each approach is. */
  getNow: () => Date;
  focusedKey: string | null;
  onFocus: (key: string | null, ids: number[]) => void;
};

const WINDOWS = [1, 3, 6, 12];
const THRESHOLDS = [1, 5, 10, 25];

/** Pairs of loaded satellites that pass close to each other soon, closest first. */
export default function CloseApproaches({ loadedCount, onFind, onShowApproach, onGoLive, getNow, focusedKey, onFocus }: Props) {
  const [hours, setHours] = useState(3);
  const [threshold, setThreshold] = useState(5);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ data: CloseApproachesResponse; fromMs: number } | null>(null);
  const [shown, setShown] = useState<string | null>(null);

  const find = async () => {
    setBusy(true);
    setError(null);
    const fromMs = getNow().getTime();
    try {
      setResult({ data: await onFind(hours, threshold), fromMs });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Screening failed");
    } finally {
      setBusy(false);
    }
  };

  const within = result?.data.approaches.filter((a) => a.withinThreshold) ?? [];
  const nearMisses = result?.data.approaches.filter((a) => !a.withinThreshold) ?? [];
  // An older analytics service doesn't send the total; the listed ones are then all we know of.
  const totalWithin = result?.data.totalWithinThreshold ?? within.length;

  return (
    <div>
      <p style={{ ...hintStyle, marginBottom: 10 }}>
        Propagates every loaded satellite forward and finds pairs that pass close to each other. TLEs are only accurate
        to about a kilometre, so treat sub-km misses as “close”, not exact.
      </p>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", fontSize: 10, color: MUTED, marginBottom: 8 }}>
        <label style={{ display: "flex", gap: 4, alignItems: "center" }}>
          Next
          <select value={hours} onChange={(e) => setHours(Number(e.target.value))} style={selectStyle}>
            {WINDOWS.map((h) => (
              <option key={h} value={h}>{h} h</option>
            ))}
          </select>
        </label>
        <label style={{ display: "flex", gap: 4, alignItems: "center" }}>
          Closer than
          <select value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} style={selectStyle}>
            {THRESHOLDS.map((t) => (
              <option key={t} value={t}>{t} km</option>
            ))}
          </select>
        </label>
      </div>
      <button type="button" onClick={find} disabled={busy || loadedCount < 2} style={buttonStyle(!busy && loadedCount >= 2)}>
        {busy ? `Screening ${loadedCount.toLocaleString()} satellites…` : `Find close approaches`}
      </button>
      {busy && <div style={{ fontSize: 10, color: MUTED, marginTop: 6 }}>About {Math.max(2, Math.round((loadedCount / 12000) * hours * 3))} s for this many satellites.</div>}
      {error && <div style={{ ...errorStyle, marginTop: 8 }}>{error}</div>}

      {result && (
        <div style={{ marginTop: 10, fontSize: 10, color: MUTED, lineHeight: 1.5 }}>
          <div style={{ marginBottom: 6 }}>
            {within.length > 0 ? (
              <>
                <span style={{ color: TEXT }}>{totalWithin.toLocaleString()}</span> approach
                {totalWithin === 1 ? "" : "es"} under {result.data.thresholdKm} km
                {totalWithin > within.length ? ` (closest ${within.length} listed)` : ""}
              </>
            ) : (
              `Nothing under ${result.data.thresholdKm} km`
            )}{" "}
            in the next {result.data.hours} h among {result.data.screened.toLocaleString()} satellites
            {result.data.formationPairsSkipped > 0 && ` (${result.data.formationPairsSkipped.toLocaleString()} pairs flying together left out)`}.
          </div>
          {within.length > 0 && (
            <button
              type="button"
              onClick={() => {
                const ids = [...new Set(within.flatMap((a) => [a.a.satelliteId, a.b.satelliteId]))];
                onFocus(focusedKey === "approaches" ? null : "approaches", ids);
              }}
              style={{ ...buttonStyle(), fontSize: 10, padding: "3px 8px", marginBottom: 6 }}
            >
              {focusedKey === "approaches" ? "Stop focusing" : "Focus these satellites"}
            </button>
          )}
          {[...within, ...nearMisses.slice(0, within.length > 0 ? 5 : 15)].map((a, i) => {
            const key = `${a.a.satelliteId}-${a.b.satelliteId}`;
            return (
              <div key={key} style={{ padding: "3px 0", borderBottom: "1px solid rgba(255,255,255,0.05)", opacity: a.withinThreshold ? 1 : 0.6 }}>
                {i === within.length && within.length > 0 && <div style={{ margin: "4px 0", color: MUTED }}>Nearest beyond {result.data.thresholdKm} km:</div>}
                <div style={{ display: "flex", gap: 6, alignItems: "baseline" }}>
                  <span style={{ color: TEXT, flex: 1, minWidth: 0 }}>
                    {a.a.name} ↔ {a.b.name}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setShown(key);
                      onShowApproach(a);
                    }}
                    style={linkStyle}
                    title="Jump the globe to just before this approach and follow both satellites"
                  >
                    show
                  </button>
                </div>
                <div>
                  <span style={{ color: a.withinThreshold ? "#ffb74d" : MUTED }}>{formatMiss(a.missKm)}</span> ·{" "}
                  {formatIn(a.tcaMs - result.fromMs)} ({formatClock(a.tcaMs)}) · {a.relativeSpeedKmS.toFixed(1)} km/s
                </div>
              </div>
            );
          })}
          {shown && (
            <button
              type="button"
              onClick={() => {
                setShown(null);
                onGoLive();
              }}
              style={{ ...buttonStyle(), fontSize: 10, padding: "3px 8px", marginTop: 8 }}
            >
              Back to live time
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function formatMiss(km: number): string {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;
}

function formatIn(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `in ${minutes} min`;
  return `in ${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

function formatClock(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}
