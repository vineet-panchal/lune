import { relativeTime, trackerLink, type CatalogPulse, type Launch, type Manoeuvre } from "../../lib/missionControl";
import Card, { HAIRLINE, linkStyle, MUTED, SECONDARY, Skeleton, STATUS, TEXT } from "./Card";

const MANOEUVRE_LABELS: Record<Manoeuvre["type"], { label: string; color: string }> = {
  raise: { label: "Raised", color: "#69f0ae" },
  lower: { label: "Lowered", color: "#ffd54f" },
  plane_change: { label: "Plane change", color: "#ba68c8" },
};

const NEWEST_LAUNCHES = 5;
const MANOEUVRES_SHOWN = 6;

type Props = {
  pulse: CatalogPulse | null;
  /** Launch Library launches by designator, to name the catalog's newest launches. */
  launchesByDesignator: Map<string, Launch>;
  nowMs: number | null;
};

function SubTitle({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.2, textTransform: "uppercase", color: MUTED, margin: "14px 0 6px" }}>{children}</div>;
}

/** What Lune itself sees in the active-satellite catalog: re-entries, manoeuvres and the newest launches. */
export default function CatalogPulseCard({ pulse, launchesByDesignator, nowMs }: Props) {
  const firstLoad = !pulse || (pulse.loading && pulse.tracked === 0);
  return (
    <Card
      title="Lune's catalog"
      subtitle="Detected by Lune from CelesTrak TLEs"
      updatedAt={pulse?.catalogUpdatedAt}
      loading={pulse?.loading ?? true}
    >
      {firstLoad ? (
        <>
          <div style={{ fontSize: 11, color: SECONDARY, marginBottom: 10 }}>Downloading the active-satellite catalog…</div>
          <Skeleton rows={4} />
        </>
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={{ fontSize: 30, fontWeight: 700, color: "#fff" }}>{pulse.tracked.toLocaleString()}</span>
            <span style={{ color: SECONDARY }}>active satellites tracked</span>
          </div>

          <SubTitle>Newest in orbit</SubTitle>
          {pulse.launches.slice(0, NEWEST_LAUNCHES).map((l) => {
            const launch = launchesByDesignator.get(l.designator);
            const name = launch ? launch.missionName ?? launch.name : l.names.join(", ");
            return (
              <div key={l.designator} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, padding: "5px 0", borderTop: `1px solid ${HAIRLINE}` }}>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "block", color: TEXT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
                  <span style={{ display: "block", fontSize: 10, color: MUTED }}>
                    {l.designator} · {l.count} satellite{l.count === 1 ? "" : "s"}
                    {launch && nowMs ? ` · launched ${relativeTime(Date.parse(launch.net), nowMs)}` : ""}
                  </span>
                </span>
                <a href={trackerLink({ ids: l.ids, label: `${name} (${l.designator})` })} style={{ ...linkStyle, fontSize: 11, alignSelf: "center" }}>
                  Track →
                </a>
              </div>
            );
          })}

          <SubTitle>Re-entering soon</SubTitle>
          {pulse.reentries.length === 0 ? (
            <div style={{ fontSize: 11, color: MUTED }}>{historyNote(pulse, "No decaying satellites detected yet.")}</div>
          ) : (
            pulse.reentries.map((r) => (
              <div key={r.satelliteId} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, padding: "5px 0", borderTop: `1px solid ${HAIRLINE}` }}>
                <span style={{ minWidth: 0 }}>
                  <a href={trackerLink({ ids: [r.satelliteId], select: [r.satelliteId], label: r.name })} style={{ ...linkStyle, color: TEXT }}>
                    {r.name}
                  </a>
                  <span style={{ display: "block", fontSize: 10, color: MUTED }}>
                    {Math.round(r.latestAltitudeKm)} km
                    {r.altitudeRateKmPerDay !== null ? `, falling ${Math.abs(r.altitudeRateKmPerDay).toFixed(1)} km/day` : ""}
                  </span>
                </span>
                <span style={{ alignSelf: "center", fontSize: 11, color: (r.daysToReentry ?? 99) < 14 ? STATUS.serious : SECONDARY }} title="Straight-line estimate; decay speeds up as it drops, so it's likely sooner">
                  ≤ {Math.max(1, Math.round(r.daysToReentry ?? 0))} d
                </span>
              </div>
            ))
          )}

          <SubTitle>Manoeuvres this week</SubTitle>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 11, color: SECONDARY, marginBottom: 4 }}>
            {(Object.keys(MANOEUVRE_LABELS) as Manoeuvre["type"][]).map((k) => (
              <span key={k} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: MANOEUVRE_LABELS[k].color }} />
                {MANOEUVRE_LABELS[k].label} <b style={{ color: TEXT }}>{(pulse.manoeuvreCounts[k] ?? 0).toLocaleString()}</b>
              </span>
            ))}
          </div>
          {pulse.manoeuvres.length === 0 ? (
            <div style={{ fontSize: 11, color: MUTED }}>{historyNote(pulse, "No manoeuvres detected in the last week.")}</div>
          ) : (
            pulse.manoeuvres.slice(0, MANOEUVRES_SHOWN).map((m) => (
              <div key={`${m.satelliteId}-${m.at}`} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, padding: "4px 0", borderTop: `1px solid ${HAIRLINE}`, fontSize: 11 }}>
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  <span style={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: MANOEUVRE_LABELS[m.type].color, marginRight: 6 }} />
                  <a href={trackerLink({ ids: [m.satelliteId], select: [m.satelliteId], label: m.name })} style={{ ...linkStyle, color: TEXT }}>
                    {m.name}
                  </a>
                </span>
                <span style={{ color: MUTED, whiteSpace: "nowrap" }}>
                  {m.type === "plane_change" ? `${m.deltaInclinationDeg > 0 ? "+" : ""}${m.deltaInclinationDeg.toFixed(2)}°` : `${m.deltaAltitudeKm > 0 ? "+" : ""}${m.deltaAltitudeKm.toFixed(1)} km`}
                  {nowMs ? ` · ${relativeTime(Date.parse(m.at), nowMs)}` : ""}
                </span>
              </div>
            ))
          )}
        </>
      )}
    </Card>
  );
}

/** Changes need at least two stored TLEs per satellite; say so while history is still short. */
function historyNote(pulse: CatalogPulse, otherwise: string): string {
  if (!pulse.historySince || pulse.withHistory < pulse.tracked / 2) {
    return "Lune records each satellite's TLEs as they refresh; changes show up once it has a few days of history.";
  }
  return otherwise;
}
