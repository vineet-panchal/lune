import { useEffect, useMemo, useRef, useState } from "react";
import { ORBIT_AXES, type OrbitAxis, type OrbitPoint } from "../../../lib/clusterFeatures";
import { clusterLabelToColor, type ClusterAlgorithm } from "../../../lib/clusterLabels";
import { useStore, type ReadableStore } from "../../../lib/store";
import { MUTED, TEXT, selectStyle } from "./ui";

type OrbitScatterProps = {
  points: OrbitPoint[];
  /** Cluster label per satellite after a run (dots take the group's colour), or null before one. */
  labelById: Map<number, number> | null;
  algorithm: ClusterAlgorithm | null;
  /** While a group is focused, everything else is drawn faint (as on the globe). */
  focusIds: Set<number> | null;
  /** Satellite under the pointer on the globe: marked here too. */
  globeHover: ReadableStore<number | null>;
  onHover: (satelliteId: number | null) => void;
  onPick: (satelliteId: number) => void;
};

const HEIGHT = 230;
const PAD = { left: 40, right: 10, top: 8, bottom: 26 };
const HIT_RADIUS_PX = 7;
const NEUTRAL = "#4fc3f7";

/**
 * Every loaded satellite on two orbit axes (default: inclination vs altitude, which separates the shells),
 * coloured by the last run. Hovering a dot lights the satellite up on the globe, and the satellite hovered on the
 * globe is ringed here; clicking a dot selects and follows it.
 */
export default function OrbitScatter({ points, labelById, algorithm, focusIds, globeHover, onHover, onPick }: OrbitScatterProps) {
  const [xAxis, setXAxis] = useState<OrbitAxis>("inclinationDeg");
  const [yAxis, setYAxis] = useState<OrbitAxis>("altitudeKm");
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const baseRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const [width, setWidth] = useState(0);
  const [hovered, setHovered] = useState<OrbitPoint | null>(null);
  const globeHoverId = useStore(globeHover);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Screen position of every point; axes span the 0.5–99.5 percentile so a few stray orbits don't squash the rest.
  const layout = useMemo(() => {
    if (width === 0 || points.length === 0) return null;
    const xr = robustRange(points.map((p) => p[xAxis]));
    const yr = robustRange(points.map((p) => p[yAxis]));
    const plotW = width - PAD.left - PAD.right;
    const plotH = HEIGHT - PAD.top - PAD.bottom;
    const sx = new Float32Array(points.length);
    const sy = new Float32Array(points.length);
    points.forEach((p, i) => {
      sx[i] = PAD.left + clamp01((p[xAxis] - xr.min) / (xr.max - xr.min || 1)) * plotW;
      sy[i] = PAD.top + plotH - clamp01((p[yAxis] - yr.min) / (yr.max - yr.min || 1)) * plotH;
    });
    return { xr, yr, sx, sy, plotW, plotH };
  }, [points, xAxis, yAxis, width]);

  const indexById = useMemo(() => new Map(points.map((p, i) => [p.satelliteId, i])), [points]);

  // Base layer: all dots (redrawn when data, colours, focus or axes change).
  useEffect(() => {
    const canvas = baseRef.current;
    if (!canvas || !layout) return;
    const ctx = sizeCanvas(canvas, width);
    ctx.clearRect(0, 0, width, HEIGHT);
    drawAxes(ctx, layout, xAxis, yAxis);
    const drawDots = (faint: boolean) => {
      ctx.globalAlpha = faint ? 0.12 : 0.75;
      points.forEach((p, i) => {
        const inFocus = !focusIds || focusIds.has(p.satelliteId);
        if (inFocus === faint) return;
        const label = labelById?.get(p.satelliteId);
        ctx.fillStyle = label !== undefined ? clusterLabelToColor(label, algorithm) : NEUTRAL;
        ctx.fillRect(layout.sx[i] - 1, layout.sy[i] - 1, 2, 2);
      });
    };
    drawDots(true); // faint ones first, so the focused group draws on top
    drawDots(false);
    ctx.globalAlpha = 1;
  }, [layout, points, labelById, algorithm, focusIds, xAxis, yAxis, width]);

  // Overlay: rings for the satellite hovered here and the one hovered on the globe.
  useEffect(() => {
    const canvas = overlayRef.current;
    if (!canvas || !layout) return;
    const ctx = sizeCanvas(canvas, width);
    ctx.clearRect(0, 0, width, HEIGHT);
    for (const [id, color] of [[globeHoverId, "#ffffff"], [hovered?.satelliteId ?? null, "#ffd54f"]] as const) {
      const i = id === null ? undefined : indexById.get(id);
      if (i === undefined) continue;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(layout.sx[i], layout.sy[i], 5, 0, Math.PI * 2);
      ctx.stroke();
    }
  }, [layout, globeHoverId, hovered, indexById, width]);

  const nearest = (clientX: number, clientY: number): OrbitPoint | null => {
    const canvas = overlayRef.current;
    if (!canvas || !layout) return null;
    const rect = canvas.getBoundingClientRect();
    const mx = clientX - rect.left;
    const my = clientY - rect.top;
    let best = -1;
    let bestD = HIT_RADIUS_PX * HIT_RADIUS_PX;
    for (let i = 0; i < points.length; i++) {
      if (focusIds && !focusIds.has(points[i].satelliteId)) continue;
      const dx = layout.sx[i] - mx;
      const dy = layout.sy[i] - my;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best >= 0 ? points[best] : null;
  };

  const setHover = (p: OrbitPoint | null) => {
    if (p?.satelliteId === hovered?.satelliteId) return;
    setHovered(p);
    onHover(p?.satelliteId ?? null);
  };

  const axisSelect = (value: OrbitAxis, onChange: (axis: OrbitAxis) => void, label: string) => (
    <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value as OrbitAxis)} style={selectStyle}>
        {ORBIT_AXES.map((a) => (
          <option key={a.id} value={a.id}>{a.label}</option>
        ))}
      </select>
    </label>
  );

  return (
    <div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", fontSize: 10, color: MUTED, marginBottom: 6 }}>
        {axisSelect(xAxis, setXAxis, "x")}
        {axisSelect(yAxis, setYAxis, "y")}
      </div>
      <div ref={wrapRef} style={{ position: "relative", height: HEIGHT }}>
        <canvas ref={baseRef} style={{ position: "absolute", inset: 0 }} />
        <canvas
          ref={overlayRef}
          style={{ position: "absolute", inset: 0, cursor: hovered ? "pointer" : "crosshair" }}
          onMouseMove={(e) => setHover(nearest(e.clientX, e.clientY))}
          onMouseLeave={() => setHover(null)}
          onClick={(e) => {
            const p = nearest(e.clientX, e.clientY);
            if (p) onPick(p.satelliteId);
          }}
        />
        {points.length === 0 && (
          <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", fontSize: 10, color: MUTED }}>
            Waiting for satellites…
          </div>
        )}
      </div>
      <div style={{ minHeight: 28, fontSize: 10, color: MUTED, lineHeight: 1.4, marginTop: 4 }}>
        {hovered ? (
          <>
            <span style={{ color: TEXT }}>{hovered.name}</span> · {formatValue(xAxis, hovered[xAxis])} · {formatValue(yAxis, hovered[yAxis])}
            <br />
            Click to select it and follow it on the globe.
          </>
        ) : (
          "Hover a dot to find it on the globe; hover the globe to find it here."
        )}
      </div>
    </div>
  );
}

function drawAxes(
  ctx: CanvasRenderingContext2D,
  layout: { xr: { min: number; max: number }; yr: { min: number; max: number }; plotW: number; plotH: number },
  xAxis: OrbitAxis,
  yAxis: OrbitAxis
) {
  const x0 = PAD.left;
  const y0 = PAD.top + layout.plotH;
  ctx.strokeStyle = "rgba(255,255,255,0.2)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x0, PAD.top);
  ctx.lineTo(x0, y0);
  ctx.lineTo(x0 + layout.plotW, y0);
  ctx.stroke();
  ctx.fillStyle = MUTED;
  ctx.font = "9px ui-monospace, Menlo, monospace";
  ctx.textAlign = "left";
  ctx.fillText(formatValue(xAxis, layout.xr.min), x0, y0 + 11);
  ctx.textAlign = "right";
  ctx.fillText(formatValue(xAxis, layout.xr.max), x0 + layout.plotW, y0 + 11);
  ctx.textAlign = "center";
  ctx.fillText(axisTitle(xAxis), x0 + layout.plotW / 2, y0 + 22);
  ctx.textAlign = "right";
  ctx.fillText(formatValue(yAxis, layout.yr.max), x0 - 3, PAD.top + 8);
  ctx.fillText(formatValue(yAxis, layout.yr.min), x0 - 3, y0);
  ctx.save();
  ctx.translate(10, PAD.top + layout.plotH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = "center";
  ctx.fillText(axisTitle(yAxis), 0, 0);
  ctx.restore();
}

function axisTitle(axis: OrbitAxis): string {
  const a = ORBIT_AXES.find((x) => x.id === axis);
  return a ? `${a.label}${a.unit ? ` (${a.unit})` : ""}` : axis;
}

function formatValue(axis: OrbitAxis, v: number): string {
  switch (axis) {
    case "altitudeKm":
      return `${Math.round(v).toLocaleString()} km`;
    case "inclinationDeg":
    case "raanDeg":
      return `${v.toFixed(1)}°`;
    case "eccentricity":
      return v.toFixed(4);
    case "periodMin":
      return `${v.toFixed(1)} min`;
  }
}

/** Canvas sized for the screen's pixel density; returns a context drawing in CSS pixels. */
function sizeCanvas(canvas: HTMLCanvasElement, width: number): CanvasRenderingContext2D {
  const dpr = window.devicePixelRatio || 1;
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(HEIGHT * dpr)) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(HEIGHT * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${HEIGHT}px`;
  }
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

function robustRange(values: number[]): { min: number; max: number } {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * q)))];
  const min = at(0.005);
  const max = at(0.995);
  const pad = (max - min) * 0.04 || Math.abs(min) * 0.01 || 1;
  return { min: min - pad, max: max + pad };
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
