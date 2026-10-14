import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { IconType } from "react-icons";
import type { LayoutMode } from "../../lib/useLayoutMode";

/**
 * Places every floating panel for the current layout:
 *  - desktop / tablet: panels float in their zone with a collapse button; collapsed panels become
 *    labelled tabs on the side walls (click to reopen).
 *  - phone: a bottom tab bar; the chosen panel opens in a bottom sheet above it.
 */

/** Where a panel floats on desktop / tablet. "sidebar" is a full-height column on the right edge. */
export type DockZone = "left-top" | "left-bottom" | "right" | "sidebar";

export type DockPanel = {
  id: string;
  /** Tab label (desktop side tab and phone tab bar). */
  label: string;
  icon: IconType;
  zone: DockZone;
  content: ReactNode;
  /** Nothing to show right now (e.g. no satellites selected): no panel or side tab on desktop. */
  empty?: boolean;
  /** Shown in the phone sheet when empty. */
  emptyText?: string;
  /** Small count on the tab (e.g. selected satellites). */
  badge?: number;
  /** Right zone: stays at the bottom of the column. */
  pinBottom?: boolean;
  /** Width of a sidebar panel, so the right zone can sit beside it. */
  sidebarWidth?: number;
};

type PanelDockProps = {
  mode: LayoutMode;
  panels: DockPanel[];
  collapsed: Set<string>;
  onToggleCollapsed: (id: string) => void;
  /** Phone: the panel open in the bottom sheet, or null. */
  sheet: string | null;
  onSheetChange: (id: string | null) => void;
  /** Phone: height taken by the tab bar + open sheet, so the globe can stay centred above it. */
  onBottomInsetChange: (px: number) => void;
  /** Desktop / tablet: keep the top of the panels clear of a compact (centred) navbar. */
  topInset?: number;
};

const FONT = "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
const EDGE = 12;
const TAB_GUTTER = 34; // space reserved next to a wall that has side tabs
const TAB_BAR_HEIGHT = 58;

export default function PanelDock(props: PanelDockProps) {
  return props.mode === "phone" ? <PhoneDock {...props} /> : <FloatingDock {...props} />;
}

// ── Desktop / tablet ────────────────────────────────────────────────────────────────

function FloatingDock({ panels, collapsed, onToggleCollapsed, topInset = 0 }: PanelDockProps) {
  const visible = panels.filter((p) => !p.empty);
  const isOpen = (p: DockPanel) => !collapsed.has(p.id);
  const leftTabs = visible.filter((p) => !isOpen(p) && (p.zone === "left-top" || p.zone === "left-bottom"));
  const rightTabs = visible.filter((p) => !isOpen(p) && (p.zone === "right" || p.zone === "sidebar"));
  const open = (zone: DockZone) => visible.filter((p) => p.zone === zone && isOpen(p));

  const left = EDGE + (leftTabs.length ? TAB_GUTTER : 0);
  const sidebar = open("sidebar")[0];
  const rightEdge = EDGE + (rightTabs.length ? TAB_GUTTER : 0);
  const right = rightEdge + (sidebar ? (sidebar.sidebarWidth ?? 0) : 0);

  const column = (style: CSSProperties, items: DockPanel[], align: "flex-start" | "flex-end") =>
    items.length > 0 && (
      <div
        style={{
          position: "absolute",
          display: "flex",
          flexDirection: "column",
          alignItems: align,
          gap: 10,
          pointerEvents: "none",
          zIndex: 10,
          ...style,
        }}
      >
        {items.map((p) => (
          <CollapsibleFrame key={p.id} panel={p} onCollapse={() => onToggleCollapsed(p.id)} />
        ))}
      </div>
    );

  return (
    <>
      {column({ top: EDGE + topInset, left }, open("left-top"), "flex-start")}
      {column({ bottom: EDGE + 4, left }, open("left-bottom"), "flex-start")}
      {column({ top: EDGE + topInset, bottom: EDGE + 4, right }, open("right"), "flex-end")}
      {sidebar && (
        <div style={{ position: "absolute", top: 0, bottom: 0, right: rightEdge - EDGE, width: sidebar.sidebarWidth, zIndex: 9 }}>
          <CollapsibleFrame panel={sidebar} onCollapse={() => onToggleCollapsed(sidebar.id)} fill />
        </div>
      )}
      <WallTabs side="left" panels={leftTabs} onOpen={onToggleCollapsed} />
      <WallTabs side="right" panels={rightTabs} onOpen={onToggleCollapsed} />
    </>
  );
}

/** A floating panel plus its small collapse button on the top corner. */
function CollapsibleFrame({ panel, onCollapse, fill = false }: { panel: DockPanel; onCollapse: () => void; fill?: boolean }) {
  const pinned = panel.pinBottom ? { marginTop: "auto", flexShrink: 0 } : { flex: "0 1 auto", minHeight: 0 };
  return (
    <div
      style={{
        position: "relative",
        pointerEvents: "auto",
        display: "flex",
        flexDirection: "column",
        maxWidth: "100%",
        ...(fill ? { height: "100%" } : pinned),
      }}
    >
      {panel.content}
      <button
        type="button"
        onClick={onCollapse}
        title={`Collapse ${panel.label}`}
        aria-label={`Collapse ${panel.label}`}
        style={{
          position: "absolute",
          top: -7,
          right: -7,
          width: 20,
          height: 20,
          borderRadius: "50%",
          border: "1px solid rgba(255,255,255,0.25)",
          background: "rgba(20,22,30,0.95)",
          color: "rgba(255,255,255,0.8)",
          fontSize: 13,
          lineHeight: "16px",
          padding: 0,
          cursor: "pointer",
          zIndex: 2,
        }}
      >
        –
      </button>
    </div>
  );
}

/** Collapsed panels as labelled tabs against the left or right wall, vertically centred. */
function WallTabs({ side, panels, onOpen }: { side: "left" | "right"; panels: DockPanel[]; onOpen: (id: string) => void }) {
  if (panels.length === 0) return null;
  return (
    <div
      style={{
        position: "absolute",
        top: "50%",
        transform: "translateY(-50%)",
        [side]: 0,
        display: "flex",
        flexDirection: "column",
        gap: 6,
        zIndex: 12,
      }}
    >
      {panels.map((p) => (
        <button
          key={p.id}
          type="button"
          onClick={() => onOpen(p.id)}
          title={`Open ${p.label}`}
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 6,
            padding: "10px 6px",
            width: 30,
            border: "1px solid rgba(255,255,255,0.14)",
            [side === "left" ? "borderLeft" : "borderRight"]: "none",
            borderRadius: side === "left" ? "0 8px 8px 0" : "8px 0 0 8px",
            background: "rgba(10,10,14,0.85)",
            color: "rgba(255,255,255,0.85)",
            fontFamily: FONT,
            fontSize: 11,
            cursor: "pointer",
          }}
        >
          <p.icon size={14} />
          <span style={{ writingMode: "vertical-rl", transform: side === "left" ? "rotate(180deg)" : undefined, letterSpacing: 0.5 }}>
            {p.label}
          </span>
          {!!p.badge && <Badge count={p.badge} />}
        </button>
      ))}
    </div>
  );
}

// ── Phone ───────────────────────────────────────────────────────────────────────────

function PhoneDock({ panels, sheet, onSheetChange, onBottomInsetChange }: PanelDockProps) {
  const active = panels.find((p) => p.id === sheet) ?? null;
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef<number | null>(null);

  // Report how much of the screen the tab bar + sheet cover, so the globe re-centres above them.
  useEffect(() => {
    const el = sheetRef.current;
    const report = () => onBottomInsetChange(TAB_BAR_HEIGHT + (el && active ? el.getBoundingClientRect().height : 0));
    report();
    if (!el) return;
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, [active, onBottomInsetChange]);
  useEffect(() => () => onBottomInsetChange(0), [onBottomInsetChange]);

  return (
    <>
      {active && (
        <div
          ref={sheetRef}
          role="dialog"
          aria-label={active.label}
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: `calc(${TAB_BAR_HEIGHT}px + env(safe-area-inset-bottom))`,
            maxHeight: "55vh",
            display: "flex",
            flexDirection: "column",
            background: "rgba(10,10,14,0.94)",
            borderTop: "1px solid rgba(255,255,255,0.14)",
            borderRadius: "14px 14px 0 0",
            boxShadow: "0 -10px 30px rgba(0,0,0,0.4)",
            zIndex: 30,
            transform: `translateY(${Math.max(0, dragY)}px)`,
            transition: dragging ? undefined : "transform 0.15s ease-out",
          }}
        >
          {/* Drag the handle down to close */}
          <div
            onPointerDown={(e) => {
              dragStart.current = e.clientY;
              setDragging(true);
              (e.target as HTMLElement).setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => dragStart.current !== null && setDragY(e.clientY - dragStart.current)}
            onPointerUp={() => {
              if (dragY > 70) onSheetChange(null);
              dragStart.current = null;
              setDragging(false);
              setDragY(0);
            }}
            style={{ padding: "8px 0 4px", touchAction: "none", cursor: "grab", flexShrink: 0 }}
          >
            <div style={{ width: 40, height: 4, borderRadius: 2, background: "rgba(255,255,255,0.3)", margin: "0 auto" }} />
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 14px 0", fontFamily: FONT, color: "white" }}>
              <span style={{ fontWeight: 700, fontSize: 13 }}>{active.label}</span>
              <button
                type="button"
                onClick={() => onSheetChange(null)}
                aria-label="Close"
                style={{ background: "none", border: "none", color: "rgba(255,255,255,0.6)", fontSize: 18, padding: "0 4px", cursor: "pointer" }}
              >
                ×
              </button>
            </div>
          </div>
          <div className="lune-sheet-content" style={{ overflowY: "auto", padding: "6px 10px 12px", display: "flex", flexDirection: "column", gap: 10 }}>
            {active.empty ? (
              <div style={{ color: "rgba(255,255,255,0.6)", fontFamily: FONT, fontSize: 12, padding: "12px 4px" }}>{active.emptyText}</div>
            ) : (
              active.content
            )}
          </div>
        </div>
      )}

      <nav
        aria-label="Panels"
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: `calc(${TAB_BAR_HEIGHT}px + env(safe-area-inset-bottom))`,
          paddingBottom: "env(safe-area-inset-bottom)",
          display: "flex",
          background: "rgba(10,10,14,0.96)",
          borderTop: "1px solid rgba(255,255,255,0.12)",
          zIndex: 31,
          boxSizing: "border-box",
        }}
      >
        {panels.map((p) => {
          const selected = p.id === sheet;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => onSheetChange(selected ? null : p.id)}
              aria-pressed={selected}
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 3,
                position: "relative",
                background: "none",
                border: "none",
                borderTop: `2px solid ${selected ? "#4fc3f7" : "transparent"}`,
                color: selected ? "#4fc3f7" : "rgba(255,255,255,0.7)",
                fontFamily: FONT,
                fontSize: 10,
                cursor: "pointer",
                padding: 0,
              }}
            >
              <p.icon size={18} />
              {p.label}
              {!!p.badge && (
                <span style={{ position: "absolute", top: 6, left: "calc(50% + 6px)" }}>
                  <Badge count={p.badge} />
                </span>
              )}
            </button>
          );
        })}
      </nav>
    </>
  );
}

function Badge({ count }: { count: number }) {
  return (
    <span
      style={{
        minWidth: 16,
        height: 16,
        padding: "0 4px",
        borderRadius: 8,
        background: "#4fc3f7",
        color: "#000",
        fontSize: 10,
        fontWeight: 700,
        lineHeight: "16px",
        textAlign: "center",
        boxSizing: "border-box",
        display: "inline-block",
      }}
    >
      {count}
    </span>
  );
}
