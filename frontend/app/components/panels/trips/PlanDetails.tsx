import { useState } from "react";
import { planet, type PlanetId } from "../../../lib/trips/bodies";
import { PARKING_ALT_KM, spacecraftPropellantKg, SPACECRAFT_ISP, type Flight } from "../../../lib/trips/launch";
import { PRECISE, siteFor, vehicleFor, type TripLaunch } from "../../../lib/trips/launches";
import { LAUNCH_SITES } from "../../../lib/trips/launchSites";
import type { MoonLeg } from "../../../lib/trips/moonTrip";
import { isMoon, moon, type Destination } from "../../../lib/trips/moons";
import { ARRIVAL_MODES, type Transfer } from "../../../lib/trips/transfer";
import { VEHICLE_BY_ID, VEHICLES } from "../../../lib/trips/vehicles";
import type { SimClock } from "../../../lib/simClock";
import { buttonStyle, errorStyle, hintStyle, MUTED, selectStyle, TEXT } from "../analytics/ui";
import { formatClock, formatDate, formatDateTime, formatDays, kg, kms, Meter, PLAN_COLOR, panelStyle, Row, subheadStyle } from "./ui";

export type LaunchChoice = { vehicleId: string; siteId: string; payloadKg: number };

type Props = {
  origin: PlanetId;
  destination: Destination;
  /** The interplanetary part; null for a trip to a moon of the planet it starts from. */
  transfer: Transfer | null;
  /** The last leg, for a trip to a moon. */
  leg: MoonLeg | null;
  /** Still loading the moon's orbit, or why the leg couldn't be worked out. */
  legLoading: boolean;
  legError: string | null;
  flight: Flight | null;
  /** Why there's no flight when launching from Earth (no window that day, etc.). */
  flightError: string | null;
  /** The real upcoming launch this plan was opened from, if any. */
  plannedLaunch: TripLaunch | null;
  launch: LaunchChoice;
  onLaunchChange: (next: LaunchChoice) => void;
  onWatchLaunch: () => void;
  clock: SimClock;
};

const PROPELLANT_COLOR: Record<string, string> = { "RP-1 / LOX": "#ec835a", "LH2 / LOX": "#7fb2ff", "CH4 / LOX": "#b39ddb", Solid: "#bdbdbd" };

/** A planned trip: the transfer, the moon leg, the launch, the fuel and the flight's timeline. */
export default function PlanDetails({ origin, destination, transfer: t, leg, legLoading, legError, flight, flightError, plannedLaunch, launch, onLaunchChange, onWatchLaunch, clock }: Props) {
  const [anyPadChoice, setAnyPad] = useState(false);
  const fromEarth = origin === "Earth";
  const vehicle = VEHICLE_BY_ID.get(launch.vehicleId)!;
  // A pad the rocket doesn't normally use (picked from a real launch, or by hand) needs the full list.
  const anyPad = anyPadChoice || !vehicle.sites.includes(launch.siteId);
  const pads = anyPad ? LAUNCH_SITES : LAUNCH_SITES.filter((s) => vehicle.sites.includes(s.id));
  const perf = flight?.perf ?? null;
  const target = isMoon(destination) ? moon(destination) : null;
  const dest = planet(target ? target.planet : (destination as PlanetId));
  const arrivalMode = t ? ARRIVAL_MODES.find((m) => m.id === t.arrival)! : null;

  // Burns the spacecraft makes with its own engine: everything after the rocket lets go.
  const ownBurns = leg ? leg.burns.filter((b, i) => !(leg.local && i === 0 && flight)) : t && t.arriveBurnKms > 0 ? [{ label: `Arrival: ${arrivalMode!.label.toLowerCase()}`, dvKms: t.arriveBurnKms }] : [];
  const ownKms = ownBurns.reduce((s, b) => s + b.dvKms, 0);
  const scPropKg = ownKms > 0 ? spacecraftPropellantKg(launch.payloadKg, ownKms) : 0;
  const totalKms = (t ? t.departBurnKms + (leg ? 0 : t.arriveBurnKms) : 0) + (leg ? leg.totalKms : 0);
  const arriveMs = leg?.arriveMs ?? t?.arriveMs ?? null;
  const departMs = t?.departMs ?? leg?.burns[0].ms ?? null;

  return (
    <div style={{ ...panelStyle(330), maxHeight: "100%" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ width: 10, height: 3, background: PLAN_COLOR, borderRadius: 2 }} />
        <span style={{ fontWeight: 700, fontSize: 13 }}>
          {origin} → {destination}
        </span>
      </div>
      {target && !leg?.local && <div style={{ color: MUTED, fontSize: 10, marginTop: 2 }}>via orbit around {target.planet}</div>}

      {plannedLaunch && <PlannedLaunch plannedLaunch={plannedLaunch} flight={flight} vehicleName={vehicle.name} />}

      {departMs !== null && arriveMs !== null && (
        <>
          <div style={subheadStyle}>The trip</div>
          <Row label="Leave" value={formatDateTime(departMs)} />
          <Row label="Arrive" value={formatDateTime(arriveMs)} />
          <Row label="Flight time" value={arriveMs - departMs < 2 * 86_400_000 ? `${((arriveMs - departMs) / 3_600_000).toFixed(1)} hours` : formatDays((arriveMs - departMs) / 86_400_000)} />
        </>
      )}
      {t && (
        <>
          <Row label="Launch energy (C3)" value={`${t.c3.toFixed(1)} km²/s²`} hint="Twice the energy per kg left once free of Earth's gravity; how launch vehicles are rated for deep space." />
          <Row label="Leaving speed (v∞)" value={kms(t.vInfDepartKms)} hint="Speed relative to the departure planet once far from it." />
          <Row label={`Arriving speed at ${t.destination} (v∞)`} value={kms(t.vInfArriveKms)} hint="Speed relative to the destination planet as it approaches." />
          {fromEarth && <Row label="Departure direction" value={`dec ${t.declinationDeg.toFixed(1)}°`} hint="Declination of the departure asymptote (DLA). A pad can launch straight into it only if its parking orbit can be tilted this much." />}
          <Row label="Orbit around the Sun" value={`${t.orbit.periAu.toFixed(2)}–${Number.isFinite(t.orbit.apoAu) ? t.orbit.apoAu.toFixed(2) : "∞"} AU`} hint="Closest and farthest points of the transfer orbit." />
          <Row label="Tilt to the ecliptic" value={`${t.orbit.inclinationDeg.toFixed(2)}°`} />
          <Row label="Goes around" value={`${t.orbit.sweepDeg.toFixed(0)}° (${t.orbit.longWay ? "Type II, the long way" : "Type I, the short way"})`} />
        </>
      )}

      {target && (
        <>
          <div style={subheadStyle}>{leg?.local ? `${origin} to ${target.id}` : `Inside ${target.planet}'s system`}</div>
          {legLoading && <div style={{ color: MUTED, fontSize: 11 }}>Loading {target.id}&apos;s orbit from JPL Horizons…</div>}
          {legError && <div style={errorStyle}>{legError}</div>}
          {leg && (
            <>
              {leg.capture && (
                <>
                  <Row
                    label="Capture orbit"
                    value={`${Math.round(leg.capture.periKm - dest.radiusKm).toLocaleString("en-US")} × ${Math.round(leg.capture.apoKm - dest.radiusKm).toLocaleString("en-US")} km`}
                    hint="Low and high points above the planet. How low to brake was searched along with the rest: low gets more help from the planet's gravity, high leaves less speed to lose at the moon."
                  />
                  <Row label="Loops before heading out" value={`${leg.capture.loops} × ${leg.capture.periodHours < 48 ? `${leg.capture.periodHours.toFixed(1)} h` : `${(leg.capture.periodHours / 24).toFixed(1)} d`}`} hint={`Waiting for ${target.id} to come round to the right place.`} />
                </>
              )}
              <Row label={`Transfer to ${target.id}`} value={leg.transferDays < 2 ? `${(leg.transferDays * 24).toFixed(1)} hours` : formatDays(leg.transferDays)} />
              <Row label={`Arriving speed at ${target.id}`} value={kms(leg.vInfMoonKms)} hint={`Speed relative to ${target.id} on reaching it.`} />
              {leg.local && leg.missKm > 1 && <Row label="Miss distance" value={`${Math.round(leg.missKm).toLocaleString("en-US")} km`} hint="How far from the moon the coast ends without a course correction." />}
              <Row label="On arrival" value={leg.insertion === "rendezvous" ? `match speed with ${target.id}` : `${target.lowOrbitAltKm} km circular orbit`} />
            </>
          )}
        </>
      )}

      <div style={subheadStyle}>Δv budget</div>
      {fromEarth && perf && <Row label="Pad → parking orbit" value={kms(perf.toOrbitKms)} hint={`Orbital speed ${kms(7.784)} + losses ${kms(perf.lossesKms)} − Earth's spin ${kms(perf.rotationKms)}`} />}
      {t && <Row label={`Departure burn (from ${fromEarth ? PARKING_ALT_KM : planet(t.origin).lowOrbitAltKm} km orbit)`} value={kms(t.departBurnKms)} />}
      {t && !target && arrivalMode && <Row label={`Arrival: ${arrivalMode.label.toLowerCase()}`} value={kms(t.arriveBurnKms)} hint={arrivalMode.detail} />}
      {leg?.burns.map((b) => <Row key={b.label} label={b.label} value={kms(b.dvKms)} hint={b.hint} />)}
      {(t || leg) && <Row label="Total after leaving orbit" value={<b>{kms(totalKms)}</b>} />}

      {fromEarth && (
        <>
          <div style={subheadStyle}>Launch</div>
          <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "6px 8px", alignItems: "center" }}>
            <label htmlFor="trip-rocket" style={{ color: MUTED, fontSize: 11 }}>
              Rocket
            </label>
            <select
              id="trip-rocket"
              value={launch.vehicleId}
              onChange={(e) => {
                const v = VEHICLE_BY_ID.get(e.target.value)!;
                onLaunchChange({ ...launch, vehicleId: v.id, siteId: anyPadChoice || v.sites.includes(launch.siteId) ? launch.siteId : v.sites[0] });
              }}
              style={{ ...selectStyle, padding: "4px 6px" }}
            >
              {VEHICLES.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
            <label htmlFor="trip-pad" style={{ color: MUTED, fontSize: 11 }}>
              Pad
            </label>
            <select id="trip-pad" value={launch.siteId} onChange={(e) => onLaunchChange({ ...launch, siteId: e.target.value })} style={{ ...selectStyle, padding: "4px 6px" }}>
              {pads.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <label htmlFor="trip-payload" style={{ color: MUTED, fontSize: 11 }}>
              Spacecraft
            </label>
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <input
                id="trip-payload"
                type="number"
                min={100}
                max={200000}
                step={100}
                value={launch.payloadKg}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v) && v > 0) onLaunchChange({ ...launch, payloadKg: v });
                }}
                style={{ ...selectStyle, padding: "4px 6px", width: 90 }}
              />
              <span style={{ color: MUTED, fontSize: 11 }}>kg</span>
            </span>
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 6, color: MUTED, fontSize: 10, marginTop: 6 }}>
            <input
              type="checkbox"
              checked={anyPad}
              onChange={(e) => {
                setAnyPad(e.target.checked);
                if (!e.target.checked && !vehicle.sites.includes(launch.siteId)) onLaunchChange({ ...launch, siteId: vehicle.sites[0] });
              }}
            />
            Any pad in the world (what if)
          </label>
          {vehicle.note && <p style={{ ...hintStyle, fontSize: 10, marginTop: 4 }}>{vehicle.note}</p>}

          {flightError && <div style={{ ...errorStyle, marginTop: 8 }}>{flightError}</div>}
          {flight && perf && (
            <>
              <div
                style={{
                  marginTop: 8,
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: `1px solid ${perf.canDo ? "rgba(12,163,12,0.5)" : "rgba(208,59,59,0.6)"}`,
                  background: perf.canDo ? "rgba(12,163,12,0.10)" : "rgba(208,59,59,0.12)",
                  fontSize: 11,
                  color: TEXT,
                }}
              >
                <b>{perf.canDo ? "✓ It can make it" : "✕ Not enough rocket"}</b>
                <div style={{ color: MUTED, fontSize: 10, marginTop: 2 }}>
                  {perf.canDo ? `${kms(perf.marginKms)} to spare. ` : `${kms(-perf.marginKms)} short. `}
                  The most it can send on this trip is {kg(perf.maxPayloadKg)}.
                </div>
              </div>
              <Row label="Launch" value={formatDateTime(flight.window.launchMs)} />
              <Row label="Heading" value={`${flight.window.azimuthDeg.toFixed(1)}° from north`} />
              <Row label="Parking orbit tilt" value={`${flight.window.inclinationDeg.toFixed(1)}°`} hint="Must contain both the pad at liftoff and the departure direction." />
              <Row label="Help from Earth's spin" value={kms(perf.rotationKms)} />
              <Row label="Coast before departure" value={`${Math.round(flight.coastS / 60)} min`} />
              <Row label="Liftoff mass" value={kg(perf.liftoffMassKg)} />
              <Row label="Liftoff thrust" value={`${Math.round(perf.liftoffThrustKn).toLocaleString("en-US")} kN`} hint={`Thrust-to-weight ${((perf.liftoffThrustKn * 1000) / (perf.liftoffMassKg * 9.80665)).toFixed(2)}`} />

              <div style={subheadStyle}>Propellant by stage</div>
              {perf.stages.map((s) => (
                <div key={s.name} style={{ marginBottom: 7 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10 }}>
                    <span style={{ color: TEXT }}>
                      {s.count > 1 ? `${s.count} × ` : ""}
                      {s.name}
                    </span>
                    <span style={{ color: MUTED }}>
                      {kg(s.usedKg * s.count)} of {kg(s.propKg * s.count)}
                    </span>
                  </div>
                  <Meter fraction={s.usedKg / s.propKg} color={PROPELLANT_COLOR[s.propellant] ?? "#bdbdbd"} label={`${s.name} propellant used`} />
                  <div style={{ color: MUTED, fontSize: 9, marginTop: 1 }}>
                    {s.engines} · {s.propellant}
                    {s.toOrbitKg !== undefined && ` · ${kg(s.toOrbitKg)} to orbit, ${kg(s.departKg ?? 0)} departure, ${kg(Math.max(0, s.propKg - s.usedKg))} left`}
                  </div>
                </div>
              ))}
            </>
          )}
        </>
      )}

      {ownKms > 0 && (
        <>
          <div style={subheadStyle}>Spacecraft fuel</div>
          <p style={{ ...hintStyle, marginBottom: 4 }}>
            The spacecraft makes {ownBurns.length === 1 ? "its braking burn" : `its ${ownBurns.length} burns (${kms(ownKms)})`} with its own engine (Isp {SPACECRAFT_ISP} s). Of its {kg(launch.payloadKg)}, about{" "}
            <b style={{ color: TEXT }}>{kg(scPropKg)}</b> ({Math.round((scPropKg / launch.payloadKg) * 100)}%) has to be propellant
            {!target && t?.arrival === "capture"
              ? `, into a ${Math.round(t.arrivalPeriapsisKm - dest.radiusKm).toLocaleString("en-US")} × ${Math.round((t.arrivalApoapsisKm ?? 0) - dest.radiusKm).toLocaleString("en-US")} km orbit.`
              : !target && t?.arrival === "orbit"
                ? `, into a ${dest.lowOrbitAltKm.toLocaleString("en-US")} km circular orbit.`
                : "."}
            {scPropKg / launch.payloadKg > 0.85 && " That leaves almost nothing for the spacecraft itself: real missions cut this with gravity assists."}
          </p>
        </>
      )}

      {(flight || leg) && (
        <>
          <div style={{ ...subheadStyle, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>Flight</span>
            {flight && (
              <button type="button" onClick={onWatchLaunch} style={{ ...buttonStyle(true), padding: "3px 8px", fontSize: 10, textTransform: "none", letterSpacing: 0 }}>
                ▶ Watch the launch
              </button>
            )}
          </div>
          {flight?.events.map((e) => (
            <TimelineRow key={e.label + e.tS} when={formatClock(e.tS)} label={e.label} onClick={() => clock.setTime(flight.window.launchMs + e.tS * 1000 - 5000)} />
          ))}
          {t && !leg && <TimelineRow when={`+${Math.round(t.tofDays)} d`} label={`Arrives at ${t.destination}`} onClick={() => clock.setTime(t.arriveMs - 86_400_000)} />}
          {leg?.burns
            .filter((_, i) => !(leg.local && i === 0 && flight))
            .map((b) => (
              <TimelineRow key={b.label} when={leg.local && departMs !== null ? sinceStart(b.ms - departMs) : formatDate(b.ms)} label={b.label} onClick={() => clock.setTime(b.ms - (leg.local ? 3_600_000 : 86_400_000))} />
            ))}
        </>
      )}

      <p style={{ ...hintStyle, fontSize: 10, marginTop: 10 }}>
        Computed: the transfer orbit{target ? `s (Lambert solver, patched conics, around the Sun and inside ${target.planet}'s sphere of influence)` : " (Lambert solver, patched conics)"}, the launch time and heading, and
        propellant from the rocket equation. Modelled: the climb to orbit, and losses to gravity and drag
        {perf ? ` (${kms(perf.lossesKms)}, set so ${vehicle.name} lifts its published ${kg(vehicle.leoKg)} to low orbit)` : ""}.
        {target &&
          ` ${target.id}'s position comes from ${target.source === "horizons" ? "JPL Horizons" : "astronomy-engine"}; its gravity only counts for the final burn.`}{" "}
        Not included: gravity assists{target && !leg?.local ? " (including moon-to-moon tours, how real missions cut the cost of this leg)" : ""}, course corrections and kick stages. Rocket figures are rounded public numbers.
      </p>
    </div>
  );
}

/** The Launch Library launch this plan is based on, and how it was mapped onto what Trips models. */
function PlannedLaunch({ plannedLaunch, flight, vehicleName }: { plannedLaunch: TripLaunch; flight: Flight | null; vehicleName: string }) {
  const l = plannedLaunch.launch;
  const net = l.net ? Date.parse(l.net) : NaN;
  const precise = PRECISE.has(l.netPrecision ?? "");
  const modelled = vehicleFor(l.rocket);
  const pad = siteFor(l.padLatitude, l.padLongitude);
  return (
    <div style={{ marginTop: 8, padding: "7px 9px", borderRadius: 8, border: `1px solid ${PLAN_COLOR}55`, background: "rgba(77,208,225,0.07)", fontSize: 10, color: MUTED }}>
      <div style={{ color: TEXT, fontWeight: 700, fontSize: 11 }}>{l.missionName ?? l.name}</div>
      <div>
        Launch Library: {l.rocket ?? "rocket to be decided"} from {l.padName ?? "a pad to be decided"}, {Number.isFinite(net) ? (precise ? formatDateTime(net) : `no earlier than ${formatDate(net)}`) : "date to be decided"}
        {l.statusName ? ` (${l.statusName})` : ""}.
      </div>
      {!modelled && <div>{l.rocket ?? "Its rocket"} isn&apos;t modelled here, so this uses {vehicleName}.</div>}
      {pad && pad.km > 25 && <div>Nearest modelled pad: {pad.site.name}, {Math.round(pad.km)} km away.</div>}
      {flight && precise && Number.isFinite(net) && (
        <div>
          Lune&apos;s launch time for that day: {formatDateTime(flight.window.launchMs)} ({Math.round(Math.abs(flight.window.launchMs - net) / 60_000)} min {flight.window.launchMs >= net ? "after" : "before"} the planned time). The real one also
          depends on things not modelled here, like the target orbit and range rules.
        </div>
      )}
      <div style={{ marginTop: 2 }}>Destination read from: {plannedLaunch.reason}.</div>
    </div>
  );
}

function TimelineRow({ when, label, onClick }: { when: string; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ display: "grid", gridTemplateColumns: "74px 1fr", width: "100%", gap: 6, padding: "3px 4px", border: "none", borderRadius: 4, background: "transparent", color: TEXT, fontFamily: "inherit", fontSize: 10, textAlign: "left", cursor: "pointer" }}
    >
      <span style={{ color: MUTED, fontVariantNumeric: "tabular-nums" }}>{when}</span>
      <span>{label}</span>
    </button>
  );
}

/** Time after departure: "+4.9 d", "+12 d". */
function sinceStart(ms: number): string {
  const days = ms / 86_400_000;
  return `+${days < 10 ? days.toFixed(1) : Math.round(days)} d`;
}

export function defaultLaunch(): LaunchChoice {
  return { vehicleId: "falcon-heavy", siteId: "ksc-lc-39a", payloadKg: 4000 };
}
