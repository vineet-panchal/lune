import { useEffect, useState, type CSSProperties } from "react";
import type { SimClock } from "../../lib/simClock";

const SPEEDS = [1, 10, 60, 600, 3600];
const SCRUB_RANGE_MIN = 24 * 60; // slider covers ±24 h around real time
const DISPLAY_REFRESH_MS = 250;

/** Play/pause, speed, ±24 h scrubbing and "Now" for the simulated clock that drives every satellite position. */
/** What the bar shows, read from the clock outside of rendering. */
function readClock(clock: SimClock) {
  const simMs = clock.nowMs();
  return { simMs, offsetMin: Math.round((simMs - Date.now()) / 60_000), live: clock.isLive(), paused: clock.paused, rate: clock.rate };
}

/** Play/pause, speed, ±24 h scrubbing and "Now" for the simulated clock that drives every satellite position. */
export default function TimeControls({ clock }: { clock: SimClock }) {
  // Refresh on control changes and a few times a second so the displayed time keeps moving.
  // Starts empty so the server-rendered HTML (with the server's clock) matches the first client render.
  const [snapshot, setSnapshot] = useState<ReturnType<typeof readClock> | null>(null);
  const { simMs, offsetMin, live, paused, rate } = snapshot ?? { simMs: null, offsetMin: 0, live: true, paused: false, rate: 1 };
  useEffect(() => {
    const update = () => setSnapshot(readClock(clock));
    update();
    const unsubscribe = clock.subscribe(update);
    const timer = window.setInterval(update, DISPLAY_REFRESH_MS);
    return () => {
      unsubscribe();
      window.clearInterval(timer);
    };
  }, [clock]);

  const nudge = (minutes: number) => clock.setTime(clock.nowMs() + minutes * 60_000);

  return (
    <div
      style={{
        pointerEvents: "auto",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: "12px 16px",
        borderRadius: 12,
        background: "rgba(10,10,14,0.82)",
        border: "1px solid rgba(255,255,255,0.10)",
        color: "white",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        fontSize: 11,
        whiteSpace: "nowrap",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ fontWeight: 700, fontSize: 12, letterSpacing: 0.3 }}>TIME</div>
        <div style={{ width: 1, height: 20, background: "rgba(255,255,255,0.15)" }} />
        <div style={{ lineHeight: 1.3, flex: 1 }}>
          <div style={{ fontSize: 12 }}>{simMs === null ? "—" : formatSimTime(simMs)}</div>
          <div style={{ fontSize: 10, color: live ? "#66bb6a" : "rgba(255,255,255,0.5)" }}>
            {live ? "● LIVE" : formatOffset(offsetMin)}
          </div>
        </div>
        <button
          type="button"
          onClick={() => clock.goLive()}
          disabled={live}
          title="Back to real time"
          style={{ ...pill, opacity: live ? 0.4 : 1, cursor: live ? "default" : "pointer" }}
        >
          Now
        </button>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <button
          type="button"
          onClick={() => clock.setPaused(!paused)}
          title={paused ? "Play" : "Pause"}
          aria-label={paused ? "Play" : "Pause"}
          style={iconButton}
        >
          {paused ? "▶" : "❚❚"}
        </button>
        <div style={{ display: "flex", gap: 3 }} role="group" aria-label="Playback speed">
          {SPEEDS.map((speed) => {
            const active = rate === speed;
            return (
              <button
                key={speed}
                type="button"
                onClick={() => clock.setRate(speed)}
                aria-pressed={active}
                title={speed === 1 ? "Real time" : `${speed}× real time`}
                style={{
                  ...pill,
                  borderColor: active ? "#4fc3f7" : "rgba(255,255,255,0.18)",
                  background: active ? "rgba(79,195,247,0.2)" : "transparent",
                  color: active ? "#4fc3f7" : "rgba(255,255,255,0.7)",
                }}
              >
                {speed}×
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <button type="button" onClick={() => nudge(-60)} title="Back 1 hour" style={pill}>−1h</button>
        <input
          type="range"
          min={-SCRUB_RANGE_MIN}
          max={SCRUB_RANGE_MIN}
          step={1}
          value={Math.max(-SCRUB_RANGE_MIN, Math.min(SCRUB_RANGE_MIN, offsetMin))}
          onChange={(e) => clock.setTime(Date.now() + Number(e.target.value) * 60_000)}
          title="Scrub ±24 hours"
          aria-label="Time offset from now"
          style={{ flex: 1, minWidth: 120, accentColor: "#4fc3f7" }}
        />
        <button type="button" onClick={() => nudge(60)} title="Forward 1 hour" style={pill}>+1h</button>
      </div>
    </div>
  );
}

const pill: CSSProperties = {
  padding: "1px 7px",
  borderRadius: 999,
  border: "1px solid rgba(255,255,255,0.18)",
  background: "transparent",
  color: "rgba(255,255,255,0.75)",
  font: "inherit",
  fontSize: 11,
  cursor: "pointer",
};

const iconButton: CSSProperties = { ...pill, width: 30, padding: "1px 0", textAlign: "center" };

function formatSimTime(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatOffset(minutes: number): string {
  if (minutes === 0) return "now";
  const sign = minutes > 0 ? "+" : "−";
  const abs = Math.abs(minutes);
  const d = Math.floor(abs / 1440);
  const h = Math.floor((abs % 1440) / 60);
  const m = abs % 60;
  return `${sign}${d ? `${d}d ` : ""}${h ? `${h}h ` : ""}${m}m from now`;
}
