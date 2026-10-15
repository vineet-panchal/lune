import { useState } from "react";
import { flag, hasFlown, relativeTime, trackerLink, type Feed, type Launch, type LaunchObjects } from "../../lib/missionControl";
import Card, { chipStyle, HAIRLINE, linkStyle, MUTED, SECONDARY, Skeleton, STATUS, StatusPill, TEXT } from "./Card";

/** Launch Library status → pill colour and a plain description. */
const STATUS_STYLE: Record<string, { color: string; label: string }> = {
  Go: { color: STATUS.good, label: "Go for launch" },
  TBC: { color: STATUS.warning, label: "To be confirmed" },
  TBD: { color: "#78909c", label: "Date not set" },
  Hold: { color: STATUS.serious, label: "On hold" },
  "In Flight": { color: "#4fc3f7", label: "In flight" },
  Success: { color: STATUS.good, label: "Success" },
  Failure: { color: STATUS.critical, label: "Failure" },
  "Partial Failure": { color: STATUS.serious, label: "Partial failure" },
};

function LaunchStatus({ launch }: { launch: Launch }) {
  const s = STATUS_STYLE[launch.status ?? ""] ?? { color: "#78909c", label: launch.status ?? "Unknown" };
  return (
    <StatusPill color={s.color} title={launch.statusName ?? undefined}>
      {s.label}
    </StatusPill>
  );
}

/** "Oct 20, 14:32" (to the minute), "Oct 20" (day), "October" (month)... as precisely as the date is known. */
function formatNet(launch: Launch): string {
  const d = new Date(launch.net);
  switch (launch.netPrecision) {
    case "SEC":
    case "MIN":
      return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    case "HR":
      return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit" });
    case "DAY":
      return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    case "MONTH":
      return d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    default:
      return d.toLocaleDateString(undefined, { month: "short", year: "numeric" });
  }
}

/** Only a date known to the day or better is worth a countdown ("in 15 d" for "sometime in October" misleads). */
function dayOrBetter(launch: Launch): boolean {
  return ["SEC", "MIN", "HR", "DAY"].includes(launch.netPrecision ?? "");
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

/** T-minus (or T-plus) as days, hours, minutes, seconds. */
function countdown(netMs: number, nowMs: number): { sign: string; parts: [string, string][] } {
  const diff = netMs - nowMs;
  let s = Math.floor(Math.abs(diff) / 1000);
  const days = Math.floor(s / 86_400);
  s -= days * 86_400;
  const hours = Math.floor(s / 3600);
  s -= hours * 3600;
  const minutes = Math.floor(s / 60);
  return {
    sign: diff >= 0 ? "T−" : "T+",
    parts: [
      [String(days), "days"],
      [pad2(hours), "hrs"],
      [pad2(minutes), "min"],
      [pad2(s - minutes * 60), "sec"],
    ],
  };
}

/** The next launch that hasn't flown yet (or is flying now). */
export function nextLaunch(upcoming: Launch[] | null, nowMs: number): Launch | null {
  return upcoming?.find((l) => !hasFlown(l) && (l.status === "In Flight" || Date.parse(l.net) > nowMs - 3600_000)) ?? null;
}

export function NextLaunchCard({ feed, nowMs }: { feed: Feed<Launch[]> | null; nowMs: number | null }) {
  const launch = feed?.data && nowMs ? nextLaunch(feed.data, nowMs) : null;
  const firm = launch?.netPrecision === "MIN" || launch?.netPrecision === "SEC";
  const t = launch && nowMs ? countdown(Date.parse(launch.net), nowMs) : null;
  return (
    <Card
      title="Next launch"
      subtitle="Launch Library 2"
      updatedAt={feed?.updatedAt}
      loading={feed?.loading ?? true}
      error={feed?.error}
      style={{ position: "relative", overflow: "hidden", minHeight: 230 }}
    >
      {launch?.imageUrl && (
        <div
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage: `linear-gradient(90deg, rgba(10,13,22,0.97) 0%, rgba(10,13,22,0.88) 45%, rgba(10,13,22,0.45) 100%), url(${launch.imageUrl})`,
            backgroundSize: "cover",
            backgroundPosition: "center",
            zIndex: 0,
          }}
        />
      )}
      <div style={{ position: "relative", zIndex: 1 }}>
        {!launch ? (
          feed?.data ? <div style={{ color: MUTED }}>No upcoming launches listed.</div> : <Skeleton rows={4} />
        ) : (
          <>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
              <LaunchStatus launch={launch} />
              {launch.webcastLive && <StatusPill color={STATUS.critical}>Live now</StatusPill>}
              {launch.probability !== null && (
                <span style={{ fontSize: 10, color: SECONDARY }}>Weather {launch.probability}% go</span>
              )}
            </div>
            <div style={{ fontSize: 22, fontWeight: 700, color: "#fff", lineHeight: 1.2 }}>{launch.missionName ?? launch.name}</div>
            <div style={{ marginTop: 4, color: SECONDARY }}>
              {launch.rocket} · {launch.provider}
            </div>
            <div style={{ marginTop: 2, color: MUTED }}>
              {flag(launch.countryCode)} {launch.padName}
              {launch.location ? `, ${launch.location}` : ""}
            </div>

            {t && (
              <div style={{ display: "flex", alignItems: "flex-end", gap: 14, marginTop: 16 }} aria-label="Countdown">
                <span style={{ fontSize: 18, color: SECONDARY, paddingBottom: 14 }}>{t.sign}</span>
                {t.parts.map(([value, unit]) => (
                  <div key={unit} style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 34, fontWeight: 700, color: "#fff", fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>{value}</div>
                    <div style={{ fontSize: 9, color: MUTED, letterSpacing: 1.2, textTransform: "uppercase", marginTop: 4 }}>{unit}</div>
                  </div>
                ))}
              </div>
            )}
            <div style={{ marginTop: 10, fontSize: 11, color: SECONDARY }}>
              {firm ? "Lift-off" : "No earlier than"} {formatNet(launch)}
              {!firm && <span style={{ color: MUTED }}> · time not yet firm</span>}
            </div>

            {launch.missionDescription && (
              <p style={{ margin: "10px 0 0", maxWidth: 620, color: SECONDARY, lineHeight: 1.5, fontSize: 11, display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                {launch.missionDescription}
              </p>
            )}
            <div style={{ display: "flex", gap: 14, marginTop: 10, flexWrap: "wrap", fontSize: 11 }}>
              {launch.videoUrl && (
                <a href={launch.videoUrl} target="_blank" rel="noreferrer" style={linkStyle}>
                  Watch ↗
                </a>
              )}
              {launch.padLatitude !== null && launch.padLongitude !== null && (
                <a href={`https://www.google.com/maps?q=${launch.padLatitude},${launch.padLongitude}`} target="_blank" rel="noreferrer" style={linkStyle}>
                  Launch pad map ↗
                </a>
              )}
              {launch.orbit && <span style={{ color: MUTED }}>Orbit: {launch.orbit}</span>}
            </div>
          </>
        )}
      </div>
    </Card>
  );
}

type LaunchListProps = {
  upcoming: Feed<Launch[]> | null;
  recent: Feed<Launch[]> | null;
  /** Satellites in Lune's catalog by launch designator, to link flown launches to the tracker. */
  objectsByLaunch: Map<string, LaunchObjects>;
  nowMs: number | null;
};

export function LaunchListCard({ upcoming, recent, objectsByLaunch, nowMs }: LaunchListProps) {
  const [tab, setTab] = useState<"upcoming" | "recent">("upcoming");
  const [open, setOpen] = useState<string | null>(null);
  const feed = tab === "upcoming" ? upcoming : recent;
  const next = upcoming?.data && nowMs ? nextLaunch(upcoming.data, nowMs) : null;
  const launches = (feed?.data ?? []).filter((l) => (tab === "upcoming" ? !hasFlown(l) && l.id !== next?.id : true));

  return (
    <Card
      title="Launches"
      subtitle="Launch Library 2"
      updatedAt={feed?.updatedAt}
      loading={feed?.loading ?? true}
      error={feed?.error}
      action={
        <div role="tablist" style={{ display: "flex", gap: 4 }}>
          {(["upcoming", "recent"] as const).map((t) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)} style={chipStyle(tab === t)}>
              {t === "upcoming" ? "Upcoming" : "Recent"}
            </button>
          ))}
        </div>
      }
    >
      {!feed?.data ? (
        <Skeleton rows={5} />
      ) : launches.length === 0 ? (
        <div style={{ color: MUTED }}>Nothing listed.</div>
      ) : (
        <div>
          {launches.map((l) => {
            const objects = l.designator ? objectsByLaunch.get(l.designator) : undefined;
            const expanded = open === l.id;
            return (
              <div key={l.id} style={{ borderTop: `1px solid ${HAIRLINE}`, padding: "9px 0" }}>
                <button
                  type="button"
                  onClick={() => setOpen(expanded ? null : l.id)}
                  aria-expanded={expanded}
                  style={{ display: "grid", gridTemplateColumns: "118px 1fr auto", gap: 10, width: "100%", textAlign: "left", background: "none", border: "none", padding: 0, color: TEXT, font: "inherit", cursor: "pointer", alignItems: "start" }}
                >
                  <span style={{ fontSize: 11 }}>
                    <span style={{ display: "block", color: TEXT }}>{formatNet(l)}</span>
                    {nowMs && dayOrBetter(l) && <span style={{ display: "block", fontSize: 10, color: MUTED }}>{relativeTime(Date.parse(l.net), nowMs)}</span>}
                  </span>
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: "block", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.missionName ?? l.name}</span>
                    <span style={{ display: "block", fontSize: 10, color: MUTED, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {flag(l.countryCode)} {l.rocket} · {l.provider}
                    </span>
                  </span>
                  <LaunchStatus launch={l} />
                </button>
                {objects && (
                  <div style={{ marginTop: 6, marginLeft: 128, fontSize: 10, color: SECONDARY }}>
                    {objects.count} satellite{objects.count === 1 ? "" : "s"} from this launch in Lune&apos;s catalog ·{" "}
                    <a href={trackerLink({ ids: objects.ids, label: `${l.missionName ?? l.name} (${l.designator})` })} style={linkStyle}>
                      Track them →
                    </a>
                  </div>
                )}
                {expanded && (
                  <div style={{ marginTop: 8, marginLeft: 128, fontSize: 11, color: SECONDARY, lineHeight: 1.5 }}>
                    {l.missionDescription && <p style={{ margin: "0 0 6px" }}>{l.missionDescription}</p>}
                    {l.failReason && <p style={{ margin: "0 0 6px", color: "#ffd6d6" }}>{l.failReason}</p>}
                    <div style={{ color: MUTED }}>
                      {l.padName}
                      {l.location ? `, ${l.location}` : ""}
                      {l.orbit ? ` · ${l.orbit}` : ""}
                      {l.missionType ? ` · ${l.missionType}` : ""}
                    </div>
                    {l.videoUrl && (
                      <a href={l.videoUrl} target="_blank" rel="noreferrer" style={{ ...linkStyle, display: "inline-block", marginTop: 6 }}>
                        Video ↗
                      </a>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
