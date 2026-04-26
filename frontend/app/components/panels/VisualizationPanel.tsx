type VisualizationPanelProps = {
  isDayMode: boolean;
  showAtmosphere: boolean;
  showGraticules: boolean;
  atmosphereAltitude: number;
  atmosphereColor: string;
  rotationSpeed: number;
  onToggleDayMode: () => void;
  onToggleAtmosphere: () => void;
  onToggleGraticules: () => void;
  onUpdateAtmosphereColorPreset: (color: string) => void;
  onUpdateAtmosphereAltitude: (value: number) => void;
  onUpdateRotationSpeed: (value: number) => void;
  onResetVisualization: () => void;
};

const ATMOSPHERE_PRESETS = [
  { color: "rgba(100, 160, 255, 0.5)", label: "Blue" },
  { color: "rgba(100, 200, 255, 0.4)", label: "Cyan" },
  { color: "rgba(150, 100, 255, 0.5)", label: "Purple" },
  { color: "rgba(255, 100, 150, 0.4)", label: "Pink" },
];

export default function VisualizationPanel({
  isDayMode,
  showAtmosphere,
  showGraticules,
  atmosphereAltitude,
  atmosphereColor,
  rotationSpeed,
  onToggleDayMode,
  onToggleAtmosphere,
  onToggleGraticules,
  onUpdateAtmosphereColorPreset,
  onUpdateAtmosphereAltitude,
  onUpdateRotationSpeed,
  onResetVisualization,
}: VisualizationPanelProps) {
  return (
    <div
      style={{
        position: "absolute",
        bottom: 16,
        left: 16,
        padding: "12px 16px",
        borderRadius: 12,
        background: "rgba(10,10,14,0.82)",
        border: "1px solid rgba(255,255,255,0.10)",
        color: "white",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        fontSize: 11,
        zIndex: 9,
        display: "flex",
        gap: 12,
        alignItems: "center",
        flexWrap: "wrap",
        maxWidth: "calc(100vw - 32px)",
      }}
    >
      <div style={{ fontWeight: 700, fontSize: 12, letterSpacing: 0.3, minWidth: "fit-content" }}>
        VISUALIZE
      </div>

      <div style={{ width: 1, height: 20, background: "rgba(255,255,255,0.15)" }} />

      <button
        onClick={onToggleDayMode}
        style={{
          padding: "6px 12px",
          borderRadius: 6,
          background: isDayMode ? "rgba(255,193,7,0.3)" : "rgba(100,160,255,0.2)",
          border: `1px solid ${isDayMode ? "rgba(255,193,7,0.5)" : "rgba(100,160,255,0.3)"}`,
          color: isDayMode ? "#ffc107" : "#64a0ff",
          cursor: "pointer",
          fontSize: 11,
          fontFamily: "inherit",
          fontWeight: 600,
          transition: "all 0.2s ease",
          whiteSpace: "nowrap",
        }}
        title={isDayMode ? "Switch to Night Mode" : "Switch to Day Mode"}
      >
        {isDayMode ? "☀️ Day" : "🌙 Night"}
      </button>

      <button
        onClick={onToggleAtmosphere}
        style={{
          padding: "6px 12px",
          borderRadius: 6,
          background: showAtmosphere ? "rgba(100,160,255,0.2)" : "rgba(100,100,100,0.2)",
          border: `1px solid ${showAtmosphere ? "rgba(100,160,255,0.3)" : "rgba(100,100,100,0.3)"}`,
          color: showAtmosphere ? "#64a0ff" : "rgba(255,255,255,0.4)",
          cursor: "pointer",
          fontSize: 11,
          fontFamily: "inherit",
          whiteSpace: "nowrap",
        }}
        title={showAtmosphere ? "Hide Atmosphere" : "Show Atmosphere"}
      >
        {showAtmosphere ? "✓" : ""} Atmosphere
      </button>

      <button
        onClick={onToggleGraticules}
        style={{
          padding: "6px 12px",
          borderRadius: 6,
          background: showGraticules ? "rgba(100,160,255,0.2)" : "rgba(100,100,100,0.2)",
          border: `1px solid ${showGraticules ? "rgba(100,160,255,0.3)" : "rgba(100,100,100,0.3)"}`,
          color: showGraticules ? "#64a0ff" : "rgba(255,255,255,0.4)",
          cursor: "pointer",
          fontSize: 11,
          fontFamily: "inherit",
          whiteSpace: "nowrap",
        }}
        title={showGraticules ? "Hide Grid" : "Show Grid"}
      >
        {showGraticules ? "✓" : ""} Grid
      </button>

      {!isDayMode && (
        <>
          <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 10 }}>|</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ fontSize: 10, color: "rgba(255,255,255,0.5)" }}>Atmosphere:</span>
            {ATMOSPHERE_PRESETS.map((preset) => (
              <button
                key={preset.label}
                onClick={() => onUpdateAtmosphereColorPreset(preset.color)}
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: 3,
                  background: preset.color,
                  border: atmosphereColor === preset.color ? "2px solid #fff" : "1px solid rgba(255,255,255,0.3)",
                  cursor: "pointer",
                  padding: 0,
                }}
                title={preset.label}
              />
            ))}
          </div>
        </>
      )}

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", minWidth: "fit-content" }}>Altitude:</span>
        <input
          type="range"
          min="0.05"
          max="0.3"
          step="0.01"
          value={atmosphereAltitude}
          onChange={(e) => onUpdateAtmosphereAltitude(parseFloat(e.target.value))}
          style={{
            width: 80,
            height: 4,
            cursor: "pointer",
          }}
          title="Adjust atmosphere thickness"
        />
        <span style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", minWidth: "30px" }}>
          {(atmosphereAltitude * 100).toFixed(0)}%
        </span>
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", minWidth: "fit-content" }}>Rotate:</span>
        <input
          type="range"
          min="0"
          max="3"
          step="0.5"
          value={rotationSpeed}
          onChange={(e) => onUpdateRotationSpeed(parseFloat(e.target.value))}
          style={{
            width: 80,
            height: 4,
            cursor: "pointer",
          }}
          title="Adjust auto-rotation speed"
        />
      </div>

      <button
        onClick={onResetVisualization}
        style={{
          padding: "6px 10px",
          borderRadius: 6,
          background: "rgba(255,255,255,0.08)",
          border: "1px solid rgba(255,255,255,0.2)",
          color: "rgba(255,255,255,0.6)",
          cursor: "pointer",
          fontSize: 11,
          fontFamily: "inherit",
          whiteSpace: "nowrap",
        }}
        title="Reset to defaults"
      >
        Reset
      </button>
    </div>
  );
}
