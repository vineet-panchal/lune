import { useMemo, useState } from "react";
import { hohmann, PLANETS, synodicDays, type PlanetId } from "../../../lib/trips/bodies";
import { PRECISE, siteFor, vehicleFor, type TripLaunch, type TripLaunchFeed } from "../../../lib/trips/launches";
import { STATUS_LABEL, type MissionStatus, type TripMission } from "../../../lib/trips/missions";
import type { MoonLeg } from "../../../lib/trips/moonTrip";
import { isMoon, moon, MOONS, type Destination } from "../../../lib/trips/moons";
import { cellTimes, type PorkchopGrid } from "../../../lib/trips/porkchop";
import { ARRIVAL_MODES, type ArrivalMode, type Transfer } from "../../../lib/trips/transfer";
import { chipStyle, errorStyle, hintStyle, MUTED, selectStyle, TEXT } from "../analytics/ui";
import Porkchop, { bestWindows, type PorkchopMetric } from "./Porkchop";
import { formatDate, formatDateTime, formatDays, MISSION_COLOR, PLAN_COLOR, panelStyle, Row, subheadStyle } from "./ui";

export type TripsMode = "missions" | "plan" | "upcoming";

type Props = {
  mode: TripsMode;
  onModeChange: (mode: TripsMode) => void;
  // Real missions
  missions: TripMission[] | null;
  missionsError: string | null;
  selectedMission: string | null;
  onSelectMission: (id: string) => void;
  // Planner
  origin: PlanetId;
  destination: Destination;
  onRouteChange: (origin: PlanetId, destination: Destination) => void;
  /** A trip to a moon of the planet it starts from (Earth to the Moon): no launch-window chart, just a day. */
  localDay: number | null;
  onLocalDayChange: (dayMs: number) => void;
  moonLeg: MoonLeg | null;
  arrival: ArrivalMode;
  onArrivalChange: (mode: ArrivalMode) => void;
  grid: PorkchopGrid | null;
  computing: boolean;
  selectedCell: { col: number; row: number } | null;
  onSelectCell: (col: number, row: number) => void;
  onShiftWindow: (direction: -1 | 1) => void;
  transfer: Transfer | null;
  // Upcoming launches
  launches: TripLaunchFeed | null;
  launchesError: string | null;
  onPlanLaunch: (launch: TripLaunch) => void;
};

const STATUS_COLOR: Record<MissionStatus, string> = { operating: "#0ca30c", "en-route": "#fab219", complete: "#8a93a6" };

export default function TripsPanel(props: Props) {
  const { mode, onModeChange } = props;
  return (
    <div style={{ ...panelStyle(320), maxHeight: "calc(100vh - 290px)" }}>
      <div style={{ fontWeight: 700, marginBottom: 8 }}>Trips</div>
      <div role="tablist" aria-label="Trips" style={{ display: "flex", gap: 6, marginBottom: 10 }}>
        <button type="button" role="tab" aria-selected={mode === "missions"} onClick={() => onModeChange("missions")} style={chipStyle(mode === "missions")}>
          Real missions
        </button>
        <button type="button" role="tab" aria-selected={mode === "plan"} onClick={() => onModeChange("plan")} style={chipStyle(mode === "plan")}>
          Plan a trip
        </button>
        <button type="button" role="tab" aria-selected={mode === "upcoming"} onClick={() => onModeChange("upcoming")} style={chipStyle(mode === "upcoming")}>
          Upcoming
        </button>
      </div>
      {mode === "missions" ? <MissionList {...props} /> : mode === "plan" ? <Planner {...props} /> : <UpcomingList {...props} />}
    </div>
  );
}

// ── Real missions ──

const FILTERS: { id: "all" | MissionStatus; label: string }[] = [
  { id: "all", label: "All" },
  { id: "en-route", label: "En route" },
  { id: "operating", label: "Operating" },
  { id: "complete", label: "Complete" },
];

function MissionList({ missions, missionsError, selectedMission, onSelectMission }: Props) {
  const [filter, setFilter] = useState<"all" | MissionStatus>("all");
  const shown = (missions ?? []).filter((m) => filter === "all" || m.status === filter);
  return (
    <>
      <p style={{ ...hintStyle, marginBottom: 8 }}>
        Real spacecraft paths from NASA JPL&apos;s Horizons system, including the planned route ahead for missions still flying.
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 8 }}>
        {FILTERS.map((f) => (
          <button key={f.id} type="button" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)} style={{ ...chipStyle(filter === f.id), padding: "4px 8px", fontSize: 10 }}>
            {f.label}
          </button>
        ))}
      </div>
      {missionsError && <div style={errorStyle}>{missionsError}</div>}
      {!missions && !missionsError && <div style={{ color: MUTED, fontSize: 11 }}>Loading missions…</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {shown.map((m) => {
          const active = m.id === selectedMission;
          const launchYear = new Date(m.events.find((e) => e.kind === "launch")?.time ?? m.dataStart).getUTCFullYear();
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => onSelectMission(m.id)}
              aria-pressed={active}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "6px 8px",
                borderRadius: 6,
                border: active ? `1px solid ${MISSION_COLOR}88` : "1px solid transparent",
                background: active ? "rgba(255,183,77,0.12)" : "transparent",
                color: TEXT,
                fontFamily: "inherit",
                fontSize: 11,
                textAlign: "left",
                cursor: "pointer",
              }}
            >
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.name}</span>
                <span style={{ display: "block", color: MUTED, fontSize: 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {launchYear} · {m.targets.join(", ")}
                </span>
              </span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 9, color: MUTED, flex: "none" }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: STATUS_COLOR[m.status] }} />
                {STATUS_LABEL[m.status]}
              </span>
            </button>
          );
        })}
      </div>
    </>
  );
}

// ── Planner ──

function Planner(props: Props) {
  const { origin, destination, onRouteChange, arrival, onArrivalChange } = props;
  const target = isMoon(destination) ? moon(destination) : null;
  const local = target !== null && target.planet === origin;
  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "auto 1fr auto 1fr", alignItems: "center", gap: 6, marginBottom: 8 }}>
        <label htmlFor="trip-from" style={{ color: MUTED, fontSize: 11 }}>
          From
        </label>
        <select id="trip-from" value={origin} onChange={(e) => onRouteChange(e.target.value as PlanetId, destination === e.target.value ? origin : destination)} style={{ ...selectStyle, padding: "4px 6px" }}>
          {PLANETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.id}
            </option>
          ))}
        </select>
        <label htmlFor="trip-to" style={{ color: MUTED, fontSize: 11 }}>
          to
        </label>
        <select id="trip-to" value={destination} onChange={(e) => {
            const next = e.target.value as Destination;
            // Picking the planet you're leaving from swaps the two (or, coming from a moon, leaves from Earth).
            const from = next !== origin ? origin : !isMoon(destination) ? destination : origin === "Earth" ? "Mars" : "Earth";
            onRouteChange(from, next);
          }} style={{ ...selectStyle, padding: "4px 6px" }}>
          <optgroup label="Planets">
            {PLANETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.id}
              </option>
            ))}
          </optgroup>
          <optgroup label="Moons">
            {MOONS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.id} ({m.planet})
              </option>
            ))}
          </optgroup>
        </select>
      </div>

      {local ? (
        <LocalPlanner {...props} />
      ) : (
        <>
          {target ? (
            <p style={{ ...hintStyle, marginBottom: 10 }}>
              A trip to {target.id} is a trip to {target.planet}, a braking burn into orbit there, then a hop across {target.planet}&apos;s system to {target.id}. The chart ranks the
              trip to {target.planet}; the moon leg is added for the trip you pick.
            </p>
          ) : (
            <>
              <div style={{ color: MUTED, fontSize: 10, marginBottom: 4 }}>On arrival</div>
              <div style={{ display: "flex", gap: 4, marginBottom: 4 }}>
                {ARRIVAL_MODES.map((m) => (
                  <button key={m.id} type="button" aria-pressed={arrival === m.id} title={m.detail} onClick={() => onArrivalChange(m.id)} style={{ ...chipStyle(arrival === m.id), padding: "4px 8px", fontSize: 10 }}>
                    {m.label}
                  </button>
                ))}
              </div>
              <p style={{ ...hintStyle, marginBottom: 10 }}>{ARRIVAL_MODES.find((m) => m.id === arrival)!.detail}</p>
            </>
          )}
          <WindowChart {...props} gridPlanet={target ? target.planet : (destination as PlanetId)} />
        </>
      )}
    </>
  );
}

/** Earth to the Moon, Mars to Phobos…: no planets to line up, so any day works; the launch time sets the plane. */
function LocalPlanner({ origin, destination, localDay, onLocalDayChange, moonLeg }: Props) {
  const m = moon(destination as Exclude<Destination, PlanetId>);
  const value = localDay === null ? "" : new Date(localDay).toISOString().slice(0, 10);
  return (
    <>
      <p style={{ ...hintStyle, marginBottom: 8 }}>
        {m.id} goes round {origin}, so there&apos;s no launch window to wait for: a trip can leave any day. The departure is timed so that {m.id} is at the far end of the transfer
        orbit when the spacecraft gets there{origin === "Earth" ? ", and the launch time so that the parking orbit's plane contains that point" : ""}.
      </p>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <label htmlFor="trip-day" style={{ color: MUTED, fontSize: 11 }}>
          Leave on
        </label>
        <input
          id="trip-day"
          type="date"
          value={value}
          onChange={(e) => {
            const ms = Date.parse(e.target.value);
            if (Number.isFinite(ms)) onLocalDayChange(ms);
          }}
          style={{ ...selectStyle, padding: "4px 6px" }}
        />
        {localDay !== null && (
          <span style={{ display: "flex", gap: 4 }}>
            <button type="button" aria-label="Previous day" onClick={() => onLocalDayChange(localDay - 86_400_000)} style={{ ...chipStyle(false), padding: "3px 7px", fontSize: 10 }}>
              ←
            </button>
            <button type="button" aria-label="Next day" onClick={() => onLocalDayChange(localDay + 86_400_000)} style={{ ...chipStyle(false), padding: "3px 7px", fontSize: 10 }}>
              →
            </button>
          </span>
        )}
      </div>
      <div style={subheadStyle}>{m.id}</div>
      <Row label={`Distance from ${m.planet}`} value={`${m.smaKm.toLocaleString("en-US")} km`} />
      <Row label="Goes round in" value={m.periodDays < 2 ? `${(m.periodDays * 24).toFixed(1)} hours` : `${m.periodDays.toFixed(1)} days`} />
      {moonLeg && <Row label="Picked trip" value={`${formatDate(moonLeg.burns[0].ms)} → ${formatDate(moonLeg.arriveMs)}`} />}
    </>
  );
}

function WindowChart({ origin, gridPlanet, grid, computing, selectedCell, onSelectCell, onShiftWindow, transfer }: Props & { gridPlanet: PlanetId }) {
  const [metric, setMetric] = useState<PorkchopMetric>("total");
  const windows = useMemo(() => (grid ? bestWindows(grid) : []), [grid]);
  const h = hohmann(origin, gridPlanet);
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ fontWeight: 600, color: "#c5d5f1" }}>Launch windows</span>
        <span style={{ display: "flex", gap: 4 }}>
          {(["total", "c3"] as const).map((m) => (
            <button key={m} type="button" aria-pressed={metric === m} onClick={() => setMetric(m)} style={{ ...chipStyle(metric === m), padding: "3px 7px", fontSize: 9 }}>
              {m === "total" ? "Δv" : "C3"}
            </button>
          ))}
        </span>
      </div>
      <p style={{ ...hintStyle, marginBottom: 6 }}>
        Every departure date (across) and flight time (up), solved as a transfer orbit. Light islands are launch windows; the ringed cell is the cheapest. Click to pick a trip.
      </p>
      <Porkchop grid={grid} metric={metric} selected={selectedCell} onSelect={onSelectCell} computing={computing} />
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
        <button type="button" onClick={() => onShiftWindow(-1)} style={{ ...chipStyle(false), padding: "3px 8px", fontSize: 10 }}>
          ← Earlier
        </button>
        <button type="button" onClick={() => onShiftWindow(1)} style={{ ...chipStyle(false), padding: "3px 8px", fontSize: 10 }}>
          Later →
        </button>
      </div>

      {grid && windows.length > 0 && (
        <>
          <div style={subheadStyle}>Cheapest windows on this chart</div>
          {windows.map((w) => {
            const t = cellTimes(grid, w.col, w.row);
            const active = selectedCell?.col === w.col && selectedCell?.row === w.row;
            return (
              <button
                key={`${w.col}-${w.row}`}
                type="button"
                onClick={() => onSelectCell(w.col, w.row)}
                style={{ display: "flex", width: "100%", justifyContent: "space-between", gap: 6, padding: "4px 6px", borderRadius: 6, border: active ? "1px solid rgba(255,213,79,0.6)" : "1px solid transparent", background: active ? "rgba(255,213,79,0.08)" : "transparent", color: TEXT, fontFamily: "inherit", fontSize: 10, cursor: "pointer", textAlign: "left" }}
              >
                <span>{formatDate(t.departMs)}</span>
                <span style={{ color: MUTED }}>{Math.round(t.tofDays)} d</span>
                <span>C3 {w.c3.toFixed(1)}</span>
                <span>Δv {w.total.toFixed(2)}</span>
              </button>
            );
          })}
        </>
      )}

      <div style={subheadStyle}>For comparison</div>
      <Row label="Ideal Hohmann transfer" value={formatDays(h.tofDays)} hint="Circular, flat orbits at the planets' average distances; real planets don't line up that neatly." />
      <Row label="Windows repeat every" value={formatDays(synodicDays(origin, gridPlanet))} hint="The synodic period: how long until the two planets are in the same relative position again." />
      {transfer && <Row label="Picked trip" value={`${formatDate(transfer.departMs)} → ${formatDate(transfer.arriveMs)}`} />}
    </>
  );
}

// ── Upcoming launches ──

function UpcomingList({ launches, launchesError, onPlanLaunch }: Props) {
  const list = launches?.data ?? null;
  return (
    <>
      <p style={{ ...hintStyle, marginBottom: 8 }}>
        Launches on the way to a planet or a moon, from Launch Library 2. Plan one to see its trip worked out for that date, rocket and pad.
      </p>
      {(launchesError || launches?.error) && <div style={errorStyle}>{launchesError ?? launches?.error}</div>}
      {!list && !launchesError && <div style={{ color: MUTED, fontSize: 11 }}>Loading launches…</div>}
      {list && list.length === 0 && <div style={{ color: MUTED, fontSize: 11 }}>No launches to planets or moons in the next 100 on Launch Library&apos;s schedule.</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {(list ?? []).map((t) => {
          const l = t.launch;
          const net = l.net ? Date.parse(l.net) : NaN;
          const vehicle = vehicleFor(l.rocket);
          const pad = siteFor(l.padLatitude, l.padLongitude);
          return (
            <div key={l.id} style={{ padding: "8px 9px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.10)", background: "rgba(255,255,255,0.03)", fontSize: 11 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
                <span style={{ fontWeight: 700, color: TEXT, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{l.missionName ?? l.name}</span>
                <span style={{ flex: "none", fontSize: 10, color: PLAN_COLOR, border: `1px solid ${PLAN_COLOR}66`, borderRadius: 10, padding: "0 6px" }} title={t.reason}>
                  {t.destination}
                </span>
              </div>
              <div style={{ color: MUTED, fontSize: 10, marginTop: 2 }}>
                {Number.isFinite(net) ? (PRECISE.has(l.netPrecision ?? "") ? formatDateTime(net) : `NET ${formatDate(net)}`) : "Date to be decided"}
                {l.status ? ` · ${l.statusName ?? l.status}` : ""}
              </div>
              <div style={{ color: MUTED, fontSize: 10 }}>
                {l.rocket ?? "Rocket?"} · {l.padName ?? "Pad?"}
                {l.location ? `, ${l.location}` : ""}
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6, marginTop: 6 }}>
                <span style={{ color: MUTED, fontSize: 9 }}>
                  {vehicle ? `Modelled: ${vehicle.name}` : "Rocket not modelled"}
                  {pad && pad.km > 25 ? ` · nearest pad ${Math.round(pad.km)} km away` : ""}
                </span>
                <button type="button" disabled={!Number.isFinite(net)} onClick={() => onPlanLaunch(t)} style={{ ...chipStyle(false, !Number.isFinite(net)), padding: "3px 8px", fontSize: 10, flex: "none" }}>
                  Plan this trip →
                </button>
              </div>
            </div>
          );
        })}
      </div>
      {launches?.updatedAt && <p style={{ ...hintStyle, fontSize: 9, marginTop: 8 }}>Launch Library data from {formatDateTime(Date.parse(launches.updatedAt))}. The destination is read from each mission&apos;s orbit and description.</p>}
    </>
  );
}
