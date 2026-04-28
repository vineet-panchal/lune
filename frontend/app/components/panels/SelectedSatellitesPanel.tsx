type SelectedSat = {
  satelliteId: number;
  name: string;
  color: string;
  altitudeKm: number;
};

type SelectedSatellitesPanelProps = {
  /** Push panel left when a full-height right sidebar is present (e.g. Orbital Intelligence). */
  rightInsetPx?: number;
  selectedSats: SelectedSat[];
  maxSelected: number;
  onRemoveSat: (id: number) => void;
  onClearAll: () => void;
};

export default function SelectedSatellitesPanel({
  rightInsetPx = 0,
  selectedSats,
  maxSelected,
  onRemoveSat,
  onClearAll,
}: SelectedSatellitesPanelProps) {
  if (selectedSats.length === 0) return null;

  return (
    <div
      style={{
        position: "absolute",
        top: 12,
        right: 12 + Math.max(0, rightInsetPx),
        padding: "10px 14px",
        borderRadius: 10,
        background: "rgba(0,0,0,0.65)",
        border: "1px solid rgba(255,255,255,0.12)",
        color: "white",
        fontFamily:
          "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        fontSize: 12,
        lineHeight: 1.6,
        minWidth: 200,
        maxWidth: 280,
        maxHeight: "50vh",
        overflowY: "auto",
      }}
    >
      {selectedSats.map((s) => (
        <div
          key={s.satelliteId}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "4px 0",
            borderBottom: "1px solid rgba(255,255,255,0.08)",
          }}
        >
          <span style={{ display: "flex", alignItems: "center", gap: 6, flex: 1, minWidth: 0 }}>
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: s.color,
                flexShrink: 0,
              }}
            />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {s.name}
            </span>
          </span>
          <button
            onClick={() => onRemoveSat(s.satelliteId)}
            style={{
              background: "none",
              border: "none",
              color: "rgba(255,255,255,0.5)",
              cursor: "pointer",
              fontSize: 14,
              padding: "0 4px",
              marginLeft: 8,
              flexShrink: 0,
            }}
            title="Remove"
          >
            ×
          </button>
        </div>
      ))}
      <div
        style={{
          marginTop: 6,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          fontSize: 11,
        }}
      >
        <span style={{ color: "rgba(255,255,255,0.3)" }}>max {maxSelected}</span>
        <span
          style={{
            color: "rgba(255,255,255,0.4)",
            cursor: "pointer",
          }}
          onClick={onClearAll}
        >
          clear all
        </span>
      </div>
    </div>
  );
}
