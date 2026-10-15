import { useEffect, useMemo, useState } from "react";
import { compassPoint, type Observer } from "../../../lib/passes";
import type { SimClock } from "../../../lib/simClock";
import { CONSTELLATION_INFO, ZODIAC } from "../../../lib/sky/constellationInfo";
import { brightestStars, figureCenter, starLabel, type SkyData } from "../../../lib/sky/skyData";
import {
  MONTHS,
  bestDuringDark,
  bestEveningMonth,
  darkSteps,
  equatorialToHorizontal,
  localSiderealRad,
  visibilityFrom,
  visibleLatitudes,
} from "../../../lib/sky/skyMath";
import { MUTED, TEXT, buttonStyle, chipStyle, hintStyle, linkStyle } from "../analytics/ui";
import { panelStyle, type SkyView } from "./SkyPanel";

type Filter = "all" | "zodiac" | "up" | "tonight";

type ConstellationExplorerProps = {
  data: SkyData | null;
  selected: number | null;
  onSelect: (index: number | null) => void;
  /** Turn the camera to it on the celestial sphere. */
  onFlyTo: (index: number) => void;
  onShowInSky: (index: number) => void;
  view: SkyView;
  observer: Observer | null;
  clock: SimClock;
};

/** "Up now" and "tonight" refresh this often (the sky turns 1° every 4 minutes). */
const REFRESH_MS = 10_000;
/** Lower than this is lost in haze and buildings. */
const UP_MIN_ALT_DEG = 10;
const TONIGHT_MIN_ALT_DEG = 20;
const TONIGHT_BUCKET_MS = 15 * 60_000;

/** The 88 constellations: search, filter by what's up now or tonight, and a card for the selected one. */
export default function ConstellationExplorer({ data, selected, onSelect, onFlyTo, onShowInSky, view, observer, clock }: ConstellationExplorerProps) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const nowMs = useClockMs(clock, REFRESH_MS);

  // Dark moments over the next day (shared by every constellation), recomputed every 15 simulated minutes.
  const bucket = Math.floor(nowMs / TONIGHT_BUCKET_MS) * TONIGHT_BUCKET_MS;
  const steps = useMemo(() => (observer ? darkSteps(observer, bucket) : null), [observer, bucket]);

  const centers = useMemo(() => data?.constellations.map(figureCenter) ?? [], [data]);
  const rows = useMemo(() => {
    if (!data) return [];
    const lst = observer ? localSiderealRad(nowMs, observer.lngDeg) : 0;
    return data.constellations.map((c, index) => {
      const [ra, dec] = centers[index];
      const now = observer ? equatorialToHorizontal(ra, dec, observer.latDeg, lst) : null;
      const tonight = observer && steps ? bestDuringDark(ra, dec, observer.latDeg, steps) : null;
      return { c, index, info: CONSTELLATION_INFO[c.id], month: bestEveningMonth(ra), now, tonight };
    });
  }, [data, centers, observer, nowMs, steps]);

  const needle = query.trim().toLowerCase();
  const listed = rows
    .filter((r) => {
      if (needle && !`${r.c.name} ${r.c.id} ${r.info?.meaning ?? ""}`.toLowerCase().includes(needle)) return false;
      if (filter === "zodiac") return ZODIAC.has(r.c.id);
      if (filter === "up") return (r.now?.altDeg ?? -90) >= UP_MIN_ALT_DEG;
      if (filter === "tonight") return (r.tonight?.altDeg ?? -90) >= TONIGHT_MIN_ALT_DEG;
      return true;
    })
    .sort((a, b) => {
      if (filter === "up") return (b.now?.altDeg ?? 0) - (a.now?.altDeg ?? 0);
      if (filter === "tonight") return (b.tonight?.altDeg ?? 0) - (a.tonight?.altDeg ?? 0);
      return a.c.name.localeCompare(b.c.name);
    });
  const selectedRow = selected === null ? null : rows[selected] ?? null;

  return (
    <div style={{ ...panelStyle, width: 320, display: "flex", flexDirection: "column", minHeight: 0, maxHeight: "100%" }}>
      <div style={{ fontWeight: 700, marginBottom: 8 }}>Constellations</div>
      {!data ? (
        <p style={hintStyle}>Loading the star catalogue…</p>
      ) : (
        <>
          {selectedRow && (
            <SelectedCard
              data={data}
              row={selectedRow}
              observer={observer}
              view={view}
              onClose={() => onSelect(null)}
              onFlyTo={() => onFlyTo(selectedRow.index)}
              onShowInSky={() => onShowInSky(selectedRow.index)}
            />
          )}
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search: Orion, Great Bear, Sco…"
            aria-label="Search constellations"
            style={{
              width: "100%",
              padding: "6px 8px",
              borderRadius: 6,
              border: "1px solid rgba(255,255,255,0.2)",
              background: "#181818",
              color: "#fff",
              fontSize: 12,
              fontFamily: "inherit",
              boxSizing: "border-box",
              marginBottom: 8,
            }}
          />
          <div role="tablist" aria-label="Filter" style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 6 }}>
            {(
              [
                ["all", "All 88"],
                ["zodiac", "Zodiac"],
                ["up", "Up now"],
                ["tonight", "Tonight"],
              ] as const
            ).map(([id, label]) => (
              <button key={id} type="button" role="tab" aria-selected={filter === id} onClick={() => setFilter(id)} style={{ ...chipStyle(filter === id), padding: "3px 8px", fontSize: 10 }}>
                {label}
              </button>
            ))}
          </div>
          {(filter === "up" || filter === "tonight") && !observer && (
            <p style={{ ...hintStyle, marginBottom: 6 }}>Set your location in the Night Sky panel to see what&apos;s above you.</p>
          )}
          {filter === "tonight" && observer && steps?.length === 0 && (
            <p style={{ ...hintStyle, marginBottom: 6 }}>It doesn&apos;t get dark where you are in the next 24 hours.</p>
          )}
          <div style={{ fontSize: 10, color: MUTED, marginBottom: 4 }}>
            {listed.length} constellation{listed.length === 1 ? "" : "s"}
            {filter === "up" ? ` more than ${UP_MIN_ALT_DEG}° up now` : filter === "tonight" ? " well placed after dark, highest first" : ""}
          </div>
          <div style={{ overflowY: "auto", minHeight: 80, flex: "1 1 auto", marginRight: -6, paddingRight: 6 }}>
            {listed.map((r) => (
              <button
                key={r.c.id}
                type="button"
                onClick={() => {
                  onSelect(r.index);
                  if (view === "sphere") onFlyTo(r.index);
                }}
                aria-pressed={selected === r.index}
                style={{
                  display: "flex",
                  width: "100%",
                  alignItems: "baseline",
                  gap: 8,
                  padding: "5px 6px",
                  border: "none",
                  borderRadius: 6,
                  background: selected === r.index ? "rgba(86,132,214,0.3)" : "transparent",
                  color: TEXT,
                  textAlign: "left",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  fontSize: 11,
                }}
              >
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {r.c.name} <span style={{ color: MUTED, fontSize: 10 }}>{r.info?.meaning}</span>
                </span>
                <span style={{ color: MUTED, fontSize: 10, whiteSpace: "nowrap" }}>{rowStatus(r, filter)}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

type Row = {
  c: SkyData["constellations"][number];
  index: number;
  info: (typeof CONSTELLATION_INFO)[string] | undefined;
  month: number;
  now: { altDeg: number; azDeg: number } | null;
  tonight: { altDeg: number; azDeg: number; ms: number } | null;
};

function rowStatus(r: Row, filter: Filter): string {
  if (filter === "tonight" && r.tonight) return `${formatClock(r.tonight.ms)} · ${Math.round(r.tonight.altDeg)}°`;
  if (r.now && r.now.altDeg >= 0) return `${Math.round(r.now.altDeg)}° ${compassPoint(r.now.azDeg)}`;
  return MONTHS[r.month].slice(0, 3);
}

function SelectedCard({
  data,
  row,
  observer,
  view,
  onClose,
  onFlyTo,
  onShowInSky,
}: {
  data: SkyData;
  row: Row;
  observer: Observer | null;
  view: SkyView;
  onClose: () => void;
  onFlyTo: () => void;
  onShowInSky: () => void;
}) {
  const { c, info, month, now, tonight } = row;
  const brightest = useMemo(() => brightestStars(data, row.index, 4), [data, row.index]);
  const visibility = observer ? visibilityFrom(c, observer.latDeg) : null;
  const facts: [string, string][] = [
    ["Best seen", `${MONTHS[month]} evenings`],
    ["Fully visible", `from ${visibleLatitudes(c)}`],
  ];
  if (observer && visibility) {
    facts.push([
      "From you",
      visibility === "never" ? "never rises" : visibility === "partial" ? "only partly rises" : "rises fully",
    ]);
    if (now) facts.push(["Right now", now.altDeg >= 0 ? `${Math.round(now.altDeg)}° up, ${compassPoint(now.azDeg)}` : "below the horizon"]);
    if (tonight && tonight.altDeg > 0) facts.push(["Tonight", `highest ${Math.round(tonight.altDeg)}° around ${formatClock(tonight.ms)} (${compassPoint(tonight.azDeg)})`]);
  }
  return (
    <div
      style={{
        padding: 10,
        borderRadius: 8,
        background: "rgba(86,132,214,0.12)",
        border: "1px solid rgba(123,164,232,0.35)",
        marginBottom: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        <span style={{ fontWeight: 700, fontSize: 13, color: "#e8f0ff" }}>{c.name}</span>
        <span style={{ color: MUTED, fontSize: 10 }}>{c.id}{ZODIAC.has(c.id) ? " · zodiac" : ""}</span>
        <button type="button" onClick={onClose} aria-label="Close" style={{ ...linkStyle, marginLeft: "auto", fontSize: 14, color: MUTED }}>
          ×
        </button>
      </div>
      {info && (
        <>
          <div style={{ color: "#a9c4f5", fontSize: 11, marginBottom: 4 }}>{capitalise(info.meaning)}</div>
          <p style={{ ...hintStyle, marginBottom: 8 }}>{info.description}</p>
        </>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", columnGap: 10, rowGap: 2, fontSize: 10, marginBottom: 8 }}>
        {facts.map(([k, v]) => (
          <div key={k} style={{ display: "contents" }}>
            <span style={{ color: MUTED }}>{k}</span>
            <span style={{ color: TEXT }}>{v}</span>
          </div>
        ))}
        {brightest.length > 0 && (
          <>
            <span style={{ color: MUTED }}>Brightest</span>
            <span style={{ color: TEXT }}>
              {brightest.map((i) => `${starLabel(data, i)} (${data.stars.mag[i].toFixed(1)})`).join(", ")}
            </span>
          </>
        )}
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <button type="button" onClick={onFlyTo} style={buttonStyle()} title="Turn the celestial sphere to it">
          {view === "sphere" ? "Centre on it" : "Show on sphere"}
        </button>
        <button
          type="button"
          onClick={onShowInSky}
          disabled={!observer}
          style={buttonStyle(Boolean(observer))}
          title={observer ? "Find it in your sky" : "Set your location first"}
        >
          {view === "sky" ? "Highlighted in My sky" : "Find in My sky"}
        </button>
      </div>
    </div>
  );
}

/** The clock's time, refreshed every `everyMs` and whenever the time controls change. */
function useClockMs(clock: SimClock, everyMs: number): number {
  const [ms, setMs] = useState(() => clock.nowMs());
  useEffect(() => {
    const update = () => setMs(clock.nowMs());
    const unsubscribe = clock.subscribe(update);
    const timer = window.setInterval(update, everyMs);
    return () => {
      unsubscribe();
      window.clearInterval(timer);
    };
  }, [clock, everyMs]);
  return ms;
}

function formatClock(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
