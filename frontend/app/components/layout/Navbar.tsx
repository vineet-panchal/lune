export default function Navbar() {
  return (
    <div
      style={{
        position: "absolute",
        top: 12,
        left: "50%",
        transform: "translateX(-50%)",
        padding: "8px 20px",
        borderRadius: 10,
        background: "rgba(0,0,0,0.55)",
        border: "1px solid rgba(255,255,255,0.12)",
        color: "white",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        fontSize: 13,
        display: "flex",
        alignItems: "center",
        gap: 24,
        zIndex: 10,
        whiteSpace: "nowrap",
      }}
    >
      <span style={{ fontWeight: 700, fontSize: 15, letterSpacing: 2 }}>LUNE</span>
      <div
        style={{
          width: 1,
          height: 18,
          background: "rgba(255,255,255,0.2)",
        }}
      />
      <div style={{ display: "flex", gap: 6 }}>
        <button
          style={{
            background: "rgba(255,255,255,0.12)",
            border: "1px solid rgba(255,255,255,0.25)",
            color: "#fff",
            padding: "4px 12px",
            borderRadius: 6,
            fontSize: 12,
            cursor: "default",
            fontFamily: "inherit",
          }}
        >
          Satellite Tracker
        </button>
        {["Constellations", "News", "Trips"].map((label) => (
          <button
            key={label}
            disabled
            style={{
              background: "transparent",
              border: "1px solid rgba(255,255,255,0.08)",
              color: "rgba(255,255,255,0.3)",
              padding: "4px 12px",
              borderRadius: 6,
              fontSize: 12,
              cursor: "not-allowed",
              fontFamily: "inherit",
            }}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
