type Sat = {
  satelliteId: number;
  name: string;
  latitude: number;
  longitude: number;
  altitudeKm: number;
  type?: string;
};

type AltitudeBand = {
  name: string;
  range: string;
  min: number;
  max: number;
  color: string;
};

type OrbitalViewPanelProps = {
  altitudeBands: AltitudeBand[];
  satellites: Sat[];
  satCount: number;
};

export default function OrbitalViewPanel({
  altitudeBands,
  satellites,
  satCount,
}: OrbitalViewPanelProps) {
  return (
    <div
      style={{
        position: "absolute",
        bottom: 16,
        right: 16,
        padding: "14px 16px",
        borderRadius: 12,
        background: "rgba(10,10,14,0.82)",
        border: "1px solid rgba(255,255,255,0.10)",
        color: "white",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        fontSize: 11,
        zIndex: 10,
        minWidth: 210,
      }}
    >
      <div style={{ fontWeight: 700, fontSize: 13, textAlign: "center", marginBottom: 10, letterSpacing: 0.3 }}>
        Orbital Altitude
      </div>
      <div style={{ borderTop: "1px solid rgba(255,255,255,0.10)", margin: "0 -16px 10px", padding: 0 }} />
      {altitudeBands.map((band) => (
        <div key={band.name} style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 8 }}>
          <span
            style={{
              width: 14,
              height: 14,
              borderRadius: 3,
              background: band.color,
              flexShrink: 0,
              marginTop: 1,
            }}
          />
          <div style={{ lineHeight: 1.35 }}>
            <div style={{ fontWeight: 600, fontSize: 11 }}>{band.name}</div>
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.5)" }}>{band.range}</div>
          </div>
        </div>
      ))}
      <div style={{ borderTop: "1px solid rgba(255,255,255,0.10)", margin: "6px -16px 8px", padding: 0 }} />
      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.6)", marginBottom: 4, fontWeight: 600 }}>
        Distribution ({satellites.length}{satCount > 0 && satellites.length < satCount ? `/${satCount}` : ""} satellites)
      </div>
      {(() => {
        const counts: Record<string, number> = {};
        for (const band of altitudeBands) counts[band.name] = 0;
        for (const s of satellites) {
          for (const band of altitudeBands) {
            if (s.altitudeKm < band.max) {
              counts[band.name]++;
              break;
            }
          }
        }
        const total = satellites.length || 1;
        return altitudeBands
          .filter((band) => counts[band.name] > 0)
          .map((band) => (
            <div
              key={band.name}
              style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "rgba(255,255,255,0.5)", lineHeight: 1.7 }}
            >
              <span>{band.name.replace(/ \(.*\)/, "")}</span>
              <span style={{ marginLeft: 12, whiteSpace: "nowrap" }}>
                {counts[band.name]} ({((counts[band.name] / total) * 100).toFixed(1)}%)
              </span>
            </div>
          ));
      })()}
    </div>
  );
}
