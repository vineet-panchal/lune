import { useEffect, useState } from "react";
import type { SkyView } from "../../../lib/coverage";
import { compassPoint, type Observer } from "../../../lib/passes";
import { LocationForm } from "../PassPredictions";
import { MUTED, TEXT, hintStyle, linkStyle, selectStyle } from "./ui";
import { heatColor } from "../../../lib/coverageHeatmap";

type Props = {
  observer: Observer | null;
  onObserverChange: (observer: Observer | null) => void;
  /** What the loaded satellites look like from the observer at the globe's current time. */
  getSkyView: (observer: Observer) => SkyView | null;
  /** Coverage map on the globe at this minimum elevation, or null to hide it. */
  coverageMinElevation: number | null;
  onCoverageChange: (minElevationDeg: number | null) => void;
  /** Busiest cell on the current coverage map (for the legend). */
  coverageMax: number;
  onShow: (satelliteId: number) => void;
  onHover: (satelliteId: number | null) => void;
};

const REFRESH_MS = 5000;
const ELEVATIONS = [10, 25, 40];

/** "How many of these satellites can I see right now?" and a map of where on Earth sees the most of them. */
export default function MySky({ observer, onObserverChange, getSkyView, coverageMinElevation, onCoverageChange, coverageMax, onShow, onHover }: Props) {
  const [editing, setEditing] = useState(false);
  const [view, setView] = useState<SkyView | null>(null);

  useEffect(() => {
    if (!observer) return;
    const update = () => setView(getSkyView(observer));
    update();
    const timer = window.setInterval(update, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [observer, getSkyView]);

  return (
    <div>
      <div style={{ fontWeight: 600, fontSize: 11, color: "#c5d5f1", marginBottom: 6 }}>From my location</div>
      {!observer || editing ? (
        <LocationForm
          current={observer}
          onSave={(o) => {
            onObserverChange(o);
            setEditing(false);
          }}
          onCancel={observer ? () => setEditing(false) : undefined}
        />
      ) : (
        <div style={{ fontSize: 10, color: MUTED, lineHeight: 1.6 }}>
          <div>
            {formatLatLng(observer)} ·{" "}
            <button type="button" onClick={() => setEditing(true)} style={linkStyle}>change</button>
          </div>
          {view && (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6, margin: "8px 0" }}>
                <Stat value={view.aboveHorizon} label="above horizon" />
                <Stat value={view.above10} label="above 10°" />
                <Stat value={view.above30} label="above 30°" />
              </div>
              <div>
                {skyDescription(view.sunElevationDeg)}
                {view.sunElevationDeg < -6 && (
                  <>
                    {" "}
                    · <span style={{ color: "#66bb6a" }}>{view.visibleToEye}</span> sunlit and high enough to see with your eyes
                  </>
                )}
              </div>
              {view.highest.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ marginBottom: 2 }}>Highest in your sky now:</div>
                  {view.highest.map((s) => (
                    <div
                      key={s.satelliteId}
                      onMouseEnter={() => onHover(s.satelliteId)}
                      onMouseLeave={() => onHover(null)}
                      style={{ display: "flex", gap: 6, alignItems: "baseline" }}
                    >
                      <span style={{ color: TEXT, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</span>
                      <span>
                        {Math.round(s.elevationDeg)}° {compassPoint(s.azimuthDeg)}
                        {s.sunlit ? "" : " · shadow"}
                      </span>
                      <button type="button" onClick={() => onShow(s.satelliteId)} style={linkStyle}>show</button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      <div style={{ fontWeight: 600, fontSize: 11, color: "#c5d5f1", margin: "14px 0 6px" }}>Coverage map</div>
      <p style={{ ...hintStyle, marginBottom: 8 }}>
        Colours the globe by how many loaded satellites each place can see at once. Updates as time moves.
      </p>
      <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 10, color: MUTED }}>
        <input
          type="checkbox"
          checked={coverageMinElevation !== null}
          onChange={(e) => onCoverageChange(e.target.checked ? 25 : null)}
          style={{ accentColor: "#7ba4e8", margin: 0 }}
        />
        Show on the globe, counting satellites above
        <select
          value={coverageMinElevation ?? 25}
          onChange={(e) => onCoverageChange(Number(e.target.value))}
          disabled={coverageMinElevation === null}
          style={selectStyle}
        >
          {ELEVATIONS.map((e) => (
            <option key={e} value={e}>{e}°</option>
          ))}
        </select>
      </label>
      {coverageMinElevation !== null && coverageMax > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10, color: MUTED, marginTop: 8 }}>
          <span>1</span>
          <span style={{ flex: 1, height: 8, borderRadius: 4, background: legendGradient(coverageMax) }} />
          <span>{coverageMax} satellites</span>
        </div>
      )}
    </div>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div style={{ padding: "6px 8px", borderRadius: 8, background: "rgba(255,255,255,0.04)", textAlign: "center" }}>
      <div style={{ color: TEXT, fontSize: 15, fontWeight: 700 }}>{value.toLocaleString()}</div>
      <div>{label}</div>
    </div>
  );
}

function skyDescription(sunElevationDeg: number): string {
  if (sunElevationDeg > 0) return "Daytime where you are: satellites are too faint to see";
  if (sunElevationDeg > -6) return "Twilight where you are: too bright for most satellites";
  return "Your sky is dark";
}

function legendGradient(max: number): string {
  const stops = [1, 0.33, 0.66, 1].map((f, i) => {
    const [r, g, b] = heatColor(Math.max(1, Math.round(f * max)), max);
    return `rgb(${r},${g},${b}) ${Math.round((i / 3) * 100)}%`;
  });
  return `linear-gradient(90deg, ${stops.join(", ")})`;
}

function formatLatLng(o: Observer): string {
  return `${Math.abs(o.latDeg).toFixed(2)}°${o.latDeg >= 0 ? "N" : "S"}, ${Math.abs(o.lngDeg).toFixed(2)}°${o.lngDeg >= 0 ? "E" : "W"}`;
}
