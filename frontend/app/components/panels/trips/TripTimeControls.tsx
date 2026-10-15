import { useEffect, useState } from "react";
import type { SimClock } from "../../../lib/simClock";
import { chipStyle, MUTED } from "../analytics/ui";
import { formatDateTime, FONT } from "./ui";

/** Re-renders a few times a second with the clock's time (null until mounted, so server and client agree). */
export function useClockTime(clock: SimClock, everyMs = 250): number | null {
  const [ms, setMs] = useState<number | null>(null);
  useEffect(() => {
    const update = () => setMs(clock.nowMs());
    update();
    const unsubscribe = clock.subscribe(update);
    const timer = window.setInterval(update, everyMs);
    return () => {
      unsubscribe();
      window.clearInterval(timer);
    };
  }, [clock, everyMs]);
  return ms;
}

const DAY = 86_400;
/** Real time up to 100 days a second: launches need seconds, cruises need months. */
export const SPEEDS: { rate: number; label: string }[] = [
  { rate: 1, label: "1×" },
  { rate: 10, label: "10×" },
  { rate: 60, label: "1 min/s" },
  { rate: 3600, label: "1 h/s" },
  { rate: DAY, label: "1 d/s" },
  { rate: 10 * DAY, label: "10 d/s" },
  { rate: 100 * DAY, label: "100 d/s" },
];

export type TimeMark = { ms: number; label: string };
export type SceneView = "solar" | "earth" | "planet";

type Props = {
  clock: SimClock;
  /** What the slider spans: the mission's data or the trip from launch to arrival. */
  range: { startMs: number; endMs: number } | null;
  marks: TimeMark[];
  view: SceneView;
  onViewChange: (view: SceneView) => void;
  /** The Earth view only exists for a planned launch from Earth. */
  earthViewAvailable: boolean;
  /** The planet whose moon a planned trip goes to, for the view around it; null when there's no moon leg. */
  moonLegPlanet: string | null;
};

/** Time for Trips: play/pause, speeds from real time to 100 days a second, a slider over the trip, and the view. */
export default function TripTimeControls({ clock, range, marks, view, onViewChange, earthViewAvailable, moonLegPlanet }: Props) {
  const ms = useClockTime(clock);
  const paused = clock.paused;
  const rate = clock.rate;
  const slider = range && ms !== null ? Math.max(0, Math.min(1, (ms - range.startMs) / (range.endMs - range.startMs))) : 0;

  return (
    <div
      style={{
        pointerEvents: "auto",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: "10px 14px",
        borderRadius: 12,
        background: "rgba(10,10,14,0.82)",
        border: "1px solid rgba(255,255,255,0.10)",
        color: "white",
        fontFamily: FONT,
        fontSize: 11,
        width: 420,
        maxWidth: "100%",
        boxSizing: "border-box",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <button
          type="button"
          onClick={() => clock.setPaused(!paused)}
          aria-label={paused ? "Play" : "Pause"}
          style={{ width: 30, height: 26, borderRadius: 6, border: "1px solid rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.08)", color: "white", cursor: "pointer", fontSize: 12 }}
        >
          {paused ? "▶" : "❚❚"}
        </button>
        <div style={{ flex: 1, lineHeight: 1.3 }}>
          <div style={{ fontSize: 12 }}>{ms === null ? "—" : formatDateTime(ms)}</div>
          <div style={{ fontSize: 10, color: clock.isLive() ? "#66bb6a" : MUTED }}>{clock.isLive() ? "● LIVE" : paused ? "Paused" : `${SPEEDS.find((s) => s.rate === rate)?.label ?? `${rate}×`}`}</div>
        </div>
        <button type="button" onClick={() => clock.goLive()} style={{ ...chipStyle(false), padding: "4px 8px", fontSize: 10 }}>
          Now
        </button>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
        {SPEEDS.map((s) => (
          <button key={s.rate} type="button" aria-pressed={rate === s.rate} onClick={() => clock.setRate(s.rate)} style={{ ...chipStyle(rate === s.rate), padding: "3px 7px", fontSize: 10 }}>
            {s.label}
          </button>
        ))}
      </div>

      {range && (
        <div>
          <input
            type="range"
            min={0}
            max={1000}
            value={Math.round(slider * 1000)}
            onChange={(e) => clock.setTime(range.startMs + (Number(e.target.value) / 1000) * (range.endMs - range.startMs))}
            aria-label="Time along the trip"
            style={{ width: "100%", accentColor: "#7ba4e8" }}
          />
          {marks.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 2 }}>
              {marks.map((m) => (
                <button key={`${m.label}-${m.ms}`} type="button" onClick={() => clock.setTime(m.ms)} style={{ ...chipStyle(false), padding: "2px 7px", fontSize: 9 }}>
                  {m.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
        <span style={{ color: MUTED, fontSize: 10 }}>View</span>
        <button type="button" aria-pressed={view === "solar"} onClick={() => onViewChange("solar")} style={{ ...chipStyle(view === "solar"), padding: "3px 8px", fontSize: 10 }}>
          Solar system
        </button>
        <button
          type="button"
          aria-pressed={view === "earth"}
          disabled={!earthViewAvailable}
          title={earthViewAvailable ? undefined : "Plan a trip from Earth to see its launch"}
          onClick={() => onViewChange("earth")}
          style={{ ...chipStyle(view === "earth", !earthViewAvailable), padding: "3px 8px", fontSize: 10, opacity: earthViewAvailable ? 1 : 0.5 }}
        >
          Launch (Earth)
        </button>
        <button
          type="button"
          aria-pressed={view === "planet"}
          disabled={!moonLegPlanet}
          title={moonLegPlanet ? `Around ${moonLegPlanet}: the leg out to the moon` : "Plan a trip to a moon to see its last leg"}
          onClick={() => onViewChange("planet")}
          style={{ ...chipStyle(view === "planet", !moonLegPlanet), padding: "3px 8px", fontSize: 10, opacity: moonLegPlanet ? 1 : 0.5 }}
        >
          {moonLegPlanet ? `${moonLegPlanet} & moons` : "Moon leg"}
        </button>
      </div>
    </div>
  );
}
