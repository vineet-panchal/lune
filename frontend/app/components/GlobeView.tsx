"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { fetchSatellites } from "../lib/api";
import * as satellite from "satellite.js";
import { feature } from "topojson-client";
import type { Topology } from "topojson-specification";

type Sat = {
  satelliteId: number;
  name: string;
  latitude: number;
  longitude: number;
  altitudeKm: number;
  type?: string;
};

/** A satellite with its parsed satrec for client-side SGP4 propagation */
type SatTle = {
  satelliteId: number;
  name: string;
  satrec: satellite.SatRec;
};

type GlobeInstance = {
  width: (w: number) => GlobeInstance;
  height: (h: number) => GlobeInstance;
  backgroundColor: (c: string) => GlobeInstance;
  backgroundImageUrl: (url: string) => GlobeInstance;
  globeImageUrl: (url: string) => GlobeInstance;
  showAtmosphere: (v: boolean) => GlobeInstance;
  atmosphereAltitude: (v: number) => GlobeInstance;
  atmosphereColor: (c: string) => GlobeInstance;
  showGraticules: (v: boolean) => GlobeInstance;
  pointsData: (d: any[]) => GlobeInstance;
  pointLat: (a: any) => GlobeInstance;
  pointLng: (a: any) => GlobeInstance;
  pointAltitude: (a: any) => GlobeInstance;
  pointColor: (a: any) => GlobeInstance;
  pointRadius: (a: any) => GlobeInstance;
  pointLabel: (a: any) => GlobeInstance;
  onPointClick: (fn: (point: any, event: MouseEvent, coords: any) => void) => GlobeInstance;
  pointOfView: (pov: { lat: number; lng: number; altitude: number }, ms?: number) => GlobeInstance;
  pathsData: (d: any[]) => GlobeInstance;
  pathPoints: (a: any) => GlobeInstance;
  pathPointLat: (a: any) => GlobeInstance;
  pathPointLng: (a: any) => GlobeInstance;
  pathPointAlt: (a: any) => GlobeInstance;
  pathColor: (a: any) => GlobeInstance;
  pathStroke: (a: any) => GlobeInstance;
  pathDashLength: (a: any) => GlobeInstance;
  pathDashGap: (a: any) => GlobeInstance;
  pathTransitionDuration: (a: any) => GlobeInstance;
  polygonsData: (d: any[]) => GlobeInstance;
  polygonCapColor: (a: any) => GlobeInstance;
  polygonSideColor: (a: any) => GlobeInstance;
  polygonStrokeColor: (a: any) => GlobeInstance;
  polygonAltitude: (a: any) => GlobeInstance;
};

const EARTH_RADIUS_KM = 6371;

/** Altitude bands (km) and their assigned colours */
const ALTITUDE_BANDS: { name: string; range: string; min: number; max: number; color: string }[] = [
  { name: "Very Low Earth Orbit (VLEO)", range: "0–400 km",           min: 0,      max: 400,      color: "#00e5ff" },
  { name: "Low Earth Orbit (LEO)",       range: "400–1,000 km",       min: 400,    max: 1000,     color: "#76ff03" },
  { name: "Medium Earth Orbit (MEO)",    range: "1,000–2,000 km",     min: 1000,   max: 2000,     color: "#ffeb3b" },
  { name: "High Earth Orbit (HEO)",      range: "2,000–35,786 km",    min: 2000,   max: 35786,    color: "#ff9800" },
  { name: "Geostationary (GEO)",         range: "35,786–35,888 km",   min: 35786,  max: 35888,    color: "#f44336" },
  { name: "Beyond GEO",                  range: "35,888–100,000 km",  min: 35888,  max: Infinity, color: "#e040fb" },
];

function altitudeToColor(altKm: number): string {
  for (const band of ALTITUDE_BANDS) {
    if (altKm < band.max) return band.color;
  }
  return ALTITUDE_BANDS[ALTITUDE_BANDS.length - 1].color;
}

/** Propagate a satrec to geodetic lat/lng/alt at a given Date using satellite.js */
function propagateToGeodetic(satrec: satellite.SatRec, date: Date): { lat: number; lng: number; alt: number } | null {
  const posVel = satellite.propagate(satrec, date);
  if (!posVel || !posVel.position || typeof posVel.position === "boolean") return null;
  const gmst = satellite.gstime(date);
  const geo = satellite.eciToGeodetic(posVel.position, gmst);
  return {
    lat: satellite.degreesLat(geo.latitude),
    lng: satellite.degreesLong(geo.longitude),
    alt: geo.height, // km above Earth surface
  };
}

type SelectedSat = {
  satelliteId: number;
  name: string;
  color: string;
  altitudeKm: number;
};

type OrbitPath = {
  satelliteId: number;
  color: string;
  points: { lat: number; lng: number; alt: number }[];
};

function generateStarfieldDataUrl(
  width = 2048,
  height = 1024,
  stars = 2500
) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";

  // Background gradient
  const g = ctx.createLinearGradient(0, 0, 0, height);
  g.addColorStop(0, "#050510");
  g.addColorStop(1, "#000005");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, width, height);

  // Stars – smaller and denser for a more realistic look
  for (let i = 0; i < stars; i++) {
    const x = Math.random() * width;
    const y = Math.random() * height;
    const r = Math.random() < 0.96 ? Math.random() * 0.45 : 0.45 + Math.random() * 0.55;
    const a = 0.25 + Math.random() * 0.75;
    const tint = Math.random();
    const color =
      tint < 0.6
        ? `rgba(255,255,255,${a})`
        : tint < 0.8
        ? `rgba(180,200,255,${a})`
        : `rgba(255,220,180,${a})`;
    ctx.beginPath();
    ctx.fillStyle = color;
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  return canvas.toDataURL("image/png");
}

export default function GlobeView() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const globeRef = useRef<GlobeInstance | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [satellites, setSatellites] = useState<Sat[]>([]);
  const [satType, setSatType] = useState<string>("Popular");
  const [satCompany, setSatCompany] = useState<string>("All");
  const [satCount, setSatCount] = useState(0);
  const [selectedSats, setSelectedSats] = useState<SelectedSat[]>([]);
  const [orbitPaths, setOrbitPaths] = useState<OrbitPath[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [dataSource, setDataSource] = useState<string | null>(null);
  const selectedSatsRef = useRef<SelectedSat[]>([]);
  const orbitPathsRef = useRef<OrbitPath[]>([]);
  const satTlesRef = useRef<SatTle[]>([]);

  const [activePanel, setActivePanel] = useState<"search" | "filter">("filter");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchSuggestions, setSearchSuggestions] = useState<any[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchPropTimerRef = useRef<number | null>(null);
  const searchJustSelectedRef = useRef(false);

  const MAX_SELECTED = 10;

  const SAT_TYPES = [
    "Popular",
    "Internet",
    "Communications",
    "Stations",
    "Geostationary",
    "Positioning",
    "Earth Imaging",
    "Weather",
    "Science",
    "IoT",
  ];

  // Maps display label → backend params (type = CelesTrak group name, group = curated list)
  const SAT_TYPE_OPTS: Record<string, { type?: string; group?: string }> = {
    "Internet":      { type: "STARLINK" },
    "Popular":       { group: "popular" },
    "Stations":      { type: "STATIONS" },
    "Starlink":      { type: "STARLINK" },
    "OneWeb":        { type: "ONEWEB" },
    "Positioning":   { type: "GPS-OPS" },
    "GLONASS":       { type: "GLO-OPS" },
    "Galileo":       { type: "GALILEO" },
    "BeiDou":        { type: "BEIDOU" },
    "Communications":{ type: "INTELSAT" },
    "Geostationary": { type: "GEO" },
    "Weather":       { type: "NOAA" },
    "Earth Imaging": { type: "RESOURCE" },
    "Amateur":       { type: "AMATEUR" },
  };

  const SAT_TYPE_DESCRIPTIONS: Record<string, string> = {
    "Popular":        "Viewing the most well-known satellites and space objects, including the International Space Station.",
    "Internet":       "Viewing internet satellite constellations providing global broadband coverage.",
    "Communications": "Viewing communications satellites used for TV, radio, and data relay.",
    "Stations":       "Viewing crewed space stations currently orbiting Earth.",
    "Geostationary":  "Viewing satellites in geostationary orbit, fixed above one point on the equator.",
    "Positioning":    "Viewing navigation satellites from multiple global positioning systems.",
    "Earth Imaging":  "Viewing Earth observation satellites capturing imagery of our planet.",
    "Weather":        "Viewing weather satellites monitoring atmospheric and climate conditions.",
    "Science":        "Viewing scientific research satellites studying Earth and space.",
    "IoT":            "Viewing satellites supporting Internet-of-Things device connectivity.",
  };

  const COMPANY_OPTIONS: Record<string, string[]> = {
    "Popular":        ["All"],
    "Internet":       ["All", "Starlink", "LEO (Kuiper)", "OneWeb", "Qianfan", "Guowang", "GalaxySpace", "E-Space"],
    "Communications": ["All", "Iridium NEXT", "GlobalStar", "Bluewalker", "Lynk"],
    "Stations":       ["All"],
    "Geostationary":  ["All"],
    "Positioning":    ["All", "GPS", "Galileo", "GLONASS", "BeiDou"],
    "Earth Imaging":  ["All", "Planet", "Jilin-1", "Satelog"],
    "Weather":        ["All", "Spire"],
    "Science":        ["All", "Swarm"],
    "IoT":            ["All", "Orbcomm", "Geespace", "Tianqi"],
  };

  const COMPANY_API_OPTS: Record<string, { type?: string; group?: string; search?: string }> = {
    "Starlink":       { type: "STARLINK" },
    "LEO (Kuiper)":   { search: "KUIPER" },
    "OneWeb":         { type: "ONEWEB" },
    "Qianfan":        { search: "QIANFAN" },
    "Guowang":        { search: "GUOWANG" },
    "GalaxySpace":    { search: "GALAXYSPACE" },
    "E-Space":        { search: "E-SPACE" },
    "Iridium NEXT":   { type: "IRIDIUM-NEXT" },
    "GlobalStar":     { type: "GLOBALSTAR" },
    "Bluewalker":     { search: "BLUEWALKER" },
    "Lynk":           { search: "LYNK" },
    "GPS":            { type: "GPS-OPS" },
    "Galileo":        { type: "GALILEO" },
    "GLONASS":        { type: "GLO-OPS" },
    "BeiDou":         { type: "BEIDOU" },
    "Planet":         { search: "PLANET" },
    "Jilin-1":        { search: "JILIN" },
    "Satelog":        { search: "SATELOG" },
    "Spire":          { search: "SPIRE" },
    "Swarm":          { search: "SWARM" },
    "Orbcomm":        { type: "ORBCOMM" },
    "Geespace":       { search: "GEESPACE" },
    "Tianqi":         { search: "TIANQI" },
  };

  const COMPANY_DESCRIPTIONS: Record<string, string> = {
    "All":            "Viewing all satellites in this category.",
    "Starlink":       "SpaceX's Starlink constellation providing global broadband internet.",
    "LEO (Kuiper)":   "Amazon's Project Kuiper low Earth orbit broadband constellation.",
    "OneWeb":         "OneWeb's LEO constellation for global internet connectivity.",
    "Qianfan":        "China's Qianfan (Thousand Sails) broadband mega-constellation.",
    "Guowang":        "China's Guowang (SatNet) broadband satellite constellation.",
    "GalaxySpace":    "GalaxySpace's LEO broadband internet constellation.",
    "E-Space":        "E-Space's sustainable LEO communications constellation.",
    "Iridium NEXT":   "Iridium's next-generation global satellite communications network.",
    "GlobalStar":     "Globalstar's LEO satellite constellation for voice and data.",
    "Bluewalker":     "AST SpaceMobile's Bluewalker direct-to-cell satellite network.",
    "Lynk":           "Lynk Global's cell-tower-in-space satellite network.",
    "GPS":            "U.S. Global Positioning System navigation satellites.",
    "Galileo":        "European Union's Galileo global navigation satellite system.",
    "GLONASS":        "Russia's GLONASS global navigation satellite system.",
    "BeiDou":         "China's BeiDou navigation satellite system.",
    "Planet":         "Planet Labs' Earth observation satellite constellation.",
    "Jilin-1":        "China's Jilin-1 commercial Earth observation satellites.",
    "Satelog":        "Satelog Earth observation and remote sensing satellites.",
    "Spire":          "Spire Global's weather and maritime tracking satellite constellation.",
    "Swarm":          "Swarm Technologies' low-cost IoT and scientific data satellites.",
    "Orbcomm":        "Orbcomm's machine-to-machine IoT satellite communication network.",
    "Geespace":       "Geely's Geespace LEO satellite constellation for autonomous driving.",
    "Tianqi":         "China's Tianqi IoT narrow-band satellite constellation.",
  };

  useEffect(() => {
    const init = async () => {
      if (!containerRef.current) return;

      const GlobeCtor = (await import("globe.gl")).default as unknown as new (
        el: HTMLElement
      ) => GlobeInstance;

      const starBg = generateStarfieldDataUrl(2048, 1024, 4000);
      const globe = new GlobeCtor(containerRef.current)
        .backgroundColor("#000011")
        .backgroundImageUrl(starBg)
        .globeImageUrl("//unpkg.com/three-globe/example/img/earth-night.jpg")
        .showAtmosphere(true)
        .atmosphereAltitude(0.15)
        .atmosphereColor("rgba(100, 160, 255, 0.5)")
        .showGraticules(true)
        .pointLat("latitude")
        .pointLng("longitude")
        .pointAltitude(0)
        .pointColor((d: any) => d.color)
        .pointRadius(0.12)
        .pointLabel((d: any) => `${d.name} — ${Math.round(d.altitudeKm ?? 0)} km`)
        .onPointClick((point: any) => {
          if (!point?.satelliteId) return;
          const alreadySelected = selectedSatsRef.current.some(
            (s) => s.satelliteId === point.satelliteId
          );
          if (alreadySelected) {
            // Deselect
            const nextSelected = selectedSatsRef.current.filter(
              (s) => s.satelliteId !== point.satelliteId
            );
            const nextPaths = orbitPathsRef.current.filter(
              (p) => p.satelliteId !== point.satelliteId
            );
            selectedSatsRef.current = nextSelected;
            orbitPathsRef.current = nextPaths;
            setSelectedSats(nextSelected);
            setOrbitPaths(nextPaths);
            return;
          }
          // Enforce max selection limit
          if (selectedSatsRef.current.length >= MAX_SELECTED) {
            setErrorMsg(`Maximum of ${MAX_SELECTED} satellites can be selected.`);
            setTimeout(() => setErrorMsg(null), 3000);
            return;
          }
          // Select – compute orbit trail client-side using SGP4
          const sat: SelectedSat = {
            satelliteId: point.satelliteId,
            name: point.name,
            color: point.color,
            altitudeKm: point.altitudeKm ?? 0,
          };
          const nextSelected = [...selectedSatsRef.current, sat];
          selectedSatsRef.current = nextSelected;
          setSelectedSats(nextSelected);

          // Find this satellite's satrec and propagate a full orbit trail (~90 min)
          const satTle = satTlesRef.current.find((s) => s.satelliteId === point.satelliteId);
          if (satTle) {
            const now = new Date();
            const TRAIL_MINUTES = 90;
            const STEP_SECONDS = 30;
            const pts: { lat: number; lng: number; alt: number }[] = [];
            for (let offset = -TRAIL_MINUTES * 60; offset <= TRAIL_MINUTES * 60; offset += STEP_SECONDS) {
              const t = new Date(now.getTime() + offset * 1000);
              const geo = propagateToGeodetic(satTle.satrec, t);
              if (geo) pts.push(geo);
            }
            const path: OrbitPath = {
              satelliteId: point.satelliteId,
              color: point.color,
              points: pts,
            };
            const nextPaths = [...orbitPathsRef.current, path];
            orbitPathsRef.current = nextPaths;
            setOrbitPaths(nextPaths);
          }
        })
        .pointsData([])
        .pathPoints("points")
        .pathPointLat((p: any) => p.lat)
        .pathPointLng((p: any) => p.lng)
        .pathPointAlt((p: any) => Math.max(0, p.alt / EARTH_RADIUS_KM))
        .pathColor((d: any) => d.color)
        .pathStroke(1.5)
        .pathDashLength(0.01)
        .pathDashGap(0.004)
        .pathTransitionDuration(0)
        .pathsData([]);

      // Load country borders
      fetch("https://unpkg.com/world-atlas@2/countries-110m.json")
        .then((r) => r.json())
        .then((worldData: Topology) => {
          const countries = feature(worldData, worldData.objects.countries as any);
          globe
            .polygonsData((countries as any).features)
            .polygonCapColor(() => "rgba(0, 0, 0, 0)")
            .polygonSideColor(() => "rgba(0, 0, 0, 0)")
            .polygonStrokeColor(() => "rgba(140, 180, 255, 0.35)")
            .polygonAltitude(() => 0.005);
        })
        .catch((e) => console.warn("Failed to load country borders", e));

      globe.pointOfView({ lat: 20, lng: 0, altitude: 2.2 }, 0);

      globeRef.current = globe;

      const resize = () => {
        const el = containerRef.current;
        if (!el || !globeRef.current) return;
        globeRef.current.width(el.clientWidth).height(el.clientHeight);
      };
      resize();
      window.addEventListener("resize", resize);

      return () => window.removeEventListener("resize", resize);
    };

    init();

    return () => {};
  }, []);

  // Fetch satellite TLEs once, then propagate positions client-side every second.
  // No position API calls needed — all orbital math happens in the browser.
  useEffect(() => {
    let aborted = false;
    let propagateTimer: number | null = null;
    setSatellites([]);
    setSatCount(0);
    setDataSource(null);
    satTlesRef.current = [];
    selectedSatsRef.current = [];
    orbitPathsRef.current = [];
    setSelectedSats([]);
    setOrbitPaths([]);

    // Clean up any search propagation timer
    if (searchPropTimerRef.current) {
      clearTimeout(searchPropTimerRef.current);
      searchPropTimerRef.current = null;
    }

    // In search mode, clear the globe and don't fetch by type
    if (activePanel === "search") {
      setLoading(false);
      if (globeRef.current) globeRef.current.pointsData([]);
      return () => { aborted = true; };
    }

    setLoading(true);
    const opts = satCompany !== "All"
      ? (COMPANY_API_OPTS[satCompany] ?? { search: satCompany })
      : (SAT_TYPE_OPTS[satType] ?? { search: satType });
    const PAGE_SIZE = 100;

    /** Propagate all loaded TLEs to current time and update the globe */
    function propagateAll(tles: SatTle[]) {
      const now = new Date();
      const sats: Sat[] = [];
      for (let i = 0; i < tles.length; i++) {
        const s = tles[i];
        const geo = propagateToGeodetic(s.satrec, now);
        if (geo) {
          sats.push({
            satelliteId: s.satelliteId,
            name: s.name,
            latitude: geo.lat,
            longitude: geo.lng,
            altitudeKm: geo.alt,
          });
        }
      }
      const points = sats.map((s) => ({
        ...s,
        color: altitudeToColor(s.altitudeKm ?? 0),
      }));
      if (!aborted) {
        setSatellites(sats);
        setLastUpdated(now.toLocaleTimeString());
        if (globeRef.current) globeRef.current.pointsData(points);
      }
    }

    async function fetchTles() {
      let allTles: SatTle[] = [];
      let page = 1;
      let totalItems = Infinity;

      while (allTles.length < totalItems && !aborted) {
        const resp = await fetchSatellites(page, PAGE_SIZE, opts);
        if (aborted) return;
        const pageTles: SatTle[] = (resp.satellites ?? [])
          .filter((x: any) => x?.satelliteId && x?.line1 && x?.line2)
          .map((x: any) => {
            const satrec = satellite.twoline2satrec(x.line1, x.line2);
            return { satelliteId: x.satelliteId, name: x.name ?? String(x.satelliteId), satrec };
          })
          .filter((s: SatTle) => s.satrec);
        allTles = [...allTles, ...pageTles];
        satTlesRef.current = allTles;
        totalItems = resp.totalItems ?? allTles.length;
        setSatCount(totalItems);
        if (resp.dataSource) setDataSource(resp.dataSource);

        // Propagate and render immediately after each page so dots appear progressively
        propagateAll(allTles);
        setLoading(false);

        if ((resp.satellites ?? []).length < PAGE_SIZE) break;
        page++;
      }

      // Start 1-second propagation loop — pure math, no network calls
      if (!aborted && allTles.length > 0) {
        const tick = () => {
          propagateAll(satTlesRef.current);
          if (!aborted) propagateTimer = window.setTimeout(tick, 1000);
        };
        propagateTimer = window.setTimeout(tick, 1000);
      }
    }

    fetchTles().catch((e) => console.error("Failed to load satellites", e));
    return () => {
      aborted = true;
      if (propagateTimer) window.clearTimeout(propagateTimer);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [satType, satCompany, activePanel]);

  // Search autocomplete — debounced API call
  useEffect(() => {
    if (activePanel !== "search" || searchQuery.trim().length < 2) {
      setSearchSuggestions([]);
      return;
    }
    if (searchJustSelectedRef.current) {
      searchJustSelectedRef.current = false;
      return;
    }
    const timer = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const resp = await fetchSatellites(1, 20, { search: searchQuery.trim() });
        const sats = (resp.satellites ?? []).filter((s: any) => s?.satelliteId && s?.line1 && s?.line2);
        setSearchSuggestions(sats);
      } catch (e) {
        console.error("Search failed", e);
        setSearchSuggestions([]);
      }
      setSearchLoading(false);
    }, 300);
    return () => clearTimeout(timer);
  }, [activePanel, searchQuery]);

  // Cleanup search propagation on unmount
  useEffect(() => {
    return () => {
      if (searchPropTimerRef.current) clearTimeout(searchPropTimerRef.current);
    };
  }, []);

  // Sync orbit paths to globe
  useEffect(() => {
    if (!globeRef.current) return;
    globeRef.current.pathsData(orbitPaths);
  }, [orbitPaths]);

  const removeSat = useCallback((id: number) => {
    const nextSelected = selectedSatsRef.current.filter((s) => s.satelliteId !== id);
    const nextPaths = orbitPathsRef.current.filter((p) => p.satelliteId !== id);
    selectedSatsRef.current = nextSelected;
    orbitPathsRef.current = nextPaths;
    setSelectedSats(nextSelected);
    setOrbitPaths(nextPaths);
  }, []);

  const clearAll = useCallback(() => {
    selectedSatsRef.current = [];
    orbitPathsRef.current = [];
    setSelectedSats([]);
    setOrbitPaths([]);
  }, []);

  const handleSearchSelect = useCallback((sat: any) => {
    const satrec = satellite.twoline2satrec(sat.line1, sat.line2);
    if (!satrec) return;
    satTlesRef.current = [{ satelliteId: sat.satelliteId, name: sat.name, satrec }];
    setSatCount(1);
    searchJustSelectedRef.current = true;
    setSearchQuery(sat.name);
    setSearchSuggestions([]);

    // Clear any existing search propagation timer
    if (searchPropTimerRef.current) {
      clearTimeout(searchPropTimerRef.current);
      searchPropTimerRef.current = null;
    }

    // Start propagation loop for the selected satellite
    const tick = () => {
      const tles = satTlesRef.current;
      if (tles.length === 0) return;
      const now = new Date();
      const sats: Sat[] = [];
      for (const s of tles) {
        const geo = propagateToGeodetic(s.satrec, now);
        if (geo) sats.push({ satelliteId: s.satelliteId, name: s.name, latitude: geo.lat, longitude: geo.lng, altitudeKm: geo.alt });
      }
      const points = sats.map(s => ({ ...s, color: altitudeToColor(s.altitudeKm) }));
      setSatellites(sats);
      setLastUpdated(now.toLocaleTimeString());
      if (globeRef.current) globeRef.current.pointsData(points);
      searchPropTimerRef.current = window.setTimeout(tick, 1000);
    };
    tick();
  }, []);

  return (
    <div style={{ position: "relative", width: "100vw", height: "100vh" }}>
      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
      <div
        style={{
          position: "absolute",
          top: 12,
          left: 12,
          padding: "10px 12px",
          borderRadius: 10,
          background: "rgba(0,0,0,0.55)",
          border: "1px solid rgba(255,255,255,0.12)",
          color: "white",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
          fontSize: 12,
          lineHeight: 1.4,
          maxWidth: 360,
        }}
      >
        <div style={{ fontWeight: 700, marginBottom: 10 }}>Lune Globe</div>

        {/* Search A Satellite dropdown */}
        <div style={{ marginBottom: 4 }}>
          <div
            onClick={() => {
              if (activePanel !== "search") {
                setActivePanel("search");
                setSearchQuery("");
                setSearchSuggestions([]);
              }
            }}
            style={{
              cursor: "pointer",
              padding: "6px 8px",
              borderRadius: 6,
              background: activePanel === "search" ? "rgba(255,255,255,0.1)" : "transparent",
              border: "1px solid rgba(255,255,255,0.15)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              userSelect: "none",
            }}
          >
            <span style={{ fontWeight: 600 }}>Search A Satellite</span>
            <span style={{ fontSize: 10, opacity: 0.6 }}>{activePanel === "search" ? "▾" : "▸"}</span>
          </div>
          {activePanel === "search" && (
            <div style={{ padding: "8px 4px 4px" }}>
              <div style={{ marginBottom: 6, color: "rgba(255,255,255,0.6)", fontStyle: "italic", fontSize: 11 }}>
                Search for a satellite, given their name
              </div>
              <div style={{ position: "relative" }}>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="e.g. INTELSAT, ISS..."
                  style={{
                    width: "100%",
                    padding: "6px 8px",
                    borderRadius: 6,
                    border: "1px solid rgba(255,255,255,0.2)",
                    background: "#181818",
                    color: "#fff",
                    fontSize: 12,
                    fontFamily: "inherit",
                    outline: "none",
                    boxSizing: "border-box",
                  }}
                />
                {searchLoading && (
                  <div style={{ marginTop: 4, color: "#4fc3f7", fontSize: 11 }}>Searching...</div>
                )}
                {searchSuggestions.length > 0 && (
                  <div
                    style={{
                      marginTop: 4,
                      maxHeight: 180,
                      overflowY: "auto",
                      borderRadius: 6,
                      border: "1px solid rgba(255,255,255,0.15)",
                      background: "rgba(20,20,30,0.95)",
                    }}
                  >
                    {searchSuggestions.map((s: any) => (
                      <div
                        key={s.satelliteId}
                        onClick={() => handleSearchSelect(s)}
                        style={{
                          padding: "5px 8px",
                          cursor: "pointer",
                          fontSize: 11,
                          borderBottom: "1px solid rgba(255,255,255,0.06)",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                        onMouseEnter={(e) => {
                          (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.1)";
                        }}
                        onMouseLeave={(e) => {
                          (e.currentTarget as HTMLElement).style.background = "transparent";
                        }}
                      >
                        {s.name}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Filter By Type dropdown */}
        <div style={{ marginBottom: 8 }}>
          <div
            onClick={() => {
              if (activePanel !== "filter") {
                setActivePanel("filter");
              }
            }}
            style={{
              cursor: "pointer",
              padding: "6px 8px",
              borderRadius: 6,
              background: activePanel === "filter" ? "rgba(255,255,255,0.1)" : "transparent",
              border: "1px solid rgba(255,255,255,0.15)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              userSelect: "none",
            }}
          >
            <span style={{ fontWeight: 600 }}>Filter By Type</span>
            <span style={{ fontSize: 10, opacity: 0.6 }}>{activePanel === "filter" ? "▾" : "▸"}</span>
          </div>
          {activePanel === "filter" && (
            <div style={{ padding: "8px 4px 4px" }}>
              <div style={{ marginBottom: 6 }}>
                <label htmlFor="sat-type-select" style={{ marginRight: 8 }}>Type:</label>
                <select
                  id="sat-type-select"
                  value={satType}
                  onChange={e => { setSatType(e.target.value); setSatCompany("All"); }}
                  style={{ fontSize: 13, padding: "2px 8px", borderRadius: 6, background: "#222", color: "#fff" }}
                >
                  {SAT_TYPES.map(type => (
                    <option key={type} value={type}>{type}</option>
                  ))}
                </select>
              </div>
              {SAT_TYPE_DESCRIPTIONS[satType] && (
                <div style={{ marginBottom: 4, color: "rgba(255,255,255,0.6)", fontStyle: "italic", lineHeight: 1.4, fontSize: 11 }}>
                  {SAT_TYPE_DESCRIPTIONS[satType]}
                </div>
              )}
              <div style={{ marginTop: 8, marginBottom: 6 }}>
                <label htmlFor="sat-company-select" style={{ marginRight: 8 }}>Company:</label>
                <select
                  id="sat-company-select"
                  value={satCompany}
                  onChange={e => setSatCompany(e.target.value)}
                  style={{ fontSize: 13, padding: "2px 8px", borderRadius: 6, background: "#222", color: "#fff" }}
                >
                  {(COMPANY_OPTIONS[satType] ?? ["All"]).map(company => (
                    <option key={company} value={company}>{company}</option>
                  ))}
                </select>
              </div>
              {COMPANY_DESCRIPTIONS[satCompany] && (
                <div style={{ marginBottom: 4, color: "rgba(255,255,255,0.6)", fontStyle: "italic", lineHeight: 1.4, fontSize: 11 }}>
                  {COMPANY_DESCRIPTIONS[satCompany]}
                </div>
              )}
            </div>
          )}
        </div>

        <div>Satellites: {satellites.length}{satCount > 0 && satellites.length < satCount ? ` / ${satCount}` : ""}</div>
        <div>Update: {lastUpdated ?? "--"}</div>
        {dataSource && (
          <div style={{ marginTop: 2, fontSize: 11, color: dataSource === "celestrak" ? "#66bb6a" : "#ffa726" }}>
            Source: {dataSource === "celestrak" ? "CelesTrak" : "TLE API"}{dataSource !== "celestrak" ? " (fallback)" : ""}
          </div>
        )}
        {loading && (
          <div style={{ marginTop: 6, color: "#4fc3f7" }}>
            Loading satellite TLEs...
          </div>
        )}
        <div style={{ marginTop: 6, color: "rgba(255,255,255,0.75)" }}>
          Tip: click a satellite dot to show its orbit path.
        </div>
      </div>

      {/* Navbar */}
      <div
        style={{
          position: "absolute",
          top: 12,
          left: "50%",
          transform: "translateX(-50%)",
          padding: "8px 20px",
          borderRadius: 10,
          background: "rgba(0,0,0,0.55)",
          border: "1px solid rgba(255,255,255,0.12)",
          color: "white",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
          fontSize: 13,
          display: "flex",
          alignItems: "center",
          gap: 24,
          zIndex: 10,
          whiteSpace: "nowrap",
        }}
      >
        <span style={{ fontWeight: 700, fontSize: 15, letterSpacing: 2 }}>LUNE</span>
        <div
          style={{
            width: 1,
            height: 18,
            background: "rgba(255,255,255,0.2)",
          }}
        />
        <div style={{ display: "flex", gap: 6 }}>
          <button
            style={{
              background: "rgba(255,255,255,0.12)",
              border: "1px solid rgba(255,255,255,0.25)",
              color: "#fff",
              padding: "4px 12px",
              borderRadius: 6,
              fontSize: 12,
              cursor: "default",
              fontFamily: "inherit",
            }}
          >
            Satellite Tracker
          </button>
          {["Constellations", "News", "Trips"].map((label) => (
            <button
              key={label}
              disabled
              style={{
                background: "transparent",
                border: "1px solid rgba(255,255,255,0.08)",
                color: "rgba(255,255,255,0.3)",
                padding: "4px 12px",
                borderRadius: 6,
                fontSize: 12,
                cursor: "not-allowed",
                fontFamily: "inherit",
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Selected satellites side panel */}
      {selectedSats.length > 0 && (
        <div
          style={{
            position: "absolute",
            top: 12,
            right: 12,
            padding: "10px 14px",
            borderRadius: 10,
            background: "rgba(0,0,0,0.65)",
            border: "1px solid rgba(255,255,255,0.12)",
            color: "white",
            fontFamily:
              "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
            fontSize: 12,
            lineHeight: 1.6,
            minWidth: 200,
            maxWidth: 280,
            maxHeight: "50vh",
            overflowY: "auto",
          }}
        >
          {selectedSats.map((s) => (
            <div
              key={s.satelliteId}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "4px 0",
                borderBottom: "1px solid rgba(255,255,255,0.08)",
              }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: 6, flex: 1, minWidth: 0 }}>
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: s.color,
                    flexShrink: 0,
                  }}
                />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {s.name}
                </span>
              </span>
              <button
                onClick={() => removeSat(s.satelliteId)}
                style={{
                  background: "none",
                  border: "none",
                  color: "rgba(255,255,255,0.5)",
                  cursor: "pointer",
                  fontSize: 14,
                  padding: "0 4px",
                  marginLeft: 8,
                  flexShrink: 0,
                }}
                title="Remove"
              >
                ×
              </button>
            </div>
          ))}
          <div
            style={{
              marginTop: 6,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              fontSize: 11,
            }}
          >
            <span style={{ color: "rgba(255,255,255,0.3)" }}>max {MAX_SELECTED}</span>
            <span
              style={{
                color: "rgba(255,255,255,0.4)",
                cursor: "pointer",
              }}
              onClick={clearAll}
            >
              clear all
            </span>
          </div>
        </div>
      )}

      {/* Altitude legend – bottom right */}
      <div
        style={{
          position: "absolute",
          bottom: 16,
          right: 16,
          padding: "14px 16px",
          borderRadius: 12,
          background: "rgba(10,10,14,0.82)",
          border: "1px solid rgba(255,255,255,0.10)",
          color: "white",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
          fontSize: 11,
          zIndex: 10,
          minWidth: 210,
        }}
      >
        <div style={{ fontWeight: 700, fontSize: 13, textAlign: "center", marginBottom: 10, letterSpacing: 0.3 }}>
          Orbital Altitude
        </div>
        <div style={{ borderTop: "1px solid rgba(255,255,255,0.10)", margin: "0 -16px 10px", padding: 0 }} />
        {ALTITUDE_BANDS.map((band) => (
          <div key={band.name} style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 8 }}>
            <span
              style={{
                width: 14,
                height: 14,
                borderRadius: 3,
                background: band.color,
                flexShrink: 0,
                marginTop: 1,
              }}
            />
            <div style={{ lineHeight: 1.35 }}>
              <div style={{ fontWeight: 600, fontSize: 11 }}>{band.name}</div>
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.5)" }}>{band.range}</div>
            </div>
          </div>
        ))}
        <div style={{ borderTop: "1px solid rgba(255,255,255,0.10)", margin: "6px -16px 8px", padding: 0 }} />
        <div style={{ fontSize: 10, color: "rgba(255,255,255,0.6)", marginBottom: 4, fontWeight: 600 }}>
          Distribution ({satellites.length}{satCount > 0 && satellites.length < satCount ? `/${satCount}` : ""} satellites)
        </div>
        {(() => {
          const counts: Record<string, number> = {};
          for (const band of ALTITUDE_BANDS) counts[band.name] = 0;
          for (const s of satellites) {
            for (const band of ALTITUDE_BANDS) {
              if (s.altitudeKm < band.max) { counts[band.name]++; break; }
            }
          }
          const total = satellites.length || 1;
          return ALTITUDE_BANDS.filter((band) => counts[band.name] > 0).map((band) => (
            <div key={band.name} style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "rgba(255,255,255,0.5)", lineHeight: 1.7 }}>
              <span>{band.name.replace(/ \(.*\)/, "")}</span>
              <span style={{ marginLeft: 12, whiteSpace: "nowrap" }}>{counts[band.name]} ({(counts[band.name] / total * 100).toFixed(1)}%)</span>
            </div>
          ));
        })()}
      </div>

      {/* Error toast – bottom left */}
      {errorMsg && (
        <div
          style={{
            position: "absolute",
            bottom: 20,
            left: 20,
            padding: "10px 16px",
            borderRadius: 8,
            background: "rgba(180, 40, 40, 0.9)",
            border: "1px solid rgba(255,100,100,0.4)",
            color: "#fff",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
            fontSize: 12,
            zIndex: 20,
            pointerEvents: "none",
          }}
        >
          {errorMsg}
        </div>
      )}
    </div>
  );
}

