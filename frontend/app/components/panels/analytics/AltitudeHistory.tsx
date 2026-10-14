import { useEffect, useState, type ReactNode } from "react";
import { fetchOrbitHistory, type OrbitHistory } from "../../../lib/api";
import { ACCENT, MUTED } from "./ui";

const W = 300;
const H = 110;
const PAD = { left: 40, right: 8, top: 8, bottom: 18 };
/** One request covers a whole cluster; more lines than this just turn into a smear. */
const MAX_LINES = 200;

/**
 * Mean altitude over time from the TLEs the backend has stored: one line per satellite (faint when there are many),
 * so you can watch a launch batch climb to its working orbit or a satellite decay. Loads on mount.
 */
export default function AltitudeHistory({ ids, highlightId }: { ids: number[]; highlightId?: number }) {
  const key = ids.slice(0, MAX_LINES).join(",");
  const [state, setState] = useState<{ key: string; series: OrbitHistory[] | null; error: string | null }>({ key: "", series: null, error: null });

  useEffect(() => {
    let cancelled = false;
    fetchOrbitHistory(key ? key.split(",").map(Number) : [])
      .then((series) => !cancelled && setState({ key, series, error: null }))
      .catch((e) => !cancelled && setState({ key, series: null, error: e instanceof Error ? e.message : "History request failed" }));
    return () => {
      cancelled = true;
    };
  }, [key]);

  if (state.key !== key) return <Note>Loading altitude history…</Note>;
  if (state.error) return <Note>{state.error}</Note>;
  const series = (state.series ?? []).filter((s) => s.samples.length >= 2);
  if (series.length === 0) {
    const most = Math.max(0, ...(state.series ?? []).map((s) => s.samples.length));
    return (
      <Note>
        Altitude history: {most === 1 ? "only one TLE stored so far" : "none stored yet"}. The backend adds one per refresh
        (every 2–6 h), so lines appear over the next day.
      </Note>
    );
  }

  const times = series.flatMap((s) => s.samples.map((p) => Date.parse(p.epoch)));
  const alts = series.flatMap((s) => s.samples.map((p) => p.altitudeKm));
  const t0 = Math.min(...times);
  const t1 = Math.max(...times);
  const a0 = Math.min(...alts);
  const a1 = Math.max(...alts);
  const pad = Math.max(1, (a1 - a0) * 0.08);
  const x = (t: number) => PAD.left + ((t - t0) / (t1 - t0 || 1)) * (W - PAD.left - PAD.right);
  const y = (a: number) => PAD.top + (1 - (a - (a0 - pad)) / (a1 - a0 + 2 * pad)) * (H - PAD.top - PAD.bottom);
  const faint = series.length > 5;

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", display: "block" }} role="img" aria-label="Altitude over time">
        <line x1={PAD.left} x2={PAD.left} y1={PAD.top} y2={H - PAD.bottom} stroke="rgba(255,255,255,0.2)" />
        <line x1={PAD.left} x2={W - PAD.right} y1={H - PAD.bottom} y2={H - PAD.bottom} stroke="rgba(255,255,255,0.2)" />
        <text x={PAD.left - 4} y={PAD.top + 6} fontSize={8} fill={MUTED} textAnchor="end">{Math.round(a1)} km</text>
        <text x={PAD.left - 4} y={H - PAD.bottom} fontSize={8} fill={MUTED} textAnchor="end">{Math.round(a0)} km</text>
        <text x={PAD.left} y={H - 5} fontSize={8} fill={MUTED}>{formatDay(t0)}</text>
        <text x={W - PAD.right} y={H - 5} fontSize={8} fill={MUTED} textAnchor="end">{formatDay(t1)}</text>
        {series.map((s) => {
          const highlighted = s.satelliteId === highlightId;
          return (
            <polyline
              key={s.satelliteId}
              points={s.samples.map((p) => `${x(Date.parse(p.epoch))},${y(p.altitudeKm)}`).join(" ")}
              fill="none"
              stroke={highlighted ? "#ffd54f" : ACCENT}
              strokeOpacity={highlighted || !faint ? 0.95 : 0.3}
              strokeWidth={highlighted ? 1.6 : 1}
            >
              <title>{s.name}</title>
            </polyline>
          );
        })}
      </svg>
      <Note>
        Mean altitude from each stored TLE{series.length > 1 ? ` · ${series.length} satellites` : ""}
        {ids.length > MAX_LINES ? ` (first ${MAX_LINES} of ${ids.length.toLocaleString()})` : ""}.
      </Note>
    </div>
  );
}

function Note({ children }: { children: ReactNode }) {
  return <div style={{ fontSize: 10, color: MUTED, lineHeight: 1.45, marginTop: 2 }}>{children}</div>;
}

function formatDay(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
