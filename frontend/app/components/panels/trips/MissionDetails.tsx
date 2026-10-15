import { AU_KM, helioEclipticAu } from "../../../lib/trips/bodies";
import { STATUS_LABEL, trajectoryPosition, trajectorySpeedKms, type TrajectoryFeed, type TripMission } from "../../../lib/trips/missions";
import type { SimClock } from "../../../lib/simClock";
import { errorStyle, hintStyle, linkStyle, MUTED, TEXT } from "../analytics/ui";
import { useClockTime } from "./TripTimeControls";
import { distanceText, formatDate, formatDateTime, lightTime, MISSION_COLOR, panelStyle, Row, subheadStyle } from "./ui";

const KIND_ICON: Record<string, string> = { launch: "▲", flyby: "↷", arrival: "◎", landing: "▼", milestone: "◆", end: "■" };

/** A real mission: what it is, where it is at the clock's time and its timeline (click a moment to go there). */
export default function MissionDetails({ mission, feed, clock }: { mission: TripMission; feed: TrajectoryFeed | null; clock: SimClock }) {
  const ms = useClockTime(clock);
  const traj = feed?.data ?? null;
  const start = Date.parse(mission.dataStart);
  const stop = Date.parse(mission.dataStop);
  const inRange = ms !== null && ms >= start && ms <= stop;

  let where: { sunKm: number; earthKm: number; speed: number } | null = null;
  if (traj && ms !== null && inRange) {
    const p = trajectoryPosition(traj, ms);
    const e = helioEclipticAu("Earth", ms);
    where = {
      sunKm: Math.hypot(p[0], p[1], p[2]) * AU_KM,
      earthKm: Math.hypot(p[0] - e[0], p[1] - e[1], p[2] - e[2]) * AU_KM,
      speed: trajectorySpeedKms(traj, ms),
    };
  }
  const nowEvent = ms === null ? null : [...mission.events].reverse().find((e) => Date.parse(e.time) <= ms);

  return (
    <div style={{ ...panelStyle(320), maxHeight: "100%" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span style={{ width: 10, height: 3, background: MISSION_COLOR, borderRadius: 2, flex: "none", alignSelf: "center" }} />
        <span style={{ fontWeight: 700, fontSize: 13 }}>{mission.name}</span>
      </div>
      <div style={{ color: MUTED, fontSize: 10, margin: "2px 0 8px" }}>
        {mission.agency} · {STATUS_LABEL[mission.status]}
      </div>
      <p style={{ ...hintStyle, color: TEXT, marginBottom: 8 }}>{mission.summary}</p>
      <Row label="Rocket" value={mission.launchVehicle} />
      <Row label="Launched from" value={mission.launchSite} />
      <Row label="Targets" value={mission.targets.join(", ")} />

      <div style={subheadStyle}>At {ms === null ? "—" : formatDate(ms)}</div>
      {feed?.error && !traj && <div style={errorStyle}>{feed.error}</div>}
      {!traj && !feed?.error && <div style={{ color: MUTED, fontSize: 11 }}>Downloading the path from JPL Horizons…</div>}
      {traj && !inRange && (
        <p style={hintStyle}>
          {ms !== null && ms < start ? "Not launched yet at this time." : "Past the end of the path Lune shows."}{" "}
          <button type="button" style={linkStyle} onClick={() => clock.setTime(Math.min(stop, Math.max(start, Date.now())))}>
            Go to the mission
          </button>
        </p>
      )}
      {where && (
        <>
          <Row label="From the Sun" value={distanceText(where.sunKm)} />
          <Row label="From Earth" value={distanceText(where.earthKm)} />
          <Row label="Radio signal takes" value={lightTime(where.earthKm)} hint="One-way light time from Earth" />
          <Row label="Speed around the Sun" value={`${where.speed.toFixed(1)} km/s`} />
          {nowEvent && <Row label="Last event" value={nowEvent.label} />}
        </>
      )}
      {feed?.loading && traj && <div style={{ color: MUTED, fontSize: 10, marginTop: 4 }}>Adding flyby detail…</div>}

      <div style={subheadStyle}>Timeline</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
        {mission.events.map((e) => {
          const t = Date.parse(e.time);
          const past = ms !== null && t <= ms;
          const jumpable = t >= start - 86_400_000 && t <= stop;
          return (
            <button
              key={e.time + e.label}
              type="button"
              disabled={!jumpable}
              onClick={() => clock.setTime(Math.max(start, t))}
              title={jumpable ? "Go to this moment" : "Outside the path Lune shows"}
              style={{ display: "grid", gridTemplateColumns: "14px 1fr", gap: 6, padding: "4px 4px", border: "none", borderRadius: 4, background: "transparent", color: past ? TEXT : MUTED, fontFamily: "inherit", fontSize: 10, textAlign: "left", cursor: jumpable ? "pointer" : "default" }}
            >
              <span aria-hidden style={{ color: past ? MISSION_COLOR : MUTED }}>{KIND_ICON[e.kind] ?? "·"}</span>
              <span>
                <span style={{ display: "block" }}>{e.label}</span>
                <span style={{ color: MUTED }}>{e.time.endsWith("T00:00:00Z") ? formatDate(t) : formatDateTime(t)}</span>
              </span>
            </button>
          );
        })}
      </div>
      <p style={{ ...hintStyle, fontSize: 10, marginTop: 10 }}>
        Path: NASA JPL Horizons (heliocentric, ecliptic J2000). Planets: astronomy-engine. Spacecraft and planets are drawn bigger than life when far away.
      </p>
    </div>
  );
}
