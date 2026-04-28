import type { CSSProperties } from "react";
import Link from "next/link";

export type NavbarPage = "satellite-tracker" | "orbital-intelligence";

type NavbarProps = {
  current: NavbarPage;
};

function navButtonStyle(active: boolean): CSSProperties {
  return {
    background: active ? "rgba(255,255,255,0.12)" : "transparent",
    border: active ? "1px solid rgba(255,255,255,0.25)" : "1px solid rgba(255,255,255,0.08)",
    color: active ? "#fff" : "rgba(255,255,255,0.78)",
    padding: "4px 12px",
    borderRadius: 6,
    fontSize: 12,
    cursor: active ? "default" : "pointer",
    fontFamily: "inherit",
    textDecoration: "none",
    display: "inline-block",
  };
}

export default function Navbar({ current }: NavbarProps) {
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
        <Link href="/" prefetch style={navButtonStyle(current === "satellite-tracker")}>
          Satellite Tracker
        </Link>
        <Link
          href="/orbital-intelligence"
          prefetch
          style={navButtonStyle(current === "orbital-intelligence")}
        >
          Orbital Intelligence
        </Link>
        {["Constellations", "News", "Trips"].map((label) => (
          <button
            key={label}
            type="button"
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
