import { useEffect, useRef } from "react";
import { flightState, type Flight } from "../../../lib/trips/launch";
import { createRocketView, type RocketView } from "../../../lib/trips/rocketModel";
import type { SimClock } from "../../../lib/simClock";
import { MUTED, TEXT } from "../analytics/ui";
import { useClockTime } from "./TripTimeControls";
import { formatClock, kg, panelStyle, Row } from "./ui";

const PHASE_LABEL = { pad: "On the pad", ascent: "Climbing to orbit", coast: "Coasting in parking orbit", burn: "Departure burn", escape: "Leaving Earth" } as const;

/** The rocket up close, built from its stages' real sizes, with live readouts for the clock's moment. */
export default function VehiclePanel({ flight, clock }: { flight: Flight; clock: SimClock }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<RocketView | null>(null);
  const ms = useClockTime(clock, 200);

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const view = createRocketView(el, () => clock.nowMs());
    viewRef.current = view;
    return () => {
      view.dispose();
      viewRef.current = null;
    };
  }, [clock]);
  useEffect(() => {
    viewRef.current?.setFlight(flight);
  }, [flight]);

  const s = ms === null ? null : flightState(flight, ms);
  const tS = ms === null ? 0 : (ms - flight.window.launchMs) / 1000;
  const v = flight.vehicle;
  const stageLabel = !s
    ? "—"
    : s.firing === "boosters+core"
      ? `${v.boosters?.count} boosters + ${v.core.name}`
      : s.firing === "core"
        ? v.core.name
        : s.firing === "upper"
          ? v.upper.name
          : s.attached.upper
            ? `${v.upper.name} (engine off)`
            : s.attached.core
              ? `${v.core.name} (engine off)`
              : "Spacecraft on its own";

  return (
    <div style={{ ...panelStyle(260) }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={{ fontWeight: 700 }}>{v.name}</span>
        <span style={{ color: MUTED, fontSize: 10, fontVariantNumeric: "tabular-nums" }}>{formatClock(tS)}</span>
      </div>
      <div ref={hostRef} style={{ position: "relative", width: "100%", height: 210, marginTop: 4 }} aria-label="3D model of the rocket" role="img" />
      {s && (
        <>
          <div style={{ color: TEXT, fontSize: 11, margin: "4px 0" }}>{PHASE_LABEL[s.phase]}</div>
          <Row label="Firing" value={stageLabel} />
          <Row label="Altitude" value={s.altKm < 100_000 ? `${Math.round(s.altKm).toLocaleString("en-US")} km` : `${(s.altKm / 1e6).toFixed(2)} million km`} />
          <Row label="Speed" value={`${s.speedKms.toFixed(2)} km/s`} hint="Relative to Earth's centre (not the ground)" />
          <Row label="Acceleration" value={s.accelG > 0 ? `${s.accelG.toFixed(1)} g` : "—"} />
          {s.massKg !== null && <Row label="Mass" value={kg(s.massKg)} />}
        </>
      )}
    </div>
  );
}
