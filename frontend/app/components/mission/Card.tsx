import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { relativeTime } from "../../lib/missionControl";

/** Shared look of the Mission Control cards. */

export const FONT = "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
export const TEXT = "rgba(228,234,244,0.92)";
export const SECONDARY = "rgba(200,210,226,0.72)";
export const MUTED = "rgba(160,172,192,0.62)";
export const LINK = "#8fb4f0";
export const HAIRLINE = "rgba(255,255,255,0.08)";

/** Status colours (never used as series colours): quiet / active / storm / severe, always shown with a label. */
export const STATUS = { good: "#0ca30c", warning: "#fab219", serious: "#ec835a", critical: "#d03b3b" } as const;

export const linkStyle: CSSProperties = { color: LINK, textDecoration: "none", cursor: "pointer", background: "none", border: "none", padding: 0, font: "inherit" };

export function pillStyle(color: string): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    padding: "2px 7px",
    borderRadius: 999,
    border: `1px solid ${color}55`,
    background: `${color}1f`,
    color: TEXT,
    fontSize: 10,
    whiteSpace: "nowrap",
  };
}

/** A small pill with a coloured dot (the colour is never the only cue: the text says it too). */
export function StatusPill({ color, children, title }: { color: string; children: ReactNode; title?: string }) {
  return (
    <span style={pillStyle(color)} title={title}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: color, flex: "none" }} />
      {children}
    </span>
  );
}

export function chipStyle(active: boolean): CSSProperties {
  return {
    padding: "4px 9px",
    borderRadius: 999,
    border: active ? "1px solid rgba(123,164,232,0.75)" : "1px solid rgba(255,255,255,0.12)",
    background: active ? "rgba(86,132,214,0.32)" : "rgba(255,255,255,0.04)",
    color: active ? "#e8f0ff" : SECONDARY,
    cursor: "pointer",
    fontFamily: FONT,
    fontSize: 11,
  };
}

/** The current time, ticking every `everyMs` (null until mounted, so server and client render alike). */
export function useNow(everyMs = 1000): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const timer = window.setInterval(tick, everyMs);
    return () => window.clearInterval(timer);
  }, [everyMs]);
  return now;
}

type CardProps = {
  title: string;
  /** Short line under the title, e.g. the source. */
  subtitle?: ReactNode;
  /** When the data was downloaded (ISO), for the "updated" note. */
  updatedAt?: string | null;
  loading?: boolean;
  error?: string | null;
  /** Shown on the right of the title row. */
  action?: ReactNode;
  children: ReactNode;
  style?: CSSProperties;
};

export default function Card({ title, subtitle, updatedAt, loading, error, action, children, style }: CardProps) {
  const now = useNow(30_000);
  const status = loading && !updatedAt ? "Loading…" : updatedAt && now ? `updated ${relativeTime(Date.parse(updatedAt), now)}` : null;
  return (
    <section
      style={{
        padding: 16,
        borderRadius: 12,
        background: "rgba(12,15,24,0.82)",
        border: `1px solid ${HAIRLINE}`,
        boxShadow: "0 12px 40px rgba(0,0,0,0.35)",
        color: TEXT,
        fontFamily: FONT,
        fontSize: 12,
        minWidth: 0,
        ...style,
      }}
    >
      <header style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 12 }}>
        <div style={{ minWidth: 0 }}>
          <h2 style={{ margin: 0, fontSize: 11, fontWeight: 700, letterSpacing: 1.6, textTransform: "uppercase", color: "#c5d5f1" }}>{title}</h2>
          {subtitle && <div style={{ marginTop: 3, fontSize: 10, color: MUTED }}>{subtitle}</div>}
        </div>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10, flex: "none" }}>
          {action}
          {status && <span style={{ fontSize: 10, color: MUTED }}>{status}</span>}
        </div>
      </header>
      {error && (
        <div style={{ marginBottom: 10, padding: "6px 9px", borderRadius: 8, background: "rgba(160,48,48,0.18)", border: "1px solid rgba(255,120,120,0.3)", color: "#ffd6d6", fontSize: 10 }}>
          {error}
          {updatedAt ? " · showing the last good copy" : ""}
        </div>
      )}
      {children}
    </section>
  );
}

/** Placeholder rows while a feed loads for the first time. */
export function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} style={{ height: 14, borderRadius: 6, background: "rgba(255,255,255,0.05)", width: `${90 - i * 12}%` }} />
      ))}
    </div>
  );
}
