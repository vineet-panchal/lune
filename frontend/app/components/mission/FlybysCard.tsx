import { relativeTime, type Feed, type Flyby } from "../../lib/missionControl";
import Card, { HAIRLINE, linkStyle, MUTED, SECONDARY, Skeleton, TEXT } from "./Card";

const SHOWN = 6;

function size(f: Flyby): string {
  const fmt = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`);
  return `${fmt(f.diameterMinM)}–${fmt(f.diameterMaxM)}`;
}

/** Asteroids passing within ~20 lunar distances in the coming weeks. */
export default function FlybysCard({ feed, nowMs }: { feed: Feed<Flyby[]> | null; nowMs: number | null }) {
  const upcoming = feed?.data && nowMs ? feed.data.filter((f) => Date.parse(f.time) > nowMs) : null;
  const closest = upcoming?.length ? upcoming.reduce((a, b) => (b.distanceKm < a.distanceKm ? b : a)) : null;
  return (
    <Card title="Asteroid flybys" subtitle="NASA/JPL close-approach data" updatedAt={feed?.updatedAt} loading={feed?.loading ?? true} error={feed?.error}>
      {!upcoming || !nowMs ? (
        <Skeleton rows={4} />
      ) : upcoming.length === 0 ? (
        <div style={{ color: MUTED }}>No close approaches in the next two months.</div>
      ) : (
        <>
          {closest && (
            <div style={{ fontSize: 11, color: SECONDARY, marginBottom: 8, lineHeight: 1.5 }}>
              Closest: <b style={{ color: TEXT }}>{closest.designation}</b> at {closest.lunarDistances.toFixed(2)} lunar distances (
              {Math.round(closest.distanceKm).toLocaleString()} km), {relativeTime(Date.parse(closest.time), nowMs)}.
            </div>
          )}
          {upcoming.slice(0, SHOWN).map((f) => (
            <div key={`${f.designation}-${f.time}`} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, padding: "7px 0", borderTop: `1px solid ${HAIRLINE}` }}>
              <span style={{ minWidth: 0 }}>
                <a
                  href={`https://ssd.jpl.nasa.gov/tools/sbdb_lookup.html#/?sstr=${encodeURIComponent(f.designation)}`}
                  target="_blank"
                  rel="noreferrer"
                  style={{ ...linkStyle, color: TEXT, fontWeight: 600 }}
                >
                  {f.designation}
                </a>
                <span style={{ display: "block", fontSize: 10, color: MUTED }}>
                  ~{size(f)} wide · {f.speedKmS.toFixed(1)} km/s
                </span>
              </span>
              <span style={{ textAlign: "right" }}>
                <span style={{ display: "block", color: TEXT }}>{f.lunarDistances.toFixed(2)} LD</span>
                <span style={{ display: "block", fontSize: 10, color: MUTED }}>{relativeTime(Date.parse(f.time), nowMs)}</span>
              </span>
            </div>
          ))}
          <div style={{ fontSize: 9, color: MUTED, marginTop: 6 }}>LD = lunar distance, 384,400 km. Sizes are estimated from brightness.</div>
        </>
      )}
    </Card>
  );
}
