"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { fetchSatellites } from "../lib/api";
import * as satellite from "satellite.js";
import * as THREE from "three";
import { feature } from "topojson-client";
import type { Topology } from "topojson-specification";
import GlobeCanvas from "./globe/GlobeCanvas";
import Navbar from "./layout/Navbar";
import LuneGlobePanel from "./panels/LuneGlobePanel";
import OrbitalViewPanel from "./panels/OrbitalViewPanel";
import SelectedSatellitesPanel from "./panels/SelectedSatellitesPanel";
import VisualizationPanel from "./panels/VisualizationPanel";

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
  objectsData: (d: any[]) => GlobeInstance;
  objectLat: (a: any) => GlobeInstance;
  objectLng: (a: any) => GlobeInstance;
  objectAltitude: (a: any) => GlobeInstance;
  objectLabel: (a: any) => GlobeInstance;
  objectFacesSurface: (a: any) => GlobeInstance;
  objectThreeObject: (a: any) => GlobeInstance;
  onObjectClick: (fn: (obj: any, event: MouseEvent, coords: any) => void) => GlobeInstance;
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
const INTERACTION_IDLE_MS = 220;

function getPropagationIntervalMs(count: number): number {
  if (count >= 6000) return 5000;
  if (count >= 3500) return 3500;
  if (count >= 1800) return 2500;
  if (count >= 900) return 1500;
  return 1000;
}

function getUiUpdateIntervalMs(count: number): number {
  if (count >= 6000) return 5000;
  if (count >= 3500) return 3500;
  if (count >= 1800) return 2500;
  if (count >= 900) return 1500;
  return 1000;
}

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
  const isUserInteractingRef = useRef(false);
  const interactionIdleTimerRef = useRef<number | null>(null);
  const lastUiUpdateAtRef = useRef(0);

  // Visualization control state
  const [isDayMode, setIsDayMode] = useState(false);
  const [showAtmosphere, setShowAtmosphere] = useState(true);
  const [showGraticules, setShowGraticules] = useState(true);
  const [atmosphereAltitude, setAtmosphereAltitude] = useState(0.15);
  const [atmosphereColor, setAtmosphereColor] = useState("rgba(100, 160, 255, 0.5)");
  const [rotationSpeed, setRotationSpeed] = useState(1);

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
    "Internet":      { type: "INTERNET" },
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
        .objectLat("latitude")
        .objectLng("longitude")
        .objectAltitude((d: any) => Math.max(0, (d.altitudeKm ?? 0) / EARTH_RADIUS_KM))
        .objectFacesSurface(false)
        .objectThreeObject((d: any) =>
          new THREE.Mesh(
            new THREE.SphereGeometry(0.2, 8, 8),
            new THREE.MeshLambertMaterial({ color: d.color })
          )
        )
        .objectLabel((d: any) => `${d.name} — ${Math.round(d.altitudeKm ?? 0)} km`)
        .onObjectClick((point: any) => {
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
        .objectsData([])
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

      // Initialize auto-rotation
      const controls = (globe as any).controls?.();
      if (controls) {
        controls.autoRotate = true;
        controls.autoRotateSpeed = 2;
      }

      const interactionTarget = containerRef.current;
      const markInteraction = () => {
        isUserInteractingRef.current = true;
        if (interactionIdleTimerRef.current) {
          window.clearTimeout(interactionIdleTimerRef.current);
        }
        interactionIdleTimerRef.current = window.setTimeout(() => {
          isUserInteractingRef.current = false;
        }, INTERACTION_IDLE_MS);
      };

      const endInteractionSoon = () => {
        if (interactionIdleTimerRef.current) {
          window.clearTimeout(interactionIdleTimerRef.current);
        }
        interactionIdleTimerRef.current = window.setTimeout(() => {
          isUserInteractingRef.current = false;
        }, INTERACTION_IDLE_MS);
      };

      interactionTarget.addEventListener("pointerdown", markInteraction, { passive: true });
      interactionTarget.addEventListener("pointermove", markInteraction, { passive: true });
      interactionTarget.addEventListener("pointerup", endInteractionSoon, { passive: true });
      interactionTarget.addEventListener("pointercancel", endInteractionSoon, { passive: true });
      interactionTarget.addEventListener("wheel", markInteraction, { passive: true });
      interactionTarget.addEventListener("touchstart", markInteraction, { passive: true });
      interactionTarget.addEventListener("touchmove", markInteraction, { passive: true });
      interactionTarget.addEventListener("touchend", endInteractionSoon, { passive: true });

      const resize = () => {
        const el = containerRef.current;
        if (!el || !globeRef.current) return;
        globeRef.current.width(el.clientWidth).height(el.clientHeight);
      };
      resize();
      window.addEventListener("resize", resize);

      return () => {
        window.removeEventListener("resize", resize);
        interactionTarget.removeEventListener("pointerdown", markInteraction);
        interactionTarget.removeEventListener("pointermove", markInteraction);
        interactionTarget.removeEventListener("pointerup", endInteractionSoon);
        interactionTarget.removeEventListener("pointercancel", endInteractionSoon);
        interactionTarget.removeEventListener("wheel", markInteraction);
        interactionTarget.removeEventListener("touchstart", markInteraction);
        interactionTarget.removeEventListener("touchmove", markInteraction);
        interactionTarget.removeEventListener("touchend", endInteractionSoon);
        if (interactionIdleTimerRef.current) {
          window.clearTimeout(interactionIdleTimerRef.current);
          interactionIdleTimerRef.current = null;
        }
      };
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
    lastUiUpdateAtRef.current = 0;
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
      if (globeRef.current) globeRef.current.objectsData([]);
      return () => { aborted = true; };
    }

    setLoading(true);
    const opts = satCompany !== "All"
      ? (COMPANY_API_OPTS[satCompany] ?? { search: satCompany })
      : (SAT_TYPE_OPTS[satType] ?? { search: satType });
    const PAGE_SIZE = 100;

    /** Propagate all loaded TLEs to current time and update the globe */
    function propagateAll(tles: SatTle[], forceUiUpdate = false) {
      if (isUserInteractingRef.current && !forceUiUpdate) {
        return;
      }

      const now = new Date();
      const shouldUpdateUi =
        forceUiUpdate ||
        Date.now() - lastUiUpdateAtRef.current >= getUiUpdateIntervalMs(tles.length);

      const sats: Sat[] = [];
      const points: Array<Sat & { color: string }> = [];
      for (let i = 0; i < tles.length; i++) {
        const s = tles[i];
        const geo = propagateToGeodetic(s.satrec, now);
        if (geo) {
          const satPoint = {
            satelliteId: s.satelliteId,
            name: s.name,
            latitude: geo.lat,
            longitude: geo.lng,
            altitudeKm: geo.alt,
            color: altitudeToColor(geo.alt ?? 0),
          };
          points.push(satPoint);
          if (shouldUpdateUi) {
            sats.push({
              satelliteId: satPoint.satelliteId,
              name: satPoint.name,
              latitude: satPoint.latitude,
              longitude: satPoint.longitude,
              altitudeKm: satPoint.altitudeKm,
            });
          }
        }
      }

      if (!aborted) {
        if (shouldUpdateUi) {
          setSatellites(sats);
          setLastUpdated(now.toLocaleTimeString());
          lastUiUpdateAtRef.current = Date.now();
        }
        if (globeRef.current) globeRef.current.objectsData(points);
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

        // For large catalogs, avoid full propagation on every fetched page.
        propagateAll(allTles, true);
        setLoading(false);

        if ((resp.satellites ?? []).length === 0 || page * PAGE_SIZE >= totalItems) break;
        page++;
      }

      // Start 1-second propagation loop — pure math, no network calls
      if (!aborted && allTles.length > 0) {
        const tick = () => {
          const currentTles = satTlesRef.current;
          propagateAll(currentTles);
          if (!aborted) {
            propagateTimer = window.setTimeout(tick, getPropagationIntervalMs(currentTles.length));
          }
        };
        propagateTimer = window.setTimeout(tick, getPropagationIntervalMs(allTles.length));
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
      if (globeRef.current) globeRef.current.objectsData(points);
      searchPropTimerRef.current = window.setTimeout(tick, 1000);
    };
    tick();
  }, []);

  const toggleDayMode = useCallback(() => {
    if (!globeRef.current) return;
    const newDayMode = !isDayMode;
    setIsDayMode(newDayMode);
    
    if (newDayMode) {
      globeRef.current
        .backgroundColor("#ffffff")
        .backgroundImageUrl("")
        .globeImageUrl("//unpkg.com/three-globe/example/img/earth-day.jpg")
        .atmosphereColor("rgba(200, 200, 200, 0.3)");
    } else {
      const starBg = generateStarfieldDataUrl(2048, 1024, 4000);
      globeRef.current
        .backgroundColor("#000011")
        .backgroundImageUrl(starBg)
        .globeImageUrl("//unpkg.com/three-globe/example/img/earth-night.jpg")
        .atmosphereColor(atmosphereColor);
    }
  }, [isDayMode, atmosphereColor]);

  const updateAtmosphere = useCallback((showAtmo: boolean) => {
    if (!globeRef.current) return;
    setShowAtmosphere(showAtmo);
    globeRef.current.showAtmosphere(showAtmo);
  }, []);

  const updateGraticules = useCallback((showGrat: boolean) => {
    if (!globeRef.current) return;
    setShowGraticules(showGrat);
    globeRef.current.showGraticules(showGrat);
  }, []);

  const updateAtmosphereAltitude = useCallback((altitude: number) => {
    if (!globeRef.current) return;
    setAtmosphereAltitude(altitude);
    globeRef.current.atmosphereAltitude(altitude);
  }, []);

  const updateAtmosphereColorPreset = useCallback((color: string) => {
    if (!globeRef.current || isDayMode) return;
    setAtmosphereColor(color);
    globeRef.current.atmosphereColor(color);
  }, [isDayMode]);

  const updateRotationSpeed = useCallback((speed: number) => {
    if (!globeRef.current) return;
    setRotationSpeed(speed);
    const controls = (globeRef.current as any).controls?.();
    if (controls) {
      if (speed === 0) {
        controls.autoRotate = false;
      } else {
        controls.autoRotate = true;
        controls.autoRotateSpeed = speed * 2;
      }
    }
  }, []);

  const resetVisualization = useCallback(() => {
    if (!globeRef.current) return;
    setIsDayMode(false);
    setShowAtmosphere(true);
    setShowGraticules(true);
    setAtmosphereAltitude(0.15);
    setAtmosphereColor("rgba(100, 160, 255, 0.5)");
    setRotationSpeed(1);
    
    const starBg = generateStarfieldDataUrl(2048, 1024, 4000);
    globeRef.current
      .backgroundColor("#000011")
      .backgroundImageUrl(starBg)
      .globeImageUrl("//unpkg.com/three-globe/example/img/earth-night.jpg")
      .showAtmosphere(true)
      .atmosphereAltitude(0.15)
      .atmosphereColor("rgba(100, 160, 255, 0.5)")
      .showGraticules(true);
    
    const controls = (globeRef.current as any).controls?.();
    if (controls) {
      controls.autoRotate = true;
      controls.autoRotateSpeed = 2;
    }
  }, []);

  return (
    <div style={{ position: "relative", width: "100vw", height: "100vh" }}>
      <GlobeCanvas containerRef={containerRef} />

      <LuneGlobePanel
        activePanel={activePanel}
        onOpenSearchPanel={() => {
          if (activePanel !== "search") {
            setActivePanel("search");
            setSearchQuery("");
            setSearchSuggestions([]);
          }
        }}
        onOpenFilterPanel={() => {
          if (activePanel !== "filter") {
            setActivePanel("filter");
          }
        }}
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
        searchLoading={searchLoading}
        searchSuggestions={searchSuggestions}
        onSearchSelect={handleSearchSelect}
        satType={satType}
        satCompany={satCompany}
        satTypes={SAT_TYPES}
        satTypeDescriptions={SAT_TYPE_DESCRIPTIONS}
        companyOptions={COMPANY_OPTIONS}
        companyDescriptions={COMPANY_DESCRIPTIONS}
        onSatTypeChange={(value) => {
          setSatType(value);
          setSatCompany("All");
        }}
        onSatCompanyChange={setSatCompany}
        satellitesLength={satellites.length}
        satCount={satCount}
        lastUpdated={lastUpdated}
        dataSource={dataSource}
        loading={loading}
      />

      <Navbar />

      <SelectedSatellitesPanel
        selectedSats={selectedSats}
        maxSelected={MAX_SELECTED}
        onRemoveSat={removeSat}
        onClearAll={clearAll}
      />

      <OrbitalViewPanel
        altitudeBands={ALTITUDE_BANDS}
        satellites={satellites}
        satCount={satCount}
      />

      <VisualizationPanel
        isDayMode={isDayMode}
        showAtmosphere={showAtmosphere}
        showGraticules={showGraticules}
        atmosphereAltitude={atmosphereAltitude}
        atmosphereColor={atmosphereColor}
        rotationSpeed={rotationSpeed}
        onToggleDayMode={toggleDayMode}
        onToggleAtmosphere={() => updateAtmosphere(!showAtmosphere)}
        onToggleGraticules={() => updateGraticules(!showGraticules)}
        onUpdateAtmosphereColorPreset={updateAtmosphereColorPreset}
        onUpdateAtmosphereAltitude={updateAtmosphereAltitude}
        onUpdateRotationSpeed={updateRotationSpeed}
        onResetVisualization={resetVisualization}
      />

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

