import { useMemo, useState } from "react";
import type { OrbitPoint } from "../../../lib/clusterFeatures";
import { constellationHealth, type PlaneHealth, type ShellHealth } from "../../../lib/constellationHealth";
import { MUTED, TEXT, hintStyle, linkStyle } from "./ui";

type Props = {
  points: OrbitPoint[];
  /** Key of the shell / plane currently focused on the globe ("shell:…" or "plane:…"), or null. */
  focusedKey: string | null;
  onFocus: (key: string | null, ids: number[]) => void;
};

const SHORT = "#ffb74d";
const UNEVEN = "#ba68c8";

/** Shells → orbital planes, each plane checked for missing satellites (short) and gaps along the orbit (uneven). */
export default function ConstellationHealthView({ points, focusedKey, onFocus }: Props) {
  const health = useMemo(() => constellationHealth(points), [points]);
  const [open, setOpen] = useState<string | null>(null);

  if (points.length === 0) return <p style={hintStyle}>Waiting for satellites…</p>;
  return (
    <div>
      <p style={{ ...hintStyle, marginBottom: 10 }}>
        Satellites grouped into shells (same tilt and height) and orbital planes. In a constellation every plane of a
        shell should hold the same number of satellites, evenly spaced: <span style={{ color: SHORT }}>short</span>{" "}
        planes have empty slots, <span style={{ color: UNEVEN }}>uneven</span> ones have a big gap between neighbours.
        Estimated from TLEs, so treat it as a pointer to look closer, not an inventory.
      </p>
      {health.shells.length === 0 && <p style={hintStyle}>No shell with 10+ satellites in this selection.</p>}
      {health.shells.map((shell) => (
        <ShellRow
          key={shell.key}
          shell={shell}
          open={open === shell.key}
          onToggle={() => setOpen(open === shell.key ? null : shell.key)}
          focusedKey={focusedKey}
          onFocus={onFocus}
        />
      ))}
      {health.ungrouped > 0 && (
        <div style={{ fontSize: 10, color: MUTED, marginTop: 6 }}>
          + {health.ungrouped.toLocaleString()} satellites in groups too small to call a shell (e.g. still climbing).
        </div>
      )}
    </div>
  );
}

function ShellRow({ shell, open, onToggle, focusedKey, onFocus }: { shell: ShellHealth; open: boolean; onToggle: () => void } & Pick<Props, "focusedKey" | "onFocus">) {
  const shellKey = `shell:${shell.key}`;
  const focused = focusedKey === shellKey;
  return (
    <div style={{ borderBottom: "1px solid rgba(255,255,255,0.06)", padding: "5px 0" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        <button type="button" onClick={onToggle} aria-expanded={open} style={{ ...linkStyle, color: TEXT, fontSize: 11, flex: 1, textAlign: "left", whiteSpace: "normal" }}>
          {open ? "▾" : "▸"} {shell.inclinationDeg.toFixed(1)}° · {Math.round(shell.altitudeKm)} km
          <span style={{ color: MUTED, fontSize: 10 }}>
            {" "}
            · {shell.ids.length.toLocaleString()} sats · {shell.planes.length} plane{shell.planes.length === 1 ? "" : "s"}
            {shell.typicalPerPlane > 0 ? ` · ~${Math.round(shell.typicalPerPlane)}/plane` : ""}
          </span>
        </button>
        <button type="button" onClick={() => onFocus(focused ? null : shellKey, shell.ids)} style={{ ...linkStyle, color: focused ? "#e8f0ff" : undefined }}>
          {focused ? "unfocus" : "focus"}
        </button>
      </div>
      <div style={{ fontSize: 10, marginLeft: 12 }}>
        {shell.shortPlanes > 0 && <span style={{ color: SHORT }}>{shell.shortPlanes} short </span>}
        {shell.unevenPlanes > 0 && <span style={{ color: UNEVEN }}>{shell.unevenPlanes} uneven</span>}
        {shell.shortPlanes === 0 && shell.unevenPlanes === 0 && <span style={{ color: "#69f0ae" }}>all planes look complete</span>}
      </div>
      {open && (
        <div style={{ marginTop: 6, marginLeft: 12, display: "flex", flexDirection: "column", gap: 2 }}>
          {shell.planes.map((plane, i) => (
            <PlaneRow key={i} plane={plane} typical={shell.typicalPerPlane} planeKey={`plane:${shell.key}:${i}`} focusedKey={focusedKey} onFocus={onFocus} />
          ))}
        </div>
      )}
    </div>
  );
}

function PlaneRow({ plane, typical, planeKey, focusedKey, onFocus }: { plane: PlaneHealth; typical: number; planeKey: string } & Pick<Props, "focusedKey" | "onFocus">) {
  const focused = focusedKey === planeKey;
  const fill = typical > 0 ? Math.min(1, plane.count / typical) : 1;
  const color = plane.short ? SHORT : plane.uneven ? UNEVEN : "#7ba4e8";
  const issues = [
    plane.short ? `${Math.max(0, Math.round(typical) - plane.count)} short` : null,
    plane.uneven ? `gap ${Math.round(plane.maxGapDeg)}° (even: ${Math.round(plane.evenGapDeg)}°)` : null,
  ].filter(Boolean);
  return (
    <button
      type="button"
      onClick={() => onFocus(focused ? null : planeKey, plane.ids)}
      title="Focus this plane on the globe"
      style={{
        display: "grid",
        gridTemplateColumns: "44px 1fr auto",
        gap: 6,
        alignItems: "center",
        padding: "2px 4px",
        borderRadius: 4,
        border: focused ? "1px solid rgba(123,164,232,0.55)" : "1px solid transparent",
        background: focused ? "rgba(86,132,214,0.18)" : "transparent",
        color: MUTED,
        font: "inherit",
        fontSize: 10,
        cursor: "pointer",
        textAlign: "left",
      }}
    >
      <span>{Math.round(plane.raanDeg)}°</span>
      <span style={{ height: 6, borderRadius: 3, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
        <span style={{ display: "block", height: "100%", width: `${fill * 100}%`, background: color }} />
      </span>
      <span style={{ whiteSpace: "nowrap", color: issues.length ? color : MUTED }}>
        {plane.count}
        {issues.length ? ` · ${issues.join(" · ")}` : ""}
      </span>
    </button>
  );
}
