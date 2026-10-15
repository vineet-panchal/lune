"use client";

import { useMemo } from "react";
import {
  useFeed,
  usePolled,
  type CatalogPulse,
  type Expedition,
  type Flyby,
  type Launch,
  type LaunchObjects,
  type NewsArticle,
  type SpaceWeather,
} from "../lib/missionControl";
import { useLayoutMode } from "../lib/useLayoutMode";
import Navbar from "./layout/Navbar";
import { FONT, MUTED, SECONDARY, useNow } from "./mission/Card";
import CatalogPulseCard from "./mission/CatalogPulseCard";
import FlybysCard from "./mission/FlybysCard";
import InSpaceCard from "./mission/InSpaceCard";
import { LaunchListCard, NextLaunchCard } from "./mission/Launches";
import NewsFeedCard from "./mission/NewsFeed";
import SpaceWeatherCard from "./mission/SpaceWeatherCard";

/**
 * How often each card asks the backend again. The backend caches every feed and refreshes it on its own
 * schedule, so these only decide how soon a fresh download shows up here.
 */
const MINUTE = 60_000;

/**
 * Mission Control: a dashboard for everything happening in space now. Outside feeds (news, launches, crew, space
 * weather, asteroid flybys) sit beside what Lune's own catalog shows, and launches and satellites link into the
 * Satellite Tracker.
 */
export default function MissionControlView() {
  const layout = useLayoutMode();
  const nowMs = useNow(1000);

  const news = useFeed<NewsArticle[]>("/api/mission/news", 5 * MINUTE).value;
  const upcoming = useFeed<Launch[]>("/api/mission/launches/upcoming", 5 * MINUTE).value;
  const recent = useFeed<Launch[]>("/api/mission/launches/recent", 10 * MINUTE).value;
  const crew = useFeed<Expedition[]>("/api/mission/crew", 30 * MINUTE).value;
  const flybys = useFeed<Flyby[]>("/api/mission/flybys", 30 * MINUTE).value;
  const weather = usePolled<SpaceWeather>("/api/mission/space-weather", 5 * MINUTE, (w) => w.kp.loading && w.kp.data === null).value;
  const pulse = usePolled<CatalogPulse>("/api/mission/catalog", 10 * MINUTE, (p) => p.loading).value;

  // Launch Library launches by id (for news articles) and by designator (for the catalog's satellites).
  const { launchesById, launchesByDesignator } = useMemo(() => {
    const byId = new Map<string, Launch>();
    const byDesignator = new Map<string, Launch>();
    for (const l of [...(upcoming?.data ?? []), ...(recent?.data ?? [])]) {
      byId.set(l.id, l);
      if (l.designator) byDesignator.set(l.designator, l);
    }
    return { launchesById: byId, launchesByDesignator: byDesignator };
  }, [upcoming, recent]);
  const objectsByLaunch = useMemo(() => new Map<string, LaunchObjects>((pulse?.launches ?? []).map((l) => [l.designator, l])), [pulse]);

  const isPhone = layout.mode === "phone";
  const columns = layout.mode === "desktop" ? "minmax(0, 1.65fr) minmax(0, 1fr)" : layout.mode === "tablet" ? "minmax(0, 1.3fr) minmax(0, 1fr)" : "minmax(0, 1fr)";

  const nextLaunch = <NextLaunchCard feed={upcoming} nowMs={nowMs} />;
  const launches = <LaunchListCard upcoming={upcoming} recent={recent} objectsByLaunch={objectsByLaunch} nowMs={nowMs} />;
  const newsCard = <NewsFeedCard feed={news} launchesById={launchesById} nowMs={nowMs} />;
  const weatherCard = <SpaceWeatherCard weather={weather} nowMs={nowMs} />;
  const crewCard = <InSpaceCard feed={crew} />;
  const catalogCard = <CatalogPulseCard pulse={pulse} launchesByDesignator={launchesByDesignator} nowMs={nowMs} />;
  const flybysCard = <FlybysCard feed={flybys} nowMs={nowMs} />;

  return (
    // The app's body never scrolls (the globe pages fill the screen), so this page scrolls itself.
    <div
      style={{
        position: "fixed",
        inset: 0,
        overflowY: "auto",
        overscrollBehavior: "contain",
        background:
          "radial-gradient(1200px 600px at 75% -10%, rgba(40,60,120,0.35), transparent 60%), radial-gradient(900px 500px at -10% 30%, rgba(90,40,120,0.18), transparent 60%), #03040a",
        fontFamily: FONT,
      }}
    >
      <Navbar current="mission-control" compact={layout.compactNav} status={isPhone ? <span>Mission Control</span> : undefined} />
      <main style={{ maxWidth: 1360, margin: "0 auto", padding: isPhone ? "64px 12px 32px" : "76px 20px 40px", boxSizing: "border-box" }}>
        <header style={{ display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap", marginBottom: 16 }}>
          <h1 style={{ margin: 0, fontSize: isPhone ? 20 : 24, letterSpacing: 3, color: "#fff", fontWeight: 700 }}>MISSION CONTROL</h1>
          <span style={{ fontSize: 11, color: SECONDARY }}>Everything happening in space, right now</span>
          {nowMs && (
            <span style={{ marginLeft: "auto", fontSize: 12, color: MUTED, fontVariantNumeric: "tabular-nums" }}>
              {new Date(nowMs).toISOString().slice(11, 19)} UTC
            </span>
          )}
        </header>

        {isPhone ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {nextLaunch}
            {weatherCard}
            {launches}
            {newsCard}
            {crewCard}
            {catalogCard}
            {flybysCard}
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: columns, gap: 16, alignItems: "start" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
              {nextLaunch}
              {launches}
              {newsCard}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
              {weatherCard}
              {crewCard}
              {catalogCard}
              {flybysCard}
            </div>
          </div>
        )}

        <footer style={{ marginTop: 24, fontSize: 10, color: MUTED, lineHeight: 1.6 }}>
          Sources: Spaceflight News API, Launch Library 2 (The Space Devs), NOAA SWPC, NASA/JPL SBDB, CelesTrak. Lune
          caches each feed and refreshes it on the source&apos;s own schedule.
        </footer>
      </main>
    </div>
  );
}
