import { durationDays, flag, trackerLink, type Expedition, type Feed } from "../../lib/missionControl";
import Card, { HAIRLINE, linkStyle, MUTED, SECONDARY, Skeleton, TEXT } from "./Card";

/** Who is living in space right now, by station. */
export default function InSpaceCard({ feed }: { feed: Feed<Expedition[]> | null }) {
  const expeditions = feed?.data ?? null;
  const people = expeditions?.reduce((n, e) => n + e.crew.length, 0) ?? 0;
  return (
    <Card title="People in space" subtitle="Launch Library 2 · active expeditions" updatedAt={feed?.updatedAt} loading={feed?.loading ?? true} error={feed?.error}>
      {!expeditions ? (
        <Skeleton rows={4} />
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 6 }}>
            <span style={{ fontSize: 30, fontWeight: 700, color: "#fff" }}>{people}</span>
            <span style={{ color: SECONDARY }}>
              people on {expeditions.length} station{expeditions.length === 1 ? "" : "s"}
            </span>
          </div>
          {expeditions.map((e) => (
            <div key={e.name} style={{ borderTop: `1px solid ${HAIRLINE}`, padding: "10px 0 4px" }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 6 }}>
                <span style={{ fontWeight: 700 }}>{e.station}</span>
                <span style={{ fontSize: 10, color: MUTED }}>{e.name}</span>
                {e.stationNoradId !== null && (
                  <a href={trackerLink({ select: [e.stationNoradId] })} style={{ ...linkStyle, marginLeft: "auto", fontSize: 11 }}>
                    Track →
                  </a>
                )}
              </div>
              {e.crew.map((c) => {
                const days = durationDays(c.timeInSpace);
                return (
                  <div key={c.name} style={{ display: "grid", gridTemplateColumns: "26px 1fr auto", gap: 8, alignItems: "center", padding: "3px 0" }}>
                    {c.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element -- Launch Library's image host
                      <img src={c.imageUrl} alt="" loading="lazy" style={{ width: 26, height: 26, borderRadius: "50%", objectFit: "cover", background: "rgba(255,255,255,0.06)" }} />
                    ) : (
                      <span style={{ width: 26, height: 26, borderRadius: "50%", background: "rgba(255,255,255,0.06)" }} />
                    )}
                    <span style={{ minWidth: 0 }}>
                      <span style={{ display: "block", color: TEXT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {flag(c.countryCode)}{" "}
                        {c.wikiUrl ? (
                          <a href={c.wikiUrl} target="_blank" rel="noreferrer" style={{ color: TEXT, textDecoration: "none" }}>
                            {c.name}
                          </a>
                        ) : (
                          c.name
                        )}
                      </span>
                      <span style={{ display: "block", fontSize: 10, color: MUTED }}>
                        {c.role}
                        {c.agency ? ` · ${c.agency}` : ""}
                      </span>
                    </span>
                    {days !== null && (
                      <span style={{ fontSize: 10, color: MUTED, textAlign: "right" }} title="Total time in space over their career">
                        {Math.round(days)} d in space
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </>
      )}
    </Card>
  );
}
