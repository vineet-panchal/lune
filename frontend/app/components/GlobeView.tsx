"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { fetchKMeansClusters, fetchSatellites } from "../lib/api";
import * as satellite from "satellite.js";
import * as THREE from "three";
import { feature } from "topojson-client";
import type { Topology } from "topojson-specification";
import GlobeCanvas from "./globe/GlobeCanvas";
import Navbar from "./layout/Navbar";
import LuneGlobePanel from "./panels/LuneGlobePanel";
import OrbitalAnalyticsPanel from "./panels/OrbitalAnalyticsPanel";
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

type GlobeTaggedObject3D = THREE.Object3D & { __globeObjType?: string };

type GlobeInstance = {
  width: (w: number) => GlobeInstance;
  height: (h: number) => GlobeInstance;
  backgroundColor: (c: string) => GlobeInstance;
  backgroundImageUrl: (url: string) => GlobeInstance;
  globeImageUrl: (url: string) => GlobeInstance;
  bumpImageUrl: (url: string) => GlobeInstance;
  showGlobe: (v: boolean) => GlobeInstance;
  showAtmosphere: (v: boolean) => GlobeInstance;
  atmosphereAltitude: (v: number) => GlobeInstance;
  atmosphereColor: (c: string) => GlobeInstance;
  showGraticules: (v: boolean) => GlobeInstance;
  globeMaterial: () => any;
  scene: () => THREE.Scene;
  getGlobeRadius: () => number;
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

const MAP_STYLES = ["default", "detail", "black", "white"] as const;
type MapStyle = (typeof MAP_STYLES)[number];

const SPACE_STYLES = ["default", "rich", "black"] as const;
type SpaceStyle = (typeof SPACE_STYLES)[number];

const MAP_STYLE_LABELS: Record<MapStyle, string> = {
  default: "Default",
  detail: "4K",
  black: "Black",
  white: "White",
};

const SPACE_STYLE_LABELS: Record<SpaceStyle, string> = {
  default: "Default",
  rich: "Stars",
  black: "Black",
};

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

const ANALYTICS_PANEL_WIDTH_PX = 392;

const CLUSTER_PALETTE = [
  "#4fc3f7",
  "#81c784",
  "#ffd54f",
  "#ff8a65",
  "#f06292",
  "#ba68c8",
  "#90a4ae",
  "#fff176",
];

export type GlobeViewMode = "satellite-tracker" | "orbital-intelligence";

type GlobeViewProps = {
  mode?: GlobeViewMode;
};

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

function geodeticToCartesianKm(latDeg: number, lngDeg: number, altKm: number): { x: number; y: number; z: number } {
  const lat = (latDeg * Math.PI) / 180;
  const lng = (lngDeg * Math.PI) / 180;
  const radius = EARTH_RADIUS_KM + Math.max(0, altKm);
  const cosLat = Math.cos(lat);
  return {
    x: radius * cosLat * Math.cos(lng),
    y: radius * Math.sin(lat),
    z: radius * cosLat * Math.sin(lng),
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

function createCloudTextureCanvas(width = 1024, height = 512, blobs = 72) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  ctx.clearRect(0, 0, width, height);
  for (let i = 0; i < blobs; i++) {
    const centerX = Math.random() * width;
    const centerY = Math.random() * height;
    const radiusX = 18 + Math.random() * 70;
    const radiusY = 10 + Math.random() * 28;
    const alpha = 0.03 + Math.random() * 0.09;
    const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    gradient.addColorStop(0, `rgba(255,255,255,${alpha})`);
    gradient.addColorStop(0.65, `rgba(255,255,255,${alpha * 0.55})`);
    gradient.addColorStop(1, "rgba(255,255,255,0)");

    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.rotate((Math.random() - 0.5) * Math.PI * 0.7);
    ctx.scale(radiusX, radiusY);
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(0, 0, 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  return canvas;
}

export default function GlobeView({ mode = "satellite-tracker" }: GlobeViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const globeRef = useRef<GlobeInstance | null>(null);
  const clusterBySatIdRef = useRef<Map<number, number> | null>(null);
  const propagateAllRef = useRef<(tles: SatTle[], forceUiUpdate?: boolean) => void>(() => {});
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
  const countryBordersRef = useRef<any[] | null>(null);
  const cloudMeshRef = useRef<THREE.Mesh<THREE.SphereGeometry, THREE.MeshPhongMaterial> | null>(null);
  const cloudAnimationFrameRef = useRef<number | null>(null);

  // Visualization control state
  const [isDayMode, setIsDayMode] = useState(false);
  const [showAtmosphere, setShowAtmosphere] = useState(true);
  const [showGraticules, setShowGraticules] = useState(true);
  const [showBorders, setShowBorders] = useState(true);
  const [showClouds, setShowClouds] = useState(false);
  const [atmosphereAltitude, setAtmosphereAltitude] = useState(0.15);
  const [atmosphereColor, setAtmosphereColor] = useState("rgba(100, 160, 255, 0.5)");
  const [rotationSpeed, setRotationSpeed] = useState(1);
  const [mapStyle, setMapStyle] = useState<MapStyle>("default");
  const [spaceStyle, setSpaceStyle] = useState<SpaceStyle>("default");
  const [globeInitialized, setGlobeInitialized] = useState(false);
  const [countryBordersReady, setCountryBordersReady] = useState(false);
  const [clusterSummary, setClusterSummary] = useState<{
    k: number;
    inertia: number | null;
    sizes: Record<number, number>;
  } | null>(null);
  const [clusterError, setClusterError] = useState<string | null>(null);
  const [clusteringBusy, setClusteringBusy] = useState(false);

  const mapStyleLabel = MAP_STYLE_LABELS[mapStyle];
  const spaceStyleLabel = SPACE_STYLE_LABELS[spaceStyle];

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
          countryBordersRef.current = (countries as any).features;
          setCountryBordersReady(true);
        })
        .catch((e) => console.warn("Failed to load country borders", e));

      globe.pointOfView(
        mode === "orbital-intelligence"
          ? { lat: 18, lng: -28, altitude: 3.35 }
          : { lat: 20, lng: 0, altitude: 2.2 },
        0
      );

      globeRef.current = globe;
      setGlobeInitialized(true);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- globe init once per mount; mode is fixed per route
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
    clusterBySatIdRef.current = null;
    setClusterSummary(null);
    setClusterError(null);

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
          const clusterMap = clusterBySatIdRef.current;
          const cid = clusterMap?.get(s.satelliteId);
          const color =
            cid !== undefined && cid !== null
              ? CLUSTER_PALETTE[Math.abs(cid) % CLUSTER_PALETTE.length]
              : altitudeToColor(geo.alt ?? 0);
          const satPoint = {
            satelliteId: s.satelliteId,
            name: s.name,
            latitude: geo.lat,
            longitude: geo.lng,
            altitudeKm: geo.alt,
            color,
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
      propagateAllRef.current = propagateAll;
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

  const runKMeans = useCallback(async (k: number) => {
    const tles = satTlesRef.current;
    if (tles.length < 2 || k < 2) return;
    setClusteringBusy(true);
    setClusterError(null);
    try {
      const now = new Date();
      const points = tles.map((t) => {
        const geo = propagateToGeodetic(t.satrec, now);
        if (!geo) return null;
        const xyz = geodeticToCartesianKm(geo.lat, geo.lng, geo.alt);
        return {
          satelliteId: t.satelliteId,
          name: t.name,
          // Keep the existing API field names for compatibility; values are XYZ position-space features.
          altitudeKm: xyz.x,
          inclinationDeg: xyz.y,
          meanMotionRpd: xyz.z,
        };
      }).filter((p): p is NonNullable<typeof p> => Boolean(p));
      if (points.length < 2) {
        throw new Error("Not enough propagated points available for clustering right now.");
      }
      const resp = await fetchKMeansClusters({ k: Math.min(k, points.length), points });
      const map = new Map<number, number>();
      points.forEach((p, i) => map.set(p.satelliteId, resp.labels[i] ?? 0));
      clusterBySatIdRef.current = map;
      const sizes: Record<number, number> = {};
      resp.labels.forEach((label) => {
        sizes[label] = (sizes[label] ?? 0) + 1;
      });
      setClusterSummary({
        k: resp.nClusters,
        inertia: resp.inertia ?? null,
        sizes,
      });
      propagateAllRef.current(tles, true);
    } catch (e) {
      console.error(e);
      setClusterError(e instanceof Error ? e.message : "Clustering request failed");
    } finally {
      setClusteringBusy(false);
    }
  }, []);

  const clearClustering = useCallback(() => {
    clusterBySatIdRef.current = null;
    setClusterSummary(null);
    setClusterError(null);
    propagateAllRef.current(satTlesRef.current, true);
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
    setIsDayMode((current) => !current);
  }, []);

  const updateAtmosphere = useCallback((showAtmo: boolean) => {
    setShowAtmosphere(showAtmo);
  }, []);

  const updateGraticules = useCallback((showGrat: boolean) => {
    setShowGraticules(showGrat);
  }, []);

  const toggleBorders = useCallback(() => {
    setShowBorders((current) => !current);
  }, []);

  const cycleMapStyle = useCallback(() => {
    setMapStyle((current) => {
      const index = MAP_STYLES.indexOf(current);
      return MAP_STYLES[(index + 1) % MAP_STYLES.length];
    });
  }, []);

  const toggleClouds = useCallback(() => {
    setShowClouds((current) => !current);
  }, []);

  const cycleSpaceStyle = useCallback(() => {
    setSpaceStyle((current) => {
      const index = SPACE_STYLES.indexOf(current);
      return SPACE_STYLES[(index + 1) % SPACE_STYLES.length];
    });
  }, []);

  const updateAtmosphereAltitude = useCallback((altitude: number) => {
    setAtmosphereAltitude(altitude);
  }, []);

  const updateAtmosphereColorPreset = useCallback((color: string) => {
    if (isDayMode) return;
    setAtmosphereColor(color);
  }, [isDayMode]);

  const updateRotationSpeed = useCallback((speed: number) => {
    setRotationSpeed(speed);
  }, []);

  const resetVisualization = useCallback(() => {
    setIsDayMode(false);
    setShowAtmosphere(true);
    setShowGraticules(true);
    setShowBorders(true);
    setShowClouds(false);
    setAtmosphereAltitude(0.15);
    setAtmosphereColor("rgba(100, 160, 255, 0.5)");
    setRotationSpeed(1);
    setMapStyle("default");
    setSpaceStyle("default");
  }, []);

  useEffect(() => {
    if (!globeInitialized || !globeRef.current) return;

    const globe = globeRef.current;
    const backgroundImage =
      spaceStyle === "black"
        ? ""
        : spaceStyle === "rich"
          ? generateStarfieldDataUrl(2048, 1024, 7000)
          : isDayMode
            ? ""
            : generateStarfieldDataUrl(2048, 1024, 4000);

    const backgroundColor =
      spaceStyle === "black"
        ? "#000000"
        : spaceStyle === "rich"
          ? "#000008"
          : isDayMode
            ? "#f8fbff"
            : "#000011";

    const globeImageUrl =
      mapStyle === "detail"
        ? "//unpkg.com/three-globe/example/img/earth-blue-marble.jpg"
        : mapStyle === "black"
          ? "//unpkg.com/three-globe/example/img/earth-topology.png"
          : mapStyle === "white"
            ? "//unpkg.com/three-globe/example/img/earth-topology.png"
          : isDayMode
            ? "//unpkg.com/three-globe/example/img/earth-day.jpg"
            : "//unpkg.com/three-globe/example/img/earth-night.jpg";

    globe
      .backgroundColor(backgroundColor)
      .backgroundImageUrl(backgroundImage)
      .showGlobe(true)
      .globeImageUrl(globeImageUrl)
      .bumpImageUrl("//unpkg.com/three-globe/example/img/earth-topology.png")
      .showAtmosphere(showAtmosphere)
      .atmosphereAltitude(atmosphereAltitude)
      .atmosphereColor(isDayMode ? "rgba(200, 200, 200, 0.3)" : atmosphereColor)
      .showGraticules(showGraticules);

    const globeMaterial = globe.globeMaterial?.();
    if (globeMaterial) {
      globeMaterial.color = new THREE.Color(
        mapStyle === "white" ? "#f2f2ee" : mapStyle === "black" ? "#08090b" : "#ffffff"
      );
      globeMaterial.shininess = mapStyle === "detail" ? 16 : mapStyle === "white" ? 0 : mapStyle === "black" ? 3 : 10;
      globeMaterial.bumpScale = mapStyle === "white" ? 14.5 : mapStyle === "black" ? 15.5 : mapStyle === "detail" ? 5 : 2;
      globeMaterial.specular = new THREE.Color(
        mapStyle === "white" ? "#4f4f4f" : mapStyle === "black" ? "#d0d0d0" : "#444444"
      );
      globeMaterial.emissive = new THREE.Color(mapStyle === "white" ? "#000000" : "#000000");
      globeMaterial.emissiveIntensity = 0;
    }

    const polygons = countryBordersReady && showBorders ? countryBordersRef.current ?? [] : [];
    globe
      .polygonsData(polygons)
      .polygonCapColor(() => "rgba(0, 0, 0, 0)")
      .polygonSideColor(() => "rgba(0, 0, 0, 0)")
      .polygonStrokeColor(() => {
        if (mapStyle === "white") return "rgba(10, 10, 10, 0.94)";
        if (mapStyle === "black") return "rgba(210, 210, 210, 0.82)";
        return "rgba(140, 180, 255, 0.35)";
      })
      .polygonAltitude(() => 0.005);
  }, [
    atmosphereAltitude,
    atmosphereColor,
    countryBordersReady,
    globeInitialized,
    isDayMode,
    mapStyle,
    showAtmosphere,
    showBorders,
    showGraticules,
    spaceStyle,
  ]);

  useEffect(() => {
    if (!globeInitialized || !globeRef.current) return;

    const controls = (globeRef.current as any).controls?.();
    if (!controls) return;

    controls.autoRotate = rotationSpeed > 0;
    controls.autoRotateSpeed = rotationSpeed * 2;
  }, [globeInitialized, rotationSpeed]);

  useEffect(() => {
    if (!globeInitialized || !globeRef.current) return;

    const globe = globeRef.current;
    const scene = globe.scene();

    if (cloudAnimationFrameRef.current) {
      window.cancelAnimationFrame(cloudAnimationFrameRef.current);
      cloudAnimationFrameRef.current = null;
    }

    if (cloudMeshRef.current) {
      scene.remove(cloudMeshRef.current);
      cloudMeshRef.current.geometry.dispose();
      cloudMeshRef.current.material.dispose();
      cloudMeshRef.current = null;
    }

    if (!showClouds) return;

    const cloudsTexture = new THREE.CanvasTexture(createCloudTextureCanvas());
    cloudsTexture.needsUpdate = true;
    const cloudsMesh = new THREE.Mesh(
      new THREE.SphereGeometry(globe.getGlobeRadius() * 1.006, 75, 75),
      new THREE.MeshPhongMaterial({ map: cloudsTexture, transparent: true, opacity: 0.62, depthWrite: false })
    );

    cloudsMesh.rotation.z = 0.25;
    scene.add(cloudsMesh);
    cloudMeshRef.current = cloudsMesh;

    const rotateClouds = () => {
      cloudsMesh.rotation.y -= 0.006;
      cloudAnimationFrameRef.current = window.requestAnimationFrame(rotateClouds);
    };

    rotateClouds();

    return () => {
      if (cloudAnimationFrameRef.current) {
        window.cancelAnimationFrame(cloudAnimationFrameRef.current);
        cloudAnimationFrameRef.current = null;
      }
      if (cloudMeshRef.current) {
        scene.remove(cloudMeshRef.current);
        cloudMeshRef.current.geometry.dispose();
        cloudMeshRef.current.material.map?.dispose();
        cloudMeshRef.current.material.dispose();
        cloudMeshRef.current = null;
      }
    };
  }, [globeInitialized, showClouds]);

  useEffect(() => {
    if (!globeInitialized || !globeRef.current) return;

    const scene = globeRef.current.scene();
    const axes = new THREE.AxesHelper(340);
    const grid = new THREE.GridHelper(720, 36, 0x556f8f, 0x1c2330);
    const gridMat = grid.material;
    if (!Array.isArray(gridMat)) {
      gridMat.transparent = true;
      gridMat.opacity = 0.42;
    } else {
      gridMat.forEach((m) => {
        m.transparent = true;
        m.opacity = 0.42;
      });
    }

    if (mode !== "orbital-intelligence") {
      scene.traverse((obj) => {
        const o = obj as GlobeTaggedObject3D;
        if (o.__globeObjType === "globe") {
          o.scale.setScalar(1);
        }
      });
      return () => {};
    }

    scene.add(axes);
    scene.add(grid);
    scene.traverse((obj) => {
      const o = obj as GlobeTaggedObject3D;
      if (o.__globeObjType === "globe") {
        o.scale.setScalar(0.22);
      }
    });

    return () => {
      scene.remove(axes);
      scene.remove(grid);
      axes.geometry.dispose();
      (axes.material as THREE.Material).dispose();
      grid.geometry.dispose();
      const gm = grid.material;
      if (Array.isArray(gm)) gm.forEach((m) => m.dispose());
      else gm.dispose();

      scene.traverse((obj) => {
        const o = obj as GlobeTaggedObject3D;
        if (o.__globeObjType === "globe") {
          o.scale.setScalar(1);
        }
      });
    };
  }, [globeInitialized, mode]);

  return (
    <div
      style={{
        position: "relative",
        width: "100vw",
        height: "100vh",
        overflow: "hidden",
        paddingRight: mode === "orbital-intelligence" ? ANALYTICS_PANEL_WIDTH_PX : 0,
        boxSizing: "border-box",
      }}
    >
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          zIndex: 0,
          background:
            spaceStyle === "black"
              ? "radial-gradient(circle at 50% 35%, rgba(255,255,255,0.03), transparent 40%), #000"
              : spaceStyle === "rich"
                ? "radial-gradient(circle at 50% 38%, rgba(22, 35, 72, 0.42), transparent 36%), radial-gradient(circle at 15% 18%, rgba(255, 214, 120, 0.14), transparent 11%), radial-gradient(circle at 78% 28%, rgba(226, 239, 255, 0.18), transparent 9%)"
                : "transparent",
        }}
      >
        {spaceStyle === "rich" && (
          <>
            <div
              style={{
                position: "absolute",
                top: "10%",
                left: "12%",
                width: 88,
                height: 88,
                borderRadius: "50%",
                background: "radial-gradient(circle, rgba(255, 236, 171, 0.9) 0%, rgba(255, 182, 61, 0.54) 35%, rgba(255, 182, 61, 0.06) 68%, transparent 100%)",
                filter: "blur(2px)",
                boxShadow: "0 0 60px rgba(255, 186, 76, 0.45)",
              }}
            />
            <div
              style={{
                position: "absolute",
                top: "18%",
                right: "14%",
                width: 54,
                height: 54,
                borderRadius: "50%",
                background: "radial-gradient(circle, rgba(240, 245, 255, 0.95) 0%, rgba(187, 205, 255, 0.52) 52%, rgba(187, 205, 255, 0.08) 76%, transparent 100%)",
                filter: "blur(1px)",
                boxShadow: "0 0 38px rgba(204, 220, 255, 0.28)",
              }}
            />
          </>
        )}
      </div>

      <div style={{ position: "relative", zIndex: 1, width: "100%", height: "100%" }}>
        <GlobeCanvas containerRef={containerRef} />
      </div>

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

      <Navbar current={mode === "orbital-intelligence" ? "orbital-intelligence" : "satellite-tracker"} />

      <SelectedSatellitesPanel
        rightInsetPx={mode === "orbital-intelligence" ? ANALYTICS_PANEL_WIDTH_PX : 0}
        selectedSats={selectedSats}
        maxSelected={MAX_SELECTED}
        onRemoveSat={removeSat}
        onClearAll={clearAll}
      />

      {mode === "satellite-tracker" && (
        <OrbitalViewPanel
          altitudeBands={ALTITUDE_BANDS}
          satellites={satellites}
          satCount={satCount}
        />
      )}

      {mode === "orbital-intelligence" && (
        <OrbitalAnalyticsPanel
          satelliteSampleCount={satellites.length}
          satelliteTotalCount={satCount}
          loadingCatalog={loading}
          clusteringBusy={clusteringBusy}
          clusterError={clusterError}
          clusterSummary={clusterSummary}
          onRunKMeans={(k) => void runKMeans(k)}
          onClearClustering={clearClustering}
        />
      )}

      <VisualizationPanel
        rightGutterPx={mode === "orbital-intelligence" ? ANALYTICS_PANEL_WIDTH_PX : 0}
        isDayMode={isDayMode}
        showAtmosphere={showAtmosphere}
        showGraticules={showGraticules}
        showBorders={showBorders}
        showClouds={showClouds}
        mapStyleLabel={mapStyleLabel}
        spaceStyleLabel={spaceStyleLabel}
        atmosphereAltitude={atmosphereAltitude}
        atmosphereColor={atmosphereColor}
        rotationSpeed={rotationSpeed}
        onToggleDayMode={toggleDayMode}
        onToggleAtmosphere={() => updateAtmosphere(!showAtmosphere)}
        onToggleGraticules={() => updateGraticules(!showGraticules)}
        onToggleBorders={toggleBorders}
        onCycleMapStyle={cycleMapStyle}
        onToggleClouds={toggleClouds}
        onCycleSpaceStyle={cycleSpaceStyle}
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

