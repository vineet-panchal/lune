import { useEffect, useState, type ReactNode } from "react";
import type * as satellite from "satellite.js";
import { getLiveState, getOrbitInfo } from "../../lib/orbitInfo";
import type { Observer } from "../../lib/passes";
import PassPredictions from "./PassPredictions";

export type SelectedSat = {
  satelliteId: number;
  name: string;
  color: string;
  satrec: satellite.SatRec;
  line1?: string;
};

type SelectedSatellitesPanelProps = {
  /** Push panel left when a full-height right sidebar is present (e.g. Orbital Intelligence). */
  rightInsetPx?: number;
  /** Placed inside a right-hand column by the parent (Satellite Tracker): fill the space it's given and scroll. */
  docked?: boolean;
  selectedSats: SelectedSat[];
  maxSelected: number;
  followId: number | null;
  onToggleFollow: (id: number) => void;
  onRemoveSat: (id: number) => void;
  onClearAll: () => void;
  /** Copies a link that reopens this view (filter, selection, follow, colour mode). Hidden when absent. */
  onCopyLink?: () => Promise<void>;
  /** The globe's current (possibly simulated) time. */
  getNow: () => Date;
  observer: Observer | null;
  onObserverChange: (observer: Observer | null) => void;
  /** Jump the time controls to a pass and follow the satellite. */
  onShowPass: (satelliteId: number, riseMs: number) => void;
};

const LIVE_REFRESH_MS = 1000;

export default function SelectedSatellitesPanel({
  rightInsetPx = 0,
  docked = false,
  selectedSats,
  maxSelected,
  followId,
  onToggleFollow,
  onRemoveSat,
  onClearAll,
  onCopyLink,
  getNow,
  observer,
  onObserverChange,
  onShowPass,
}: SelectedSatellitesPanelProps) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const [now, setNow] = useState(getNow);

  // Live values (altitude, speed, position) only need refreshing while a row is open.
  const anyExpanded = selectedSats.some((s) => expanded.has(s.satelliteId));
  useEffect(() => {
    if (!anyExpanded) return;
    const timer = window.setInterval(() => setNow(getNow()), LIVE_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [anyExpanded, getNow]);

  if (selectedSats.length === 0) return null;

  const copyLink = () => {
    if (!onCopyLink) return;
    onCopyLink()
      .then(() => setCopyState("copied"))
      .catch(() => setCopyState("failed"))
      .finally(() => window.setTimeout(() => setCopyState("idle"), 1500));
  };

  const toggleExpanded = (id: number) => {
    setNow(getNow());
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div
      style={{
        ...(docked
          ? { flex: "0 1 auto", minHeight: 0, pointerEvents: "auto" as const }
          : {
              position: "absolute" as const,
              zIndex: 10, // like the other floating panels; otherwise the globe canvas covers it
              top: 68, // below the navbar
              right: 12 + Math.max(0, rightInsetPx),
              maxHeight: "40vh",
            }),
        padding: "10px 14px",
        borderRadius: 10,
        background: "rgba(0,0,0,0.65)",
        border: "1px solid rgba(255,255,255,0.12)",
        color: "white",
        fontFamily:
          "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        fontSize: 12,
        lineHeight: 1.6,
        minWidth: 240,
        maxWidth: 320,
        overflowY: "auto",
      }}
    >
      {selectedSats.map((s) => {
        const isOpen = expanded.has(s.satelliteId);
        const isFollowed = followId === s.satelliteId;
        return (
          <div key={s.satelliteId} style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
            <div style={{ display: "flex", alignItems: "center", padding: "4px 0", gap: 6 }}>
              <button
                type="button"
                onClick={() => toggleExpanded(s.satelliteId)}
                aria-expanded={isOpen}
                title={isOpen ? "Hide details" : "Show details"}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  flex: 1,
                  minWidth: 0,
                  background: "none",
                  border: "none",
                  padding: 0,
                  color: "inherit",
                  font: "inherit",
                  textAlign: "left",
                  cursor: "pointer",
                }}
              >
                <span style={{ width: 10, color: "rgba(255,255,255,0.5)", flexShrink: 0 }}>{isOpen ? "▾" : "▸"}</span>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: s.color, flexShrink: 0 }} />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</span>
                <span style={{ color: "rgba(255,255,255,0.4)", flexShrink: 0 }}>#{s.satelliteId}</span>
              </button>
              <button
                type="button"
                onClick={() => onToggleFollow(s.satelliteId)}
                aria-pressed={isFollowed}
                title={isFollowed ? "Stop following" : "Keep the camera on this satellite"}
                style={{
                  flexShrink: 0,
                  padding: "0 7px",
                  borderRadius: 999,
                  border: `1px solid ${isFollowed ? "#4fc3f7" : "rgba(255,255,255,0.25)"}`,
                  background: isFollowed ? "rgba(79,195,247,0.2)" : "transparent",
                  color: isFollowed ? "#4fc3f7" : "rgba(255,255,255,0.65)",
                  font: "inherit",
                  fontSize: 11,
                  cursor: "pointer",
                }}
              >
                {isFollowed ? "Following" : "Follow"}
              </button>
              <button
                type="button"
                onClick={() => onRemoveSat(s.satelliteId)}
                style={{
                  background: "none",
                  border: "none",
                  color: "rgba(255,255,255,0.5)",
                  cursor: "pointer",
                  fontSize: 14,
                  padding: "0 4px",
                  flexShrink: 0,
                }}
                title="Remove"
              >
                ×
              </button>
            </div>
            {isOpen && (
              <SatelliteDetails sat={s} now={now}>
                <PassPredictions
                  satrec={s.satrec}
                  fromMs={now.getTime()}
                  observer={observer}
                  onObserverChange={onObserverChange}
                  onShowPass={(riseMs) => onShowPass(s.satelliteId, riseMs)}
                />
              </SatelliteDetails>
            )}
          </div>
        );
      })}
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
        <span style={{ display: "flex", gap: 12 }}>
          {onCopyLink && <span
            style={{
              color: copyState === "copied" ? "#4fc3f7" : copyState === "failed" ? "#ff8a80" : "rgba(255,255,255,0.4)",
              cursor: "pointer",
            }}
            onClick={copyLink}
            title="Copy a link to this view: filter, selected satellites, follow and colours"
          >
            {copyState === "copied" ? "copied!" : copyState === "failed" ? "copy failed" : "copy link"}
          </span>}
          <span
            style={{
              color: "rgba(255,255,255,0.4)",
              cursor: "pointer",
            }}
            onClick={onClearAll}
          >
            clear all
          </span>
        </span>
      </div>
    </div>
  );
}

function SatelliteDetails({ sat, now, children }: { sat: SelectedSat; now: Date; children?: ReactNode }) {
  const info = getOrbitInfo(sat.satrec, sat.line1);
  const live = getLiveState(sat.satrec, now);

  const rows: [string, string][] = [
    ["Altitude", live ? `${Math.round(live.altitudeKm).toLocaleString()} km` : "—"],
    ["Speed", live ? `${live.speedKmS.toFixed(2)} km/s (${Math.round(live.speedKmS * 3600).toLocaleString()} km/h)` : "—"],
    ["Position", live ? formatLatLng(live.lat, live.lng) : "—"],
    ["Orbit", info.orbitClass],
    ["Inclination", `${info.inclinationDeg.toFixed(1)}°`],
    ["Period", `${formatPeriod(info.periodMin)} · ${info.revsPerDay.toFixed(2)} orbits/day`],
    ["Alt. range", `${Math.round(info.perigeeKm).toLocaleString()} – ${Math.round(info.apogeeKm).toLocaleString()} km`],
    ["Launched", info.launchDesignator ?? "—"],
    ["TLE age", formatAge(now.getTime() - info.tleEpoch.getTime())],
  ];

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "auto 1fr",
        columnGap: 10,
        padding: "2px 0 8px 16px",
        fontSize: 11,
        lineHeight: 1.7,
      }}
    >
      {rows.map(([label, value]) => (
        <div key={label} style={{ display: "contents" }}>
          <span style={{ color: "rgba(255,255,255,0.45)" }}>{label}</span>
          <span style={{ color: "rgba(255,255,255,0.9)" }}>{value}</span>
        </div>
      ))}
      {children}
    </div>
  );
}

function formatLatLng(lat: number, lng: number): string {
  return `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? "N" : "S"}, ${Math.abs(lng).toFixed(2)}°${lng >= 0 ? "E" : "W"}`;
}

function formatPeriod(minutes: number): string {
  return minutes < 120 ? `${minutes.toFixed(1)} min` : `${(minutes / 60).toFixed(1)} h`;
}

function formatAge(ms: number): string {
  const hours = ms / 3_600_000;
  if (hours < 1) return `${Math.max(0, Math.round(ms / 60_000))} min`;
  if (hours < 48) return `${Math.round(hours)} h`;
  return `${Math.round(hours / 24)} days`;
}
