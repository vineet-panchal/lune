import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";

export type NavbarPage = "satellite-tracker" | "orbital-intelligence" | "constellations" | "mission-control";

type NavbarProps = {
  current: NavbarPage;
  /** Narrow screens: a "☰ LUNE" button that opens the page list instead of the full bar. */
  compact?: boolean;
  /** Phone: full-width top bar with this on the right (e.g. satellite count and LIVE). */
  status?: ReactNode;
};

const FONT = "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
const PAGES: { label: string; href?: string; page?: NavbarPage }[] = [
  { label: "Satellite Tracker", href: "/", page: "satellite-tracker" },
  { label: "Orbital Intelligence", href: "/orbital-intelligence", page: "orbital-intelligence" },
  { label: "Constellations", href: "/constellations", page: "constellations" },
  { label: "Mission Control", href: "/mission-control", page: "mission-control" },
  { label: "Trips" },
];

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

const disabledStyle: CSSProperties = {
  background: "transparent",
  border: "1px solid rgba(255,255,255,0.08)",
  color: "rgba(255,255,255,0.3)",
  padding: "4px 12px",
  borderRadius: 6,
  fontSize: 12,
  cursor: "not-allowed",
  fontFamily: "inherit",
};

export default function Navbar({ current, compact = false, status }: NavbarProps) {
  if (compact) return <CompactNavbar current={current} status={status} />;
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
        fontFamily: FONT,
        fontSize: 13,
        display: "flex",
        alignItems: "center",
        gap: 24,
        zIndex: 10,
        whiteSpace: "nowrap",
      }}
    >
      <span style={{ fontWeight: 700, fontSize: 15, letterSpacing: 2 }}>LUNE</span>
      <div style={{ width: 1, height: 18, background: "rgba(255,255,255,0.2)" }} />
      <div style={{ display: "flex", gap: 6 }}>
        {PAGES.map((p) =>
          p.href ? (
            <Link key={p.label} href={p.href} prefetch style={navButtonStyle(current === p.page)}>
              {p.label}
            </Link>
          ) : (
            <button key={p.label} type="button" disabled style={disabledStyle}>
              {p.label}
            </button>
          )
        )}
      </div>
    </div>
  );
}

/**
 * Hamburger navbar. With a status (phones) it's a full-width top bar; otherwise a small pill
 * centred at the top (narrow tablets / laptops).
 */
function CompactNavbar({ current, status }: { current: NavbarPage; status?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Close the menu when tapping anywhere else.
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open]);

  const bar = !!status;
  return (
    <div
      ref={rootRef}
      style={{
        position: "absolute",
        zIndex: 32,
        fontFamily: FONT,
        color: "white",
        ...(bar
          ? { top: 0, left: 0, right: 0, paddingTop: "env(safe-area-inset-top)", background: "rgba(10,10,14,0.85)", borderBottom: "1px solid rgba(255,255,255,0.10)" }
          : { top: 12, left: "50%", transform: "translateX(-50%)" }),
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: bar ? "8px 12px" : 0 }}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label="Menu"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "7px 14px",
            borderRadius: 10,
            background: bar ? "transparent" : "rgba(0,0,0,0.55)",
            border: bar ? "none" : "1px solid rgba(255,255,255,0.12)",
            color: "white",
            fontFamily: FONT,
            cursor: "pointer",
          }}
        >
          <span style={{ fontSize: 17, lineHeight: 1 }}>☰</span>
          <span style={{ fontWeight: 700, fontSize: 15, letterSpacing: 2 }}>LUNE</span>
        </button>
        {bar && <div style={{ marginLeft: "auto", fontSize: 11, color: "rgba(255,255,255,0.75)", whiteSpace: "nowrap" }}>{status}</div>}
      </div>

      {open && (
        <div
          role="menu"
          style={{
            position: "absolute",
            top: "100%",
            left: bar ? 12 : "50%",
            transform: bar ? undefined : "translateX(-50%)",
            marginTop: 6,
            minWidth: 220,
            padding: 6,
            borderRadius: 10,
            background: "rgba(10,10,14,0.97)",
            border: "1px solid rgba(255,255,255,0.14)",
            boxShadow: "0 10px 30px rgba(0,0,0,0.45)",
            display: "flex",
            flexDirection: "column",
            gap: 2,
          }}
        >
          {PAGES.map((p) => {
            const active = current === p.page;
            const itemStyle: CSSProperties = {
              display: "block",
              padding: "10px 12px",
              borderRadius: 6,
              fontSize: 13,
              textDecoration: "none",
              textAlign: "left",
              fontFamily: FONT,
              background: active ? "rgba(255,255,255,0.10)" : "transparent",
              border: "none",
              color: p.href ? "white" : "rgba(255,255,255,0.3)",
            };
            return p.href ? (
              <Link key={p.label} href={p.href} prefetch role="menuitem" onClick={() => setOpen(false)} style={itemStyle}>
                {p.label}
              </Link>
            ) : (
              <span key={p.label} role="menuitem" aria-disabled style={itemStyle}>
                {p.label} <span style={{ fontSize: 10 }}>· soon</span>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
