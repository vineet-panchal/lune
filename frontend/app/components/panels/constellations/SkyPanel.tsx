import { useState, type CSSProperties } from "react";
import type { Observer } from "../../../lib/passes";
import type { SkyLayers } from "../../../lib/sky/celestialSphereLayer";
import { LocationForm } from "../PassPredictions";
import { MUTED, TEXT, chipStyle, hintStyle, linkStyle, selectStyle } from "../analytics/ui";

export type SkyView = "sphere" | "sky";

/** Satellites drawn in "My sky" (CelesTrak groups; "visual" is the ~150 brightest). */
export const SATELLITE_SETS = [
  { id: "visual", label: "Brightest satellites", type: "VISUAL" },
  { id: "stations", label: "Space stations", type: "STATIONS" },
  { id: "popular", label: "Popular (ISS, Hubble…)", group: "popular" },
  { id: "none", label: "None" },
] as const;
export type SatelliteSetId = (typeof SATELLITE_SETS)[number]["id"];

const LAYER_OPTIONS: { id: keyof SkyLayers; label: string }[] = [
  { id: "lines", label: "Figures" },
  { id: "labels", label: "Names" },
  { id: "starNames", label: "Star names" },
  { id: "bounds", label: "Boundaries" },
  { id: "ecliptic", label: "Ecliptic" },
  { id: "bodies", label: "Sun, Moon & planets" },
];

type SkyPanelProps = {
  view: SkyView;
  onViewChange: (view: SkyView) => void;
  layers: SkyLayers;
  onLayersChange: (layers: SkyLayers) => void;
  satelliteSet: SatelliteSetId;
  onSatelliteSetChange: (id: SatelliteSetId) => void;
  /** Satellites loaded for My sky, or null while loading. */
  satelliteCount: number | null;
  observer: Observer | null;
  onObserverChange: (observer: Observer | null) => void;
  loadError: string | null;
};

export default function SkyPanel({
  view,
  onViewChange,
  layers,
  onLayersChange,
  satelliteSet,
  onSatelliteSetChange,
  satelliteCount,
  observer,
  onObserverChange,
  loadError,
}: SkyPanelProps) {
  const [editingLocation, setEditingLocation] = useState(false);
  return (
    <div style={panelStyle}>
      <div style={{ fontWeight: 700, marginBottom: 8 }}>Night Sky</div>
      <div role="tablist" aria-label="View" style={{ display: "flex", gap: 6, marginBottom: 8 }}>
        <button type="button" role="tab" aria-selected={view === "sphere"} onClick={() => onViewChange("sphere")} style={chipStyle(view === "sphere")}>
          Celestial sphere
        </button>
        <button type="button" role="tab" aria-selected={view === "sky"} onClick={() => onViewChange("sky")} style={chipStyle(view === "sky")}>
          My sky
        </button>
      </div>
      <p style={{ ...hintStyle, marginBottom: 10 }}>
        {view === "sphere"
          ? "The stars around the Earth as it turns inside them. Drag to look around; hover for names."
          : "Your whole sky: overhead in the middle, the horizon at the edge, north up and east left (hold it above you). Scroll to zoom, drag to pan, double-click to reset."}
      </p>

      {loadError && <div style={{ color: "#ff8a80", fontSize: 11, marginBottom: 8 }}>{loadError}</div>}

      <div style={{ color: MUTED, fontSize: 10, marginBottom: 4 }}>Show</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 10 }}>
        {LAYER_OPTIONS.map((o) => (
          <button
            key={o.id}
            type="button"
            aria-pressed={layers[o.id]}
            onClick={() => onLayersChange({ ...layers, [o.id]: !layers[o.id] })}
            style={{ ...chipStyle(layers[o.id]), padding: "3px 8px", fontSize: 10 }}
          >
            {o.label}
          </button>
        ))}
      </div>

      <div style={{ color: MUTED, fontSize: 10, marginBottom: 4 }}>Your location</div>
      {!observer || editingLocation ? (
        <div style={{ marginBottom: 8, fontSize: 11 }}>
          {!observer && <div style={{ ...hintStyle, marginBottom: 4 }}>Needed for My sky and for what&apos;s up tonight.</div>}
          <LocationForm
            current={observer}
            onSave={(o) => {
              onObserverChange(o);
              setEditingLocation(false);
            }}
            onCancel={observer ? () => setEditingLocation(false) : undefined}
          />
        </div>
      ) : (
        <div style={{ fontSize: 11, color: TEXT, marginBottom: 8 }}>
          {formatLatLng(observer)} ·{" "}
          <button type="button" onClick={() => setEditingLocation(true)} style={linkStyle}>
            change
          </button>
        </div>
      )}

      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10, color: MUTED }}>
        Satellites in My sky
        <select value={satelliteSet} onChange={(e) => onSatelliteSetChange(e.target.value as SatelliteSetId)} style={selectStyle}>
          {SATELLITE_SETS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
      {satelliteSet !== "none" && (
        <div style={{ fontSize: 10, color: MUTED, marginTop: 4 }}>
          {satelliteCount === null
            ? "Loading satellites…"
            : satelliteCount === 0
              ? "None available right now (the catalogue couldn't download this set); try another."
              : `${satelliteCount.toLocaleString()} loaded · bright = sunlit against a dark sky`}
        </div>
      )}
    </div>
  );
}

export const panelStyle: CSSProperties = {
  padding: "10px 12px",
  borderRadius: 10,
  background: "rgba(0,0,0,0.6)",
  border: "1px solid rgba(255,255,255,0.12)",
  color: "white",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  fontSize: 12,
  lineHeight: 1.4,
  width: 300,
  maxWidth: "100%",
  boxSizing: "border-box",
  pointerEvents: "auto",
};

function formatLatLng(o: Observer): string {
  return `${Math.abs(o.latDeg).toFixed(2)}°${o.latDeg >= 0 ? "N" : "S"}, ${Math.abs(o.lngDeg).toFixed(2)}°${o.lngDeg >= 0 ? "E" : "W"}`;
}
