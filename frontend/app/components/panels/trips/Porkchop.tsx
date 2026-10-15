import { useEffect, useMemo, useRef, useState } from "react";
import { cellTimes, type PorkchopGrid } from "../../../lib/trips/porkchop";
import { MUTED, TEXT } from "../analytics/ui";
import { formatDate, formatMonth, FONT } from "./ui";

/**
 * The porkchop plot: departure date across, flight time up, coloured by cost. One sequential blue ramp in
 * bands; on the dark panel the cheapest transfers are the lightest, and anything beyond the scale fades into
 * the background. Hover for the numbers, click to pick that trip.
 */
export type PorkchopMetric = "total" | "c3";

/** Blue ramp, lightest (cheapest) first. */
const RAMP = ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#2a78d6", "#1c5cab", "#104281", "#0d366b"];
const SCALE_SPAN: Record<PorkchopMetric, number> = { total: 6, c3: 48 };
const METRIC_LABEL: Record<PorkchopMetric, string> = { total: "Total Δv", c3: "Launch energy C3" };
const unit = (m: PorkchopMetric) => (m === "total" ? "km/s" : "km²/s²");

const WIDTH = 296;
const HEIGHT = 196;
const PAD = { left: 38, right: 6, top: 6, bottom: 20 };

type Props = {
  grid: PorkchopGrid | null;
  metric: PorkchopMetric;
  selected: { col: number; row: number } | null;
  onSelect: (col: number, row: number) => void;
  computing: boolean;
};

export default function Porkchop({ grid, metric, selected, onSelect, computing }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [hover, setHover] = useState<{ col: number; row: number; x: number; y: number } | null>(null);
  const values = grid ? (metric === "total" ? grid.total : grid.c3) : null;

  const scaleMin = useMemo(() => {
    if (!values) return 0;
    let min = Infinity;
    for (const v of values) if (v < min) min = v;
    return Number.isFinite(min) ? min : 0;
  }, [values]);
  const span = SCALE_SPAN[metric];

  const plotW = WIDTH - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = WIDTH * dpr;
    canvas.height = HEIGHT * dpr;
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    ctx.fillStyle = "rgba(255,255,255,0.03)";
    ctx.fillRect(PAD.left, PAD.top, plotW, plotH);
    if (!grid || !values) return;

    const cw = plotW / grid.cols;
    const ch = plotH / grid.rows;
    for (let row = 0; row < grid.rows; row++) {
      for (let col = 0; col < grid.cols; col++) {
        const v = values[row * grid.cols + col];
        if (!(v >= 0)) continue;
        const band = Math.floor(((v - scaleMin) / span) * RAMP.length);
        if (band >= RAMP.length) continue;
        ctx.fillStyle = RAMP[Math.max(0, band)];
        // Flight time increases upwards.
        ctx.fillRect(PAD.left + col * cw, PAD.top + plotH - (row + 1) * ch, Math.ceil(cw), Math.ceil(ch));
      }
    }

    // Axes: departure months / years along the bottom, flight time up the side.
    ctx.font = `9px ${FONT}`;
    ctx.fillStyle = MUTED;
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.lineWidth = 1;
    const startMs = grid.departStartMs;
    const endMs = cellTimes(grid, grid.cols - 1, 0).departMs;
    const spanDays = (endMs - startMs) / 86_400_000;
    const stepMonths = spanDays > 1000 ? 12 : spanDays > 500 ? 6 : 3;
    const d = new Date(startMs);
    let tick = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
    let lastLabelX = -Infinity;
    while (tick < endMs) {
      const m = new Date(tick).getUTCMonth();
      if (m % stepMonths === 0) {
        const x = PAD.left + ((tick - startMs) / (endMs - startMs)) * plotW;
        ctx.beginPath();
        ctx.moveTo(x, PAD.top + plotH);
        ctx.lineTo(x, PAD.top + plotH + 3);
        ctx.stroke();
        const text = stepMonths === 12 ? String(new Date(tick).getUTCFullYear()) : formatMonth(tick).replace(" 20", " ’");
        const tw = ctx.measureText(text).width;
        if (x - tw / 2 > lastLabelX + 4 && x + tw / 2 < WIDTH) {
          ctx.fillText(text, x - tw / 2, HEIGHT - 6);
          lastLabelX = x + tw / 2;
        }
      }
      const next = new Date(tick);
      tick = Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 1);
    }
    const tofMax = grid.tofStartDays + (grid.rows - 1) * grid.tofStepDays;
    const years = tofMax > 3 * 365;
    for (let i = 0; i <= 4; i++) {
      const tof = grid.tofStartDays + ((tofMax - grid.tofStartDays) * i) / 4;
      const y = PAD.top + plotH - (i / 4) * plotH;
      const text = years ? `${(tof / 365.25).toFixed(1)}y` : `${Math.round(tof)}d`;
      ctx.fillText(text, PAD.left - 4 - ctx.measureText(text).width, y + 3);
      ctx.beginPath();
      ctx.moveTo(PAD.left - 3, y);
      ctx.lineTo(PAD.left, y);
      ctx.stroke();
    }

    const cellCentre = (c: { col: number; row: number }) => ({ x: PAD.left + (c.col + 0.5) * cw, y: PAD.top + plotH - (c.row + 0.5) * ch });
    if (grid.best) {
      const p = cellCentre(grid.best);
      ctx.strokeStyle = "#0a0a0e";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    if (selected) {
      const p = cellCentre(selected);
      ctx.strokeStyle = "rgba(255,255,255,0.85)";
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(p.x, PAD.top);
      ctx.lineTo(p.x, PAD.top + plotH);
      ctx.moveTo(PAD.left, p.y);
      ctx.lineTo(PAD.left + plotW, p.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "#ffd54f";
      ctx.strokeStyle = "#0a0a0e";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fill();
    }
  }, [grid, values, metric, selected, scaleMin, span, plotW, plotH]);

  const cellAt = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!grid) return null;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * WIDTH;
    const y = ((e.clientY - rect.top) / rect.height) * HEIGHT;
    if (x < PAD.left || x > PAD.left + plotW || y < PAD.top || y > PAD.top + plotH) return null;
    const col = Math.min(grid.cols - 1, Math.floor(((x - PAD.left) / plotW) * grid.cols));
    const row = Math.min(grid.rows - 1, Math.floor(((PAD.top + plotH - y) / plotH) * grid.rows));
    return { col, row, x, y };
  };

  const hovered = grid && hover ? describe(grid, hover.col, hover.row) : null;

  return (
    <div style={{ position: "relative" }}>
      <canvas
        ref={canvasRef}
        style={{ width: WIDTH, maxWidth: "100%", height: "auto", aspectRatio: `${WIDTH} / ${HEIGHT}`, display: "block", cursor: grid ? "crosshair" : "default" }}
        onPointerMove={(e) => setHover(cellAt(e))}
        onPointerLeave={() => setHover(null)}
        onClick={(e) => {
          const c = cellAt(e);
          if (c && grid && Number.isFinite(values?.[c.row * grid.cols + c.col])) onSelect(c.col, c.row);
        }}
        aria-label={`Porkchop plot of ${METRIC_LABEL[metric]} by departure date and flight time`}
        role="img"
      />
      {computing && (
        <div style={{ position: "absolute", inset: `${PAD.top}px ${PAD.right}px ${PAD.bottom}px ${PAD.left}px`, display: "flex", alignItems: "center", justifyContent: "center", color: MUTED, fontSize: 11 }}>
          Solving transfers…
        </div>
      )}
      {hovered && hover && (
        <div
          style={{
            position: "absolute",
            left: Math.min(hover.x + 10, WIDTH - 170),
            top: Math.max(0, hover.y - 70),
            width: 160,
            padding: "6px 8px",
            borderRadius: 6,
            background: "rgba(12,14,20,0.96)",
            border: "1px solid rgba(255,255,255,0.18)",
            fontSize: 10,
            lineHeight: 1.45,
            color: TEXT,
            pointerEvents: "none",
            zIndex: 2,
          }}
        >
          <div>Leave {formatDate(hovered.departMs)}</div>
          <div>Arrive {formatDate(hovered.arriveMs)}</div>
          <div style={{ color: MUTED }}>{Math.round(hovered.tofDays)} days</div>
          {hovered.c3 === null ? (
            <div style={{ color: MUTED }}>No transfer</div>
          ) : (
            <>
              <div>C3 {hovered.c3.toFixed(1)} km²/s²</div>
              <div>Total Δv {hovered.total!.toFixed(2)} km/s</div>
            </>
          )}
        </div>
      )}
      <Legend metric={metric} min={scaleMin} span={span} />
    </div>
  );
}

function describe(grid: PorkchopGrid, col: number, row: number) {
  const i = row * grid.cols + col;
  const t = cellTimes(grid, col, row);
  const c3 = grid.c3[i];
  return { ...t, c3: Number.isFinite(c3) ? c3 : null, total: Number.isFinite(grid.total[i]) ? grid.total[i] : null };
}

function Legend({ metric, min, span }: { metric: PorkchopMetric; min: number; span: number }) {
  return (
    <div style={{ marginTop: 6, fontSize: 9, color: MUTED }}>
      <div style={{ display: "flex", gap: 2 }}>
        {RAMP.map((c) => (
          <div key={c} style={{ flex: 1, height: 7, background: c, borderRadius: 1 }} />
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 2 }}>
        <span>
          {min.toFixed(1)} {unit(metric)} · cheaper
        </span>
        <span>
          costlier · {(min + span).toFixed(0)}+
        </span>
      </div>
    </div>
  );
}

/** The few cheapest trips that aren't neighbours of each other: separate launch windows. */
export function bestWindows(grid: PorkchopGrid, count = 3, minGapDays = 120): { col: number; row: number; total: number; c3: number }[] {
  const cells: { col: number; row: number; total: number; c3: number }[] = [];
  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      const i = row * grid.cols + col;
      if (Number.isFinite(grid.total[i])) cells.push({ col, row, total: grid.total[i], c3: grid.c3[i] });
    }
  }
  cells.sort((a, b) => a.total - b.total);
  const picked: typeof cells = [];
  for (const c of cells) {
    if (picked.every((p) => Math.abs(p.col - c.col) * grid.departStepDays >= minGapDays)) picked.push(c);
    if (picked.length >= count) break;
  }
  return picked;
}
