"use client";

import { useState } from "react";
import type { IconType } from "react-icons";
import {
  MdAutoAwesome,
  MdBlurOn,
  MdBorderAll,
  MdCloud,
  MdGrid4X4,
  MdNightlight,
  MdPublic,
  MdWbSunny,
} from "react-icons/md";

type VisualizationPanelProps = {
  isDayMode: boolean;
  showAtmosphere: boolean;
  showGraticules: boolean;
  showBorders: boolean;
  showClouds: boolean;
  mapStyleLabel: string;
  spaceStyleLabel: string;
  atmosphereAltitude: number;
  atmosphereColor: string;
  rotationSpeed: number;
  onToggleDayMode: () => void;
  onToggleAtmosphere: () => void;
  onToggleGraticules: () => void;
  onToggleBorders: () => void;
  onCycleMapStyle: () => void;
  onToggleClouds: () => void;
  onCycleSpaceStyle: () => void;
  onUpdateAtmosphereColorPreset: (color: string) => void;
  onUpdateAtmosphereAltitude: (value: number) => void;
  onUpdateRotationSpeed: (value: number) => void;
  onResetVisualization: () => void;
};

const ATMOSPHERE_PRESETS = [
  { color: "rgba(100, 160, 255, 0.5)", label: "Blue" },
  { color: "rgba(100, 200, 255, 0.4)", label: "Cyan" },
  { color: "rgba(255, 255, 255, 0.42)", label: "White" },
  { color: "rgba(150, 100, 255, 0.5)", label: "Purple" },
  { color: "rgba(255, 100, 150, 0.4)", label: "Pink" },
];

const ICON_SIZE = 14;

function ToolbarIconButton({
  label,
  active,
  onClick,
  Icon,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  Icon: IconType;
}) {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <div style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
      {isHovered && (
        <div
          style={{
            position: "absolute",
            bottom: "calc(100% + 8px)",
            left: "50%",
            transform: "translateX(-50%)",
            padding: "4px 8px",
            borderRadius: 999,
            background: "rgba(8, 10, 18, 0.96)",
            border: "1px solid rgba(255,255,255,0.16)",
              color: "#d4dded",
            fontSize: 10,
            letterSpacing: 0.2,
            whiteSpace: "nowrap",
            pointerEvents: "none",
            boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
            zIndex: 2,
          }}
        >
          {label}
        </div>
      )}
      <button
        onClick={onClick}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        onFocus={() => setIsHovered(true)}
        onBlur={() => setIsHovered(false)}
        aria-label={label}
        title={label}
        style={{
          width: 32,
          height: 32,
          borderRadius: 9,
          background: active ? "rgba(111, 142, 201, 0.18)" : "rgba(173, 189, 220, 0.08)",
          border: `1px solid ${active ? "rgba(133, 165, 230, 0.42)" : "rgba(154, 171, 199, 0.22)"}`,
          color: active ? "#c5d5f1" : "rgba(180, 195, 222, 0.92)",
          cursor: "pointer",
          display: "grid",
          placeItems: "center",
          transition: "transform 0.16s ease, border-color 0.16s ease, background 0.16s ease, color 0.16s ease",
          boxShadow: active
            ? "inset 0 0 0 1px rgba(170, 193, 236, 0.16), 0 2px 10px rgba(0,0,0,0.18)"
            : "inset 0 0 0 1px rgba(255,255,255,0.02)",
        }}
        onMouseDown={(event) => event.preventDefault()}
      >
        <Icon size={ICON_SIZE} aria-hidden="true" />
      </button>
    </div>
  );
}

export default function VisualizationPanel({
  isDayMode,
  showAtmosphere,
  showGraticules,
  showBorders,
  showClouds,
  mapStyleLabel,
  spaceStyleLabel,
  atmosphereAltitude,
  atmosphereColor,
  rotationSpeed,
  onToggleDayMode,
  onToggleAtmosphere,
  onToggleGraticules,
  onToggleBorders,
  onCycleMapStyle,
  onToggleClouds,
  onCycleSpaceStyle,
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

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <ToolbarIconButton
          label={isDayMode ? "Day" : "Night"}
          active
          onClick={onToggleDayMode}
          Icon={isDayMode ? MdWbSunny : MdNightlight}
        />

        <ToolbarIconButton
          label="Atmosphere"
          active={showAtmosphere}
          onClick={onToggleAtmosphere}
          Icon={MdBlurOn}
        />

        <ToolbarIconButton
          label={showGraticules ? "Lat/Lon Off" : "Lat/Lon On"}
          active={showGraticules}
          onClick={onToggleGraticules}
          Icon={MdGrid4X4}
        />

        <ToolbarIconButton
          label={showBorders ? "Borders Off" : "Borders On"}
          active={showBorders}
          onClick={onToggleBorders}
          Icon={MdBorderAll}
        />

        <ToolbarIconButton
          label={`Map Style: ${mapStyleLabel}`}
          active
          onClick={onCycleMapStyle}
          Icon={MdPublic}
        />

        <ToolbarIconButton
          label={showClouds ? "Clouds Off" : "Clouds On"}
          active={showClouds}
          onClick={onToggleClouds}
          Icon={MdCloud}
        />

        <ToolbarIconButton
          label={`Space Style: ${spaceStyleLabel}`}
          active
          onClick={onCycleSpaceStyle}
          Icon={MdAutoAwesome}
        />
      </div>

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
          padding: "4px 8px",
          borderRadius: 5,
          background: "rgba(255,255,255,0.08)",
          border: "1px solid rgba(255,255,255,0.2)",
          color: "rgba(255,255,255,0.6)",
          cursor: "pointer",
          fontSize: 10,
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
