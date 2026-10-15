import type { CSSProperties, ReactNode } from "react";
import { MUTED, TEXT } from "../analytics/ui";

/** Shared look and number formatting for the Trips panels. */

export const FONT = "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
/** A real mission's path, and a planned trip's (one of each is on screen at a time, each labelled directly). */
export const MISSION_COLOR = "#ffb74d";
export const PLAN_COLOR = "#4dd0e1";

export function panelStyle(width = 320): CSSProperties {
  return {
    padding: "10px 12px",
    borderRadius: 10,
    background: "rgba(0,0,0,0.66)",
    border: "1px solid rgba(255,255,255,0.12)",
    color: "white",
    fontFamily: FONT,
    fontSize: 12,
    lineHeight: 1.4,
    width,
    maxWidth: "100%",
    boxSizing: "border-box",
    pointerEvents: "auto",
    overflowY: "auto",
    minHeight: 0,
    scrollbarWidth: "thin",
    scrollbarColor: "rgba(255,255,255,0.22) transparent",
  };
}

export const subheadStyle: CSSProperties = { color: MUTED, fontSize: 10, textTransform: "uppercase", letterSpacing: 0.6, margin: "12px 0 6px" };

/** A label / value row; values in the primary text colour, right-aligned. */
export function Row({ label, value, hint }: { label: ReactNode; value: ReactNode; hint?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "2px 0" }} title={hint}>
      <span style={{ color: MUTED }}>{label}</span>
      <span style={{ color: TEXT, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{value}</span>
    </div>
  );
}

/** A thin horizontal bar: how much of something is used (e.g. a stage's propellant). */
export function Meter({ fraction, color, label }: { fraction: number; color: string; label: string }) {
  const f = Math.max(0, Math.min(1, fraction));
  return (
    <div role="meter" aria-label={label} aria-valuenow={Math.round(f * 100)} aria-valuemin={0} aria-valuemax={100} style={{ height: 6, borderRadius: 3, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
      <div style={{ width: `${f * 100}%`, height: "100%", background: color, borderRadius: 3 }} />
    </div>
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "14 Jul 2015" (UTC). */
export function formatDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** "14 Jul 2015 11:49 UTC". */
export function formatDateTime(ms: number): string {
  const d = new Date(ms);
  return `${formatDate(ms)} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")} UTC`;
}

/** "Jul 2015" */
export function formatMonth(ms: number): string {
  const d = new Date(ms);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Days as "203 days (6.7 months)" / "9.5 years". */
export function formatDays(days: number): string {
  if (days < 60) return `${Math.round(days)} days`;
  if (days < 3 * 365) return `${Math.round(days)} days (${(days / 30.44).toFixed(1)} months)`;
  return `${(days / 365.25).toFixed(1)} years`;
}

/** Seconds as "T+8:42" style clock: "8:42", "1:02:05". */
export function formatClock(s: number): string {
  const sign = s < 0 ? "−" : "+";
  const a = Math.abs(Math.round(s));
  const h = Math.floor(a / 3600);
  const m = Math.floor((a % 3600) / 60);
  const sec = a % 60;
  const mm = String(m).padStart(h ? 2 : 1, "0");
  return `T${sign}${h ? `${h}:` : ""}${mm}:${String(sec).padStart(2, "0")}`;
}

export const kms = (v: number, digits = 2) => `${v.toFixed(digits)} km/s`;

export function kg(v: number): string {
  if (v >= 10_000) return `${(v / 1000).toFixed(1)} t`;
  return `${Math.round(v).toLocaleString("en-US")} kg`;
}

export function distanceText(km: number): string {
  const au = km / 149_597_870.7;
  if (au >= 0.1) return `${au.toFixed(au >= 10 ? 1 : 2)} AU`;
  if (km >= 1e6) return `${(km / 1e6).toFixed(2)} million km`;
  return `${Math.round(km).toLocaleString("en-US")} km`;
}

/** One-way light time, "4 min 12 s" / "22 h 41 min". */
export function lightTime(km: number): string {
  const s = km / 299_792.458;
  if (s < 60) return `${s.toFixed(1)} s`;
  if (s < 3600) {
    const whole = Math.round(s);
    return `${Math.floor(whole / 60)} min ${whole % 60} s`;
  }
  const minutes = Math.round(s / 60);
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}
