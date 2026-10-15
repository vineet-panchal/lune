import { useState } from "react";
import { relativeTime, type KpPoint, type SpaceWeather } from "../../lib/missionControl";
import Card, { HAIRLINE, MUTED, SECONDARY, Skeleton, STATUS, StatusPill, TEXT } from "./Card";

/** Kp levels: quiet below 4, active at 4, a storm (G1–G2) at 5–6, a severe storm (G3+) at 7 and above. */
const KP_LEVELS = [
  { min: 0, label: "Quiet", color: STATUS.good },
  { min: 4, label: "Active", color: STATUS.warning },
  { min: 5, label: "Storm", color: STATUS.serious },
  { min: 7, label: "Severe storm", color: STATUS.critical },
];

function kpLevel(kp: number) {
  return [...KP_LEVELS].reverse().find((l) => kp >= l.min) ?? KP_LEVELS[0];
}

/** R, S and G scales: 0 none, 1–2 minor/moderate, 3+ strong to extreme. */
function scaleColor(level: number): string {
  if (level >= 3) return STATUS.critical;
  if (level >= 1) return STATUS.warning;
  return STATUS.good;
}

const SCALE_NAMES = {
  r: { name: "Radio blackouts", from: "solar flares" },
  s: { name: "Radiation storms", from: "solar particles" },
  g: { name: "Geomagnetic storms", from: "solar wind" },
} as const;

/** Where aurora might be seen with this Kp (rough geomagnetic latitudes). */
function auroraHint(kp: number): string {
  if (kp >= 7) return "aurora possible far from the poles (e.g. southern US, central Europe)";
  if (kp >= 5) return "aurora possible at mid latitudes (e.g. northern US, UK, Germany)";
  if (kp >= 4) return "aurora likely at high latitudes (Canada, Scandinavia)";
  return "aurora only near the poles";
}

export default function SpaceWeatherCard({ weather, nowMs }: { weather: SpaceWeather | null; nowMs: number | null }) {
  const kp = weather?.kp.data ?? null;
  const scales = weather?.scales.data ?? null;
  const flare = weather?.flare.data ?? null;
  const updatedAt = weather?.kp.updatedAt ?? null;

  const current = kp && nowMs ? [...kp].reverse().find((p) => p.kind !== "predicted" && Date.parse(p.time) <= nowMs) : null;
  const next24 = kp && nowMs ? kp.filter((p) => Date.parse(p.time) > nowMs && Date.parse(p.time) <= nowMs + 86_400_000) : [];
  const peakNext24 = next24.length ? Math.max(...next24.map((p) => p.kp)) : null;

  return (
    <Card
      title="Space weather"
      subtitle="NOAA Space Weather Prediction Center"
      updatedAt={updatedAt}
      loading={weather?.kp.loading ?? true}
      error={weather?.kp.error ?? weather?.scales.error ?? null}
    >
      {!kp || !nowMs ? (
        <Skeleton rows={4} />
      ) : (
        <>
          {current && (
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
              <span style={{ fontSize: 30, fontWeight: 700, color: "#fff", fontVariantNumeric: "tabular-nums" }}>Kp {current.kp.toFixed(1)}</span>
              <StatusPill color={kpLevel(current.kp).color}>{kpLevel(current.kp).label}</StatusPill>
            </div>
          )}
          <div style={{ fontSize: 11, color: SECONDARY, marginTop: 4, lineHeight: 1.45 }}>
            {peakNext24 !== null && (
              <>
                Next 24 h: up to Kp {peakNext24.toFixed(1)}, {auroraHint(peakNext24)}.
              </>
            )}
          </div>
          <KpChart points={kp} nowMs={nowMs} />

          {scales && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginTop: 12 }}>
              {(["r", "s", "g"] as const).map((k) => (
                <div key={k} style={{ padding: "8px 9px", borderRadius: 8, border: `1px solid ${HAIRLINE}`, background: "rgba(255,255,255,0.03)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ width: 7, height: 7, borderRadius: "50%", background: scaleColor(scales.now[k]) }} />
                    <span style={{ fontWeight: 700, color: TEXT }}>
                      {k.toUpperCase()}
                      {scales.now[k]}
                    </span>
                    <span style={{ fontSize: 10, color: MUTED }}>{scales.now[k] === 0 ? "none" : "now"}</span>
                  </div>
                  <div style={{ fontSize: 10, color: SECONDARY, marginTop: 3 }}>{SCALE_NAMES[k].name}</div>
                  <div style={{ fontSize: 9, color: MUTED }}>
                    24 h max {k.toUpperCase()}
                    {scales.last24h[k]}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div style={{ marginTop: 12, fontSize: 11, color: SECONDARY, lineHeight: 1.55 }}>
            {flare?.peakClass && flare.peakTime ? (
              <div>
                Latest solar flare: <b style={{ color: TEXT }}>{flare.peakClass}</b> {relativeTime(Date.parse(flare.peakTime), nowMs)}
                {flare.currentClass ? <span style={{ color: MUTED }}> · X-rays now at {flare.currentClass} level</span> : null}
              </div>
            ) : (
              <div style={{ color: MUTED }}>No recent solar flares reported.</div>
            )}
            {scales && scales.forecast.length > 0 && (
              <div style={{ color: MUTED, marginTop: 2 }}>
                Chance of a radio blackout next {scales.forecast.length} days:{" "}
                {scales.forecast.map((d) => `${d.rMinorPercent ?? 0}%`).join(" / ")} minor,{" "}
                {scales.forecast.map((d) => `${d.rMajorPercent ?? 0}%`).join(" / ")} major
              </div>
            )}
          </div>
        </>
      )}
    </Card>
  );
}

const CHART_H = 96;
const AXIS_H = 16;
const KP_MAX = 9;

/** Kp in 3-hour blocks: observed solid, forecast faded, with a "now" line and per-bar tooltips. */
function KpChart({ points, nowMs }: { points: KpPoint[]; nowMs: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const n = points.length;
  if (n === 0) return null;
  const width = 100; // viewBox units; the SVG stretches to the card
  const slot = width / n;
  const bar = Math.max(0.4, slot - 0.35); // a thin surface gap between neighbouring bars
  const nowIndex = points.findIndex((p) => Date.parse(p.time) + 3 * 3600_000 > nowMs);
  const nowX = nowIndex < 0 ? width : nowIndex * slot + ((nowMs - Date.parse(points[nowIndex].time)) / (3 * 3600_000)) * slot;
  const y = (kp: number) => CHART_H - (Math.max(kp, 0.15) / KP_MAX) * CHART_H;
  const days = points
    .map((p, i) => ({ i, d: new Date(p.time) }))
    // A label needs room to its right; the last one is dropped when it would run off the chart.
    .filter(({ i, d }) => d.getUTCHours() === 0 && i / n < 0.9);
  const hovered = hover === null ? null : points[hover];

  return (
    <div style={{ position: "relative", marginTop: 10 }}>
      <svg
        viewBox={`0 0 ${width} ${CHART_H + AXIS_H}`}
        preserveAspectRatio="none"
        style={{ width: "100%", height: CHART_H + AXIS_H, display: "block", overflow: "visible" }}
        onMouseLeave={() => setHover(null)}
        role="img"
        aria-label="Planetary K-index for the last three days and the forecast"
      >
        {/* Storm threshold (Kp 5) */}
        <line x1={0} x2={width} y1={y(5)} y2={y(5)} stroke="rgba(255,255,255,0.14)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        <line x1={0} x2={width} y1={CHART_H} y2={CHART_H} stroke="rgba(255,255,255,0.18)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        {points.map((p, i) => {
          const top = y(p.kp);
          const predicted = p.kind === "predicted";
          return (
            <g key={p.time} onMouseEnter={() => setHover(i)}>
              {/* Hit target: the whole column, not just the bar */}
              <rect x={i * slot} y={0} width={slot} height={CHART_H} fill="transparent" />
              <rect
                x={i * slot + (slot - bar) / 2}
                y={top}
                width={bar}
                height={CHART_H - top}
                rx={0.4}
                fill={kpLevel(p.kp).color}
                opacity={hover === i ? 1 : predicted ? 0.38 : 0.85}
              />
            </g>
          );
        })}
        <line x1={nowX} x2={nowX} y1={0} y2={CHART_H} stroke="#fff" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        {days.map(({ i }) => (
          <line key={i} x1={i * slot} x2={i * slot} y1={CHART_H} y2={CHART_H + 4} stroke="rgba(255,255,255,0.25)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        ))}
      </svg>
      {/* Text sits outside the stretched SVG so it isn't distorted */}
      {days.map(({ i, d }) => (
        <div key={i} style={{ position: "absolute", left: `${(i / n) * 100}%`, top: CHART_H + 3, transform: "translateX(3px)", fontSize: 9, color: MUTED, whiteSpace: "nowrap" }}>
          {d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", timeZone: "UTC" })}
        </div>
      ))}
      <div style={{ position: "absolute", left: `${(nowX / width) * 100}%`, top: -2, transform: "translateX(4px)", fontSize: 9, color: SECONDARY }}>now</div>
      <div style={{ position: "absolute", right: 0, top: `${(y(5) / (CHART_H + AXIS_H)) * 100}%`, transform: "translateY(-120%)", fontSize: 9, color: MUTED }}>storm (Kp 5)</div>
      {hovered && (
        <div
          style={{
            position: "absolute",
            left: `${((hover! + 0.5) / n) * 100}%`,
            top: -30,
            transform: `translateX(${hover! / n > 0.7 ? "-100%" : hover! / n < 0.3 ? "0" : "-50%"})`,
            padding: "4px 8px",
            borderRadius: 6,
            background: "rgba(0,0,0,0.85)",
            border: `1px solid ${HAIRLINE}`,
            fontSize: 10,
            color: TEXT,
            whiteSpace: "nowrap",
            pointerEvents: "none",
          }}
        >
          Kp {hovered.kp.toFixed(2)} · {kpLevel(hovered.kp).label} ·{" "}
          {new Date(hovered.time).toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" })} · {hovered.kind}
        </div>
      )}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 4, fontSize: 9, color: MUTED }}>
        {KP_LEVELS.map((l) => (
          <span key={l.label} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: l.color }} />
            {l.label}
          </span>
        ))}
        <span>· faded = forecast</span>
      </div>
    </div>
  );
}
