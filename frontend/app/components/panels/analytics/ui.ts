import type { CSSProperties } from "react";

/** Shared look of the Orbital Intelligence panel's pieces. */

export const TEXT = "rgba(220,228,240,0.9)";
export const MUTED = "rgba(170,182,200,0.65)";
export const ACCENT = "#7ba4e8";
export const LINK = "#8fb4f0";

export const sectionStyle: CSSProperties = {
  padding: 14,
  borderRadius: 10,
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.08)",
  marginBottom: 14,
};

export const sectionTitleStyle: CSSProperties = { fontWeight: 600, marginBottom: 10, color: "#c5d5f1" };

export const hintStyle: CSSProperties = { margin: 0, fontSize: 11, color: "rgba(190,200,220,0.7)", lineHeight: 1.45 };

/** A selectable pill (feature set, model, filter). */
export function chipStyle(active: boolean, disabled = false): CSSProperties {
  return {
    padding: "6px 10px",
    borderRadius: 8,
    border: active ? "1px solid rgba(123, 164, 232, 0.75)" : "1px solid rgba(255,255,255,0.12)",
    background: active ? "rgba(86, 132, 214, 0.35)" : "rgba(255,255,255,0.05)",
    color: active ? "#e8f0ff" : "rgba(200,210,230,0.75)",
    cursor: disabled ? "not-allowed" : "pointer",
    fontFamily: "inherit",
    fontSize: 11,
    fontWeight: 600,
  };
}

/** A secondary button (Export CSV, Suggest, Scan). */
export function buttonStyle(enabled = true): CSSProperties {
  return {
    padding: "6px 12px",
    borderRadius: 8,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.06)",
    color: enabled ? "rgba(230,236,246,0.85)" : "rgba(255,255,255,0.35)",
    cursor: enabled ? "pointer" : "not-allowed",
    fontFamily: "inherit",
    fontSize: 11,
  };
}

export const linkStyle: CSSProperties = {
  color: LINK,
  cursor: "pointer",
  background: "none",
  border: "none",
  padding: 0,
  font: "inherit",
  fontSize: 10,
  whiteSpace: "nowrap",
  textDecoration: "none",
};

export const selectStyle: CSSProperties = {
  fontSize: 11,
  padding: "2px 4px",
  borderRadius: 6,
  background: "#1a1d26",
  color: "#e8ecf4",
  border: "1px solid rgba(255,255,255,0.18)",
  fontFamily: "inherit",
};

export const errorStyle: CSSProperties = {
  padding: "8px 10px",
  borderRadius: 8,
  background: "rgba(160, 48, 48, 0.2)",
  border: "1px solid rgba(255,120,120,0.35)",
  color: "#ffd6d6",
  fontSize: 10,
  lineHeight: 1.45,
};
