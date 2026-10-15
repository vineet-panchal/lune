import { useMemo, useState } from "react";
import { relativeTime, type Feed, type Launch, type NewsArticle } from "../../lib/missionControl";
import Card, { chipStyle, HAIRLINE, MUTED, SECONDARY, Skeleton, TEXT } from "./Card";

/** Topic filters: an article matches if its title or summary mentions any of the words. */
const TOPICS: { id: string; label: string; words: RegExp | null }[] = [
  { id: "all", label: "All", words: null },
  { id: "launches", label: "Launches", words: /\b(launch|lift-?off|falcon|starship|rocket|booster)/i },
  { id: "stations", label: "Stations & crew", words: /\b(iss|space station|tiangong|astronaut|cosmonaut|taikonaut|crew|spacewalk)/i },
  { id: "moon", label: "Moon & beyond", words: /\b(moon|lunar|artemis|mars|jupiter|saturn|asteroid|comet|venus|mercury)/i },
  { id: "satellites", label: "Satellites", words: /\b(satellite|starlink|constellation|kuiper|oneweb|orbit)/i },
  { id: "science", label: "Science", words: /\b(telescope|webb|hubble|galax|nebula|exoplanet|black hole|sun|solar|science)/i },
];

const PAGE = 12;

type Props = {
  feed: Feed<NewsArticle[]> | null;
  /** Every launch Mission Control knows, by Launch Library id, to name the launch an article is about. */
  launchesById: Map<string, Launch>;
  nowMs: number | null;
};

export default function NewsFeedCard({ feed, launchesById, nowMs }: Props) {
  const [topic, setTopic] = useState("all");
  const [shown, setShown] = useState(PAGE);
  const articles = useMemo(() => {
    const words = TOPICS.find((t) => t.id === topic)?.words;
    const all = feed?.data ?? [];
    return words ? all.filter((a) => words.test(`${a.title} ${a.summary ?? ""}`) || (topic === "launches" && a.launchIds.length > 0)) : all;
  }, [feed, topic]);

  return (
    <Card title="Space news" subtitle="Spaceflight News API" updatedAt={feed?.updatedAt} loading={feed?.loading ?? true} error={feed?.error}>
      <div role="tablist" aria-label="Topics" style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
        {TOPICS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={topic === t.id}
            onClick={() => {
              setTopic(t.id);
              setShown(PAGE);
            }}
            style={chipStyle(topic === t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {!feed?.data ? (
        <div style={{ marginTop: 12 }}>
          <Skeleton rows={6} />
        </div>
      ) : articles.length === 0 ? (
        <div style={{ color: MUTED, marginTop: 12 }}>No recent articles on this topic.</div>
      ) : (
        <>
          {articles.slice(0, shown).map((a) => {
            const about = a.launchIds.map((id) => launchesById.get(id)).find(Boolean);
            return (
              <a
                key={a.id}
                href={a.url}
                target="_blank"
                rel="noreferrer"
                style={{ display: "grid", gridTemplateColumns: a.imageUrl ? "96px 1fr" : "1fr", gap: 12, padding: "12px 0", borderTop: `1px solid ${HAIRLINE}`, color: TEXT, textDecoration: "none" }}
              >
                {a.imageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element -- images come from many news sites
                  <img
                    src={a.imageUrl}
                    alt=""
                    loading="lazy"
                    style={{ width: 96, height: 64, objectFit: "cover", borderRadius: 6, background: "rgba(255,255,255,0.04)" }}
                    onError={(e) => {
                      e.currentTarget.style.visibility = "hidden";
                    }}
                  />
                )}
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "block", fontWeight: 600, fontSize: 12, lineHeight: 1.35 }}>{a.title}</span>
                  <span style={{ display: "block", marginTop: 3, fontSize: 10, color: MUTED }}>
                    {a.site}
                    {nowMs ? ` · ${relativeTime(Date.parse(a.publishedAt), nowMs)}` : ""}
                    {about ? ` · about ${about.missionName ?? about.name}` : ""}
                  </span>
                  {a.summary && (
                    <span style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", marginTop: 4, fontSize: 11, color: SECONDARY, lineHeight: 1.45 }}>
                      {a.summary}
                    </span>
                  )}
                </span>
              </a>
            );
          })}
          {articles.length > shown && (
            <button type="button" onClick={() => setShown((n) => n + PAGE)} style={{ ...chipStyle(false), width: "100%", marginTop: 8, padding: 8 }}>
              Show more ({articles.length - shown})
            </button>
          )}
        </>
      )}
    </Card>
  );
}
