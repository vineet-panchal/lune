import { COLOR_MODE_GROUPS, type ColorMode, type LegendItem } from "../../lib/colorModes";

type AltitudeBand = {
  name: string;
  range: string;
  min: number;
  max: number;
  color: string;
};

export type ColorLegend = { items: LegendItem[]; categorical: boolean };

type OrbitalViewPanelProps = {
  altitudeBands: AltitudeBand[];
  /** Satellites currently drawn, and how many are in each altitude band (same order as altitudeBands). */
  shownCount: number;
  altitudeCounts: number[];
  satCount: number;
  /** Placed inside a right-hand column by the parent: sit at the bottom of it instead of positioning itself. */
  docked?: boolean;
  colorMode: ColorMode;
  onColorModeChange: (mode: ColorMode) => void;
  /** Legend for TLE-based colour modes; null in altitude mode, which is counted here from live positions. */
  legend: ColorLegend | null;
};

/** Constellation / launch can have hundreds of groups; show the largest and summarise the rest. */
const MAX_CATEGORY_ROWS = 8;
/** Longer legends (orbital plane, launch year) switch to two compact columns to keep the panel short. */
const COMPACT_LEGEND_ABOVE = 7;

export default function OrbitalViewPanel({
  altitudeBands,
  shownCount,
  altitudeCounts,
  satCount,
  docked = false,
  colorMode,
  onColorModeChange,
  legend,
}: OrbitalViewPanelProps) {
  const { items, categorical } = legend ?? { items: altitudeItems(altitudeBands, altitudeCounts), categorical: false };
  const listed = categorical ? items.slice(0, MAX_CATEGORY_ROWS) : items.filter((i) => i.key !== "Unknown" || i.count > 0);
  const rest = categorical ? items.slice(MAX_CATEGORY_ROWS) : [];
  const restCount = rest.reduce((sum, i) => sum + i.count, 0);
  const total = items.reduce((sum, i) => sum + i.count, 0) || 1;
  const compact = listed.length > COMPACT_LEGEND_ABOVE;

  return (
    <div
      style={{
        ...(docked
          ? { marginTop: "auto", flexShrink: 0, pointerEvents: "auto" as const }
          : { position: "absolute" as const, bottom: 16, right: 16 }),
        padding: "14px 16px",
        borderRadius: 12,
        background: "rgba(10,10,14,0.82)",
        border: "1px solid rgba(255,255,255,0.10)",
        color: "white",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        fontSize: 11,
        zIndex: 10,
        minWidth: 210,
        maxWidth: 280,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 10 }}>
        <span style={{ fontWeight: 700, fontSize: 13, letterSpacing: 0.3, whiteSpace: "nowrap" }}>Colour by</span>
        <select
          value={colorMode}
          onChange={(e) => onColorModeChange(e.target.value as ColorMode)}
          aria-label="Colour satellites by"
          style={{ fontSize: 12, padding: "2px 6px", borderRadius: 6, background: "#222", color: "#fff", border: "1px solid rgba(255,255,255,0.2)" }}
        >
          {COLOR_MODE_GROUPS.map((group) => (
            <optgroup key={group.label} label={group.label}>
              {group.modes.map((m) => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>
      <div style={{ borderTop: "1px solid rgba(255,255,255,0.10)", margin: "0 -16px 10px", padding: 0 }} />

      <div style={compact ? { display: "grid", gridTemplateColumns: "1fr 1fr", columnGap: 10 } : undefined}>
        {listed.map((item) => (
          <div key={item.key} style={{ display: "flex", alignItems: "flex-start", gap: compact ? 6 : 10, marginBottom: compact ? 5 : 8, minWidth: 0 }}>
            <span style={{ width: compact ? 10 : 14, height: compact ? 10 : 14, borderRadius: 3, background: item.color, flexShrink: 0, marginTop: compact ? 2 : 1 }} />
            <div style={{ lineHeight: 1.35, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: compact ? 10 : 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {item.label}
              </div>
              {item.detail && !compact && <div style={{ fontSize: 10, color: "rgba(255,255,255,0.5)" }}>{item.detail}</div>}
            </div>
          </div>
        ))}
      </div>
      {rest.length > 0 && (
        <div style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", marginBottom: 4 }}>
          + {rest.length.toLocaleString()} more {colorMode === "launch" ? "launches" : "groups"} (colours repeat)
        </div>
      )}

      <div style={{ borderTop: "1px solid rgba(255,255,255,0.10)", margin: "6px -16px 8px", padding: 0 }} />
      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.6)", marginBottom: 4, fontWeight: 600 }}>
        Distribution ({shownCount}{satCount > 0 && shownCount < satCount ? `/${satCount}` : ""} satellites)
      </div>
      {listed
        .filter((item) => item.count > 0)
        .map((item) => (
          <DistributionRow key={item.key} label={item.label.replace(/ \(.*\)/, "")} count={item.count} total={total} />
        ))}
      {restCount > 0 && <DistributionRow label={`Other ${colorMode === "launch" ? "launches" : "groups"}`} count={restCount} total={total} />}
    </div>
  );
}

function DistributionRow({ label, count, total }: { label: string; count: number; total: number }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "rgba(255,255,255,0.5)", lineHeight: 1.7 }}>
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
      <span style={{ marginLeft: 12, whiteSpace: "nowrap" }}>
        {count.toLocaleString()} ({((count / total) * 100).toFixed(1)}%)
      </span>
    </div>
  );
}

/** Altitude depends on current positions, so its counts come from the latest propagation. */
function altitudeItems(bands: AltitudeBand[], counts: number[]): LegendItem[] {
  return bands.map((b, i) => ({ key: b.name, label: b.name, detail: b.range, color: b.color, count: counts[i] ?? 0 }));
}
