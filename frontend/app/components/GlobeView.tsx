"use client";

import { useEffect, useRef, useState, useCallback, type ReactNode } from "react";
import { fetchClusterAnalytics, fetchSatellites } from "../lib/api";
import { createSatelliteLayer, keyframeFromPoints, type Keyframe, type SatelliteLayer, type SatellitePoint } from "../lib/satelliteLayer";
import { createStore, useStore, type Store } from "../lib/store";
import { computeStaticColoring, isColorMode, type ColorMode } from "../lib/colorModes";
import { createSimClock } from "../lib/simClock";
import { createPropagator, type Positions, type Propagator } from "../lib/propagator";
import { createDayNight, type DayNight } from "../lib/dayNight";
import { createCoverageLayer, type CoverageLayer } from "../lib/coverageLayer";
import type { Observer } from "../lib/passes";
import TimeControls from "./panels/TimeControls";
import PanelDock, { type DockPanel } from "./layout/PanelDock";
import { useLayoutMode, type LayoutMode } from "../lib/useLayoutMode";
import type { SimClock } from "../lib/simClock";
import { MdInsights, MdLayers, MdPalette, MdSatelliteAlt, MdSchedule, MdTune } from "react-icons/md";
import * as satellite from "satellite.js";
import * as THREE from "three";
import { feature } from "topojson-client";
import type { Topology } from "topojson-specification";
import GlobeCanvas from "./globe/GlobeCanvas";
import Navbar from "./layout/Navbar";
import LuneGlobePanel from "./panels/LuneGlobePanel";
import OrbitalAnalyticsPanel, {
  type ClusterAlgorithm,
  type ClusterRunPayload,
  type ClusterSummary,
} from "./panels/OrbitalAnalyticsPanel";
import OrbitalViewPanel, { type ColorLegend } from "./panels/OrbitalViewPanel";
import SelectedSatellitesPanel, { type SelectedSat } from "./panels/SelectedSatellitesPanel";
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
  /** Kept for details satrec doesn't store (e.g. the launch designator), and for the propagation worker. */
  line1?: string;
  line2?: string;
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
  camera: () => THREE.Camera;
  renderer: () => THREE.WebGLRenderer;
  getGlobeRadius: () => number;
  getCoords: (lat: number, lng: number, altitude?: number) => { x: number; y: number; z: number };
  pointsData: (d: any[]) => GlobeInstance;
  pointLat: (a: any) => GlobeInstance;
  pointLng: (a: any) => GlobeInstance;
  pointAltitude: (a: any) => GlobeInstance;
  pointColor: (a: any) => GlobeInstance;
  pointRadius: (a: any) => GlobeInstance;
  pointLabel: (a: any) => GlobeInstance;
  onPointClick: (fn: (point: any, event: MouseEvent, coords: any) => void) => GlobeInstance;
  pointOfView: {
    (): { lat: number; lng: number; altitude: number };
    (pov: { lat: number; lng: number; altitude: number }, ms?: number): GlobeInstance;
  };
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

/** While simulated time runs faster than real time, update often enough that dots don't jump. */
function getPropagationIntervalMs(count: number, fastClock = false): number {
  if (fastClock) {
    // The worker does the heavy maths (~65 ms for Starlink), so this only costs a background thread.
    if (count >= 6000) return 250;
    if (count >= 1800) return 150;
    return 100;
  }
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

function altitudeBandIndex(altKm: number): number {
  const i = ALTITUDE_BANDS.findIndex((band) => altKm < band.max);
  return i === -1 ? ALTITUDE_BANDS.length - 1 : i;
}

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

function clusterLabelToColor(label: number, algorithm: ClusterAlgorithm | null): string {
  if (algorithm === "dbscan" && label === -1) return "#78909c";
  if (algorithm === "isolation_forest") {
    if (label === -1) return "#ff6e6e";
    return "#69f0ae";
  }
  return CLUSTER_PALETTE[Math.abs(label) % CLUSTER_PALETTE.length];
}

function formatClusterParamsLine(payload: ClusterRunPayload): string {
  switch (payload.algorithm) {
    case "kmeans":
      return `k = ${payload.k}`;
    case "dbscan":
      return `eps = ${payload.eps.toFixed(2)}, min_samples = ${payload.minSamples}`;
    case "isolation_forest":
      return `contamination ≈ ${(100 * payload.contamination).toFixed(1)}%`;
  }
}

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


type OrbitPath = {
  satelliteId: number;
  color: string;
  points: { lat: number; lng: number; alt: number }[];
  /** The (simulated) time the trail is drawn around; redrawn when time moves far from it. */
  centerMs: number;
};

/** A path on the ground under the followed satellite (past half orbit faint, next orbit solid). */
type GroundTrackPath = {
  color: string;
  points: { lat: number; lng: number; alt: number }[];
  stroke: number;
  dashLength: number;
  dashGap: number;
};
/** Lifted just above the country borders (0.5% altitude ≈ 32 km), whose invisible fills would hide it over land. */
const GROUND_TRACK_ALT_KM = 40;
const GROUND_TRACK_RECENTER_MS = 10 * 60_000;

function computeGroundTrack(satrec: satellite.SatRec, color: string, centerMs: number): GroundTrackPath[] {
  const periodMs = ((2 * Math.PI) / satrec.no) * 60_000;
  const stepMs = periodMs / 240;
  const sample = (fromMs: number, toMs: number) => {
    const pts: GroundTrackPath["points"] = [];
    for (let t = fromMs; t <= toMs; t += stepMs) {
      const geo = propagateToGeodetic(satrec, new Date(t));
      if (geo) pts.push({ lat: geo.lat, lng: geo.lng, alt: GROUND_TRACK_ALT_KM });
    }
    return pts;
  };
  return [
    { color: "rgba(255,255,255,0.35)", points: sample(centerMs - periodMs / 2, centerMs), stroke: 1, dashLength: 0.02, dashGap: 0.01 },
    { color, points: sample(centerMs, centerMs + periodMs), stroke: 1.2, dashLength: 1, dashGap: 0 },
  ];
}

const TRAIL_MINUTES = 90;
const TRAIL_STEP_SECONDS = 30;
/** Redraw a trail once simulated time is this far from the moment it was drawn around. */
const TRAIL_RECENTER_MS = 15 * 60_000;
const OBSERVER_STORAGE_KEY = "lune.observer";
/**
 * Keyframes are computed this many update intervals ahead, so the next update always arrives before
 * the dots reach their target and they never stall waiting for it.
 */
const KEYFRAME_LEAD = 1.25;

const COLLAPSED_STORAGE_KEY = "lune.collapsedPanels";
/** Tablets start with every panel tucked away (except selected satellites) so the globe gets the room. */
const DEFAULT_COLLAPSED: Record<LayoutMode, string[]> = {
  desktop: [],
  tablet: ["filter", "colour", "time", "view", "analytics"],
  phone: [],
};
const PHONE_TOP_BAR_PX = 48;

/** Phone top bar: satellites drawn and whether the globe is live. */
function PhoneStatus({ store, clock }: { store: Store<CatalogStats>; clock: SimClock }) {
  const { count } = useStore(store);
  const [live, setLive] = useState(true);
  useEffect(() => {
    const update = () => setLive(clock.isLive());
    update();
    const unsubscribe = clock.subscribe(update);
    const timer = window.setInterval(update, 1000);
    return () => {
      unsubscribe();
      window.clearInterval(timer);
    };
  }, [clock]);
  return (
    <span>
      {count} satellites ·{" "}
      <span style={{ color: live ? "#66bb6a" : "#ffb74d" }}>{live ? "● LIVE" : "◷ TIME SHIFTED"}</span>
    </span>
  );
}

/** Satellites drawn, per altitude band, and when they were last computed: what the panels show. */
type CatalogStats = { count: number; altitudeCounts: number[]; lastUpdated: string | null };
const EMPTY_STATS: CatalogStats = { count: 0, altitudeCounts: [], lastUpdated: null };

/** Re-renders only its children when the stats change (not the whole globe page). */
function WithStats({ store, children }: { store: Store<CatalogStats>; children: (stats: CatalogStats) => ReactNode }) {
  return <>{children(useStore(store))}</>;
}

/**
 * Stable per-catalog slot arrays: the same object for the same TLE list, so the satellite layer can
 * tell the catalog hasn't changed and skip re-indexing.
 */
const slotCache = new WeakMap<SatTle[], { ids: number[]; names: string[] }>();
function slotsFor(tles: SatTle[]) {
  let slots = slotCache.get(tles);
  if (!slots) {
    slots = { ids: tles.map((t) => t.satelliteId), names: tles.map((t) => t.name) };
    slotCache.set(tles, slots);
  }
  return slots;
}
const SEARCH_TICK_MS = 1000;

/** Ground track ±90 min around centerMs. */
function computeOrbitTrail(satrec: satellite.SatRec, centerMs: number): OrbitPath["points"] {
  const pts: OrbitPath["points"] = [];
  for (let offset = -TRAIL_MINUTES * 60; offset <= TRAIL_MINUTES * 60; offset += TRAIL_STEP_SECONDS) {
    const geo = propagateToGeodetic(satrec, new Date(centerMs + offset * 1000));
    if (geo) pts.push(geo);
  }
  return pts;
}

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
  const clusterAlgorithmRef = useRef<ClusterAlgorithm | null>(null);
  const propagateAllRef = useRef<(tles: SatTle[], forceUiUpdate?: boolean) => void>(() => {});
  /** The time the globe shows: live by default, or paused / sped up / moved by the time controls. */
  const [clock] = useState(createSimClock);
  const [clockVersion, setClockVersion] = useState(0);
  const getNow = useCallback(() => clock.now(), [clock]);
  /** Background worker that runs SGP4 for the whole catalog, so it never blocks frames. */
  const propagatorRef = useRef<Propagator | null>(null);
  const getPropagator = useCallback(() => (propagatorRef.current ??= createPropagator()), []);
  useEffect(() => () => {
    propagatorRef.current?.dispose();
    propagatorRef.current = null;
  }, []);
  /** Observer for pass predictions; kept in this browser only. */
  const [observer, setObserverState] = useState<Observer | null>(null);
  // Responsive layout: which panels are collapsed (remembered per device size) and the phone sheet.
  const layout = useLayoutMode();
  const [collapsedByMode, setCollapsedByMode] = useState<Record<LayoutMode, string[]>>(DEFAULT_COLLAPSED);
  const [sheet, setSheet] = useState<string | null>(null);
  const [bottomInset, setBottomInset] = useState(0);
  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(COLLAPSED_STORAGE_KEY) ?? "null");
      if (saved && typeof saved === "object") setCollapsedByMode((prev) => ({ ...prev, ...saved }));
    } catch {
      /* storage unavailable: use the defaults */
    }
  }, []);
  const collapsed = new Set(collapsedByMode[layout.mode]);
  const toggleCollapsed = useCallback((id: string) => {
    setCollapsedByMode((prev) => {
      const set = new Set(prev[layout.mode]);
      if (set.has(id)) set.delete(id);
      else set.add(id);
      const next = { ...prev, [layout.mode]: [...set] };
      try {
        window.localStorage.setItem(COLLAPSED_STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* storage unavailable: keep it for this session */
      }
      return next;
    });
  }, [layout.mode]);
  const isPhone = layout.mode === "phone";
  const analyticsOpen = mode === "orbital-intelligence" && !isPhone && !collapsed.has("analytics");

  /** Counts for the panels, updated every few seconds without re-rendering the whole page. */
  const [statsStore] = useState(() => createStore<CatalogStats>(EMPTY_STATS));
  const [satType, setSatType] = useState<string>("Popular");
  const [satCompany, setSatCompany] = useState<string>("All");
  const [satCount, setSatCount] = useState(0);
  const [selectedSats, setSelectedSats] = useState<SelectedSat[]>([]);
  const [orbitPaths, setOrbitPaths] = useState<OrbitPath[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [dataSource, setDataSource] = useState<string | null>(null);
  const [tleUpdatedAt, setTleUpdatedAt] = useState<string | null>(null);
  /** Bumped whenever a new set of TLEs is loaded, so TLE-derived colours get recomputed. */
  const [tleVersion, setTleVersion] = useState(0);
  const [colorMode, setColorMode] = useState<ColorMode>("altitude");
  const [colorLegend, setColorLegend] = useState<ColorLegend | null>(null);
  /** Colour per satellite for modes that don't depend on position (null in altitude mode). */
  const staticColorsRef = useRef<Map<number, string> | null>(null);
  /** A shared link's selection, applied once its filter has finished loading. */
  const pendingShareRef = useRef<{ type: string; company: string; sats: number[]; follow: number | null } | null>(null);
  const shareReadRef = useRef(false);
  const satColor = useCallback((satelliteId: number, altitudeKm: number) => {
    const fixed = staticColorsRef.current;
    return fixed ? fixed.get(satelliteId) ?? "#9e9e9e" : altitudeToColor(altitudeKm);
  }, []);
  const selectedSatsRef = useRef<SelectedSat[]>([]);
  const orbitPathsRef = useRef<OrbitPath[]>([]);
  const satTlesRef = useRef<SatTle[]>([]);
  const satelliteLayerRef = useRef<SatelliteLayer | null>(null);
  const dayNightRef = useRef<DayNight | null>(null);
  const coverageRef = useRef<CoverageLayer | null>(null);
  /** Day/night shading on the globe, plus dimming satellites that are in Earth's shadow. */
  const [dayNightEnabled, setDayNightEnabled] = useState(false); // off by default; toggle in Visualize
  const dayNightEnabledRef = useRef(false);
  /** Ground track of the followed satellite (drawn with the orbit paths). */
  const [groundTrack, setGroundTrack] = useState<GroundTrackPath[]>([]);
  const [followId, setFollowIdState] = useState<number | null>(null);
  const followIdRef = useRef<number | null>(null);
  const setFollow = useCallback((id: number | null) => {
    followIdRef.current = id;
    setFollowIdState(id);
  }, []);
  /** If the followed satellite was removed, follow the most recently selected one left (or stop). */
  const followNextAfterRemoval = useCallback((removedId: number, remaining: SelectedSat[]) => {
    if (followIdRef.current !== removedId) return;
    setFollow(remaining.length > 0 ? remaining[remaining.length - 1].satelliteId : null);
  }, [setFollow]);

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
  const [clusterSummary, setClusterSummary] = useState<ClusterSummary | null>(null);
  const [clusterError, setClusterError] = useState<string | null>(null);
  const [clusteringBusy, setClusteringBusy] = useState(false);

  const mapStyleLabel = MAP_STYLE_LABELS[mapStyle];
  const spaceStyleLabel = SPACE_STYLE_LABELS[spaceStyle];

  const MAX_SELECTED = 10;

  // Click a satellite to select it and draw its orbit (or deselect it). Also used to restore shared links.
  const toggleSelection = useCallback((point: SatellitePoint) => {
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
      followNextAfterRemoval(point.satelliteId, nextSelected);
      return;
    }
    // Enforce max selection limit
    if (selectedSatsRef.current.length >= MAX_SELECTED) {
      setErrorMsg(`Maximum of ${MAX_SELECTED} satellites can be selected.`);
      setTimeout(() => setErrorMsg(null), 3000);
      return;
    }
    const satTle = satTlesRef.current.find((s) => s.satelliteId === point.satelliteId);
    if (!satTle) return;
    // Select – compute orbit trail client-side using SGP4
    const sat: SelectedSat = {
      satelliteId: point.satelliteId,
      name: point.name,
      color: point.color,
      satrec: satTle.satrec,
      line1: satTle.line1,
    };
    const nextSelected = [...selectedSatsRef.current, sat];
    selectedSatsRef.current = nextSelected;
    setSelectedSats(nextSelected);
    // While following, a newly clicked satellite becomes the one followed
    if (followIdRef.current !== null) setFollow(point.satelliteId);

    // Propagate a full orbit trail (~90 min each way) around the globe's current time
    const centerMs = clock.nowMs();
    const path: OrbitPath = {
      satelliteId: point.satelliteId,
      color: point.color,
      points: computeOrbitTrail(satTle.satrec, centerMs),
      centerMs,
    };
    const nextPaths = [...orbitPathsRef.current, path];
    orbitPathsRef.current = nextPaths;
    setOrbitPaths(nextPaths);
  }, [followNextAfterRemoval, setFollow, clock]);
  // The globe's click listener is created once; route it to the latest toggleSelection.
  const toggleSelectionRef = useRef(toggleSelection);
  toggleSelectionRef.current = toggleSelection;

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
        .pointLat("lat")
        .pointLng("lng")
        .pointAltitude(0.004)
        .pointRadius(0.5)
        .pointColor(() => "#ffffff")
        .pointLabel(() => "Your location")
        .pathPoints("points")
        .pathPointLat((p: any) => p.lat)
        .pathPointLng((p: any) => p.lng)
        .pathPointAlt((p: any) => Math.max(0, p.alt / EARTH_RADIUS_KM))
        .pathColor((d: any) => d.color)
        // Orbit trails use the defaults; ground tracks set their own stroke and dashes
        .pathStroke((d: Partial<GroundTrackPath>) => d.stroke ?? 1.5)
        .pathDashLength((d: Partial<GroundTrackPath>) => d.dashLength ?? 0.01)
        .pathDashGap((d: Partial<GroundTrackPath>) => d.dashGap ?? 0.004)
        .pathTransitionDuration(0)
        .pathsData([]);


      const satelliteLayer = createSatelliteLayer(globe, containerRef.current, {
        onClick: (point) => toggleSelectionRef.current(point),
        getTimeMs: () => clock.nowMs(),
        label: (d) => `${d.name} — ${Math.round(d.altitudeKm ?? 0)} km`,
      });
      satelliteLayerRef.current = satelliteLayer;
      const dayNight = createDayNight(globe, () => clock.nowMs());
      dayNightRef.current = dayNight;
      const coverage = createCoverageLayer(globe.scene());
      coverageRef.current = coverage;

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

      // Follow the container's size (it changes with the window and when the phone sheet opens),
      // so the Earth stays centred in whatever space is visible.
      const resize = () => {
        const el = containerRef.current;
        if (!el || !globeRef.current) return;
        globeRef.current.width(el.clientWidth).height(el.clientHeight);
      };
      resize();
      const resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(containerRef.current);

      return () => {
        satelliteLayer.dispose();
        dayNight.dispose();
        coverage.dispose();
        // Dev StrictMode mounts twice; don't clear a newer mount's layer.
        if (satelliteLayerRef.current === satelliteLayer) satelliteLayerRef.current = null;
        if (dayNightRef.current === dayNight) dayNightRef.current = null;
        if (coverageRef.current === coverage) coverageRef.current = null;
        resizeObserver.disconnect();
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

    // init is async, so its cleanup arrives later; run it immediately if we've already unmounted.
    let cleanup: (() => void) | undefined;
    let unmounted = false;
    init().then((fn) => {
      if (unmounted) fn?.();
      else cleanup = fn;
    });

    return () => {
      unmounted = true;
      cleanup?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- globe init once per mount; mode is fixed per route
  }, []);

  // Fetch satellite TLEs once, then propagate positions client-side every second.
  // No position API calls needed — all orbital math happens in the browser.
  useEffect(() => {
    let aborted = false;
    let propagateTimer: number | null = null;
    statsStore.set(EMPTY_STATS);
    setSatCount(0);
    setDataSource(null);
    setTleUpdatedAt(null);
    lastUiUpdateAtRef.current = 0;
    satTlesRef.current = [];
    selectedSatsRef.current = [];
    orbitPathsRef.current = [];
    setSelectedSats([]);
    setOrbitPaths([]);
    setFollow(null);
    clusterBySatIdRef.current = null;
    clusterAlgorithmRef.current = null;
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
      satelliteLayerRef.current?.setKeyframe(keyframeFromPoints([]), clock.nowMs(), { snap: true });
      return () => { aborted = true; };
    }

    setLoading(true);
    const opts = satCompany !== "All"
      ? (COMPANY_API_OPTS[satCompany] ?? { search: satCompany })
      : (SAT_TYPE_OPTS[satType] ?? { search: satType });
    // The backend serves whole groups from memory, so one request returns everything.
    const PAGE_SIZE = 20000;
    // While the backend is still downloading a group for the first time, poll for what has arrived.
    const LOADING_POLL_MS = 3000;

    // Keyframes: the worker computes where every satellite will be slightly ahead of the globe's time,
    // and the satellite layer glides the dots there frame by frame. Only that gliding runs on this thread.
    let generation = 0; // bumped by snaps (time jumps, new data) so results requested before them are dropped
    let tickInFlight = false;
    let tlesSentToWorker: SatTle[] | null = null;

    type KeyframeMode = "tick" | "retarget" | "snap";
    /**
     * "tick": the regular update (skipped if the worker is still busy with the previous one).
     * "retarget": the speed changed, so request a target for the new speed right away.
     * "snap": new data / time jump / recolour: put dots at the current time, then continue as usual.
     */
    async function propagateKeyframes(tles: SatTle[], mode: KeyframeMode) {
      if (aborted || tles.length === 0) return;
      if (mode === "tick" && tickInFlight) return;
      const propagator = getPropagator();
      if (tlesSentToWorker !== tles) {
        propagator.setTles(tles.map((t) => ({ line1: t.line1 ?? "", line2: t.line2 ?? "" })));
        tlesSentToWorker = tles;
      }
      if (mode === "snap") generation++;
      const gen = generation;
      const nowMs = clock.nowMs();
      const intervalMs = getPropagationIntervalMs(tles.length, !clock.paused && clock.rate > 1);
      const targetMs = clock.paused ? nowMs : nowMs + intervalMs * KEYFRAME_LEAD * clock.rate;
      const updateUi = mode === "snap" || Date.now() - lastUiUpdateAtRef.current >= getUiUpdateIntervalMs(tles.length);

      // Both requested up front; the worker answers in order.
      const current = mode === "snap" && targetMs !== nowMs ? propagator.propagate(nowMs) : null;
      const ahead = propagator.propagate(targetMs);
      if (mode === "tick") tickInFlight = true;
      try {
        if (current) {
          const geo = await current;
          if (aborted || gen !== generation) return;
          satelliteLayerRef.current?.setKeyframe(buildFrame(tles, geo, false).frame, nowMs, { snap: true });
        }
        const geo = await ahead;
        if (aborted || gen !== generation) return;
        const { frame, stats } = buildFrame(tles, geo, updateUi);
        if (stats) {
          statsStore.set(stats);
          lastUiUpdateAtRef.current = Date.now();
        }
        satelliteLayerRef.current?.setKeyframe(frame, targetMs, { snap: mode === "snap" && targetMs === nowMs });
      } finally {
        if (mode === "tick") tickInFlight = false;
      }
    }
    propagateAllRef.current = (tles, force = false) => void propagateKeyframes(tles, force ? "snap" : "tick");

    /** Keyframe (slots in the same order as tles) from the worker's results, plus panel stats if wanted. */
    function buildFrame(tles: SatTle[], { geo, xyz, shadow }: Positions, collectStats: boolean): { frame: Keyframe; stats: CatalogStats | null } {
      const slots = slotsFor(tles);
      const colors = new Array<string>(tles.length);
      const clusterMap = clusterBySatIdRef.current;
      const algo = clusterAlgorithmRef.current;
      const altitudeCounts = collectStats ? ALTITUDE_BANDS.map(() => 0) : null;
      let shown = 0;
      for (let i = 0; i < tles.length; i++) {
        const id = tles[i].satelliteId;
        const alt = geo[i * 3 + 2];
        const cid = clusterMap?.get(id);
        colors[i] = cid !== undefined && cid !== null ? clusterLabelToColor(cid, algo) : satColor(id, alt);
        if (altitudeCounts && !Number.isNaN(alt)) {
          shown++;
          altitudeCounts[altitudeBandIndex(alt)]++;
        }
      }
      return {
        frame: { ids: slots.ids, names: slots.names, xyz, colors, dimmed: dayNightEnabledRef.current ? shadow : undefined },
        stats: altitudeCounts ? { count: shown, altitudeCounts, lastUpdated: clock.now().toLocaleTimeString() } : null,
      };
    }

    /** Regular keyframe updates, every few seconds at real time and several times a second when sped up. */
    function scheduleTick() {
      if (propagateTimer) window.clearTimeout(propagateTimer);
      if (aborted) return;
      const count = satTlesRef.current.length;
      propagateTimer = window.setTimeout(() => {
        if (!clock.paused) void propagateKeyframes(satTlesRef.current, "tick");
        scheduleTick();
      }, getPropagationIntervalMs(count, !clock.paused && clock.rate > 1));
    }

    // Time controls: jumps snap the dots; speed changes re-target at once and restart the update timer
    // at the new interval (instead of waiting out the old, slower one).
    const unsubscribeClock = clock.subscribe((change) => {
      const tles = satTlesRef.current;
      if (aborted || tles.length === 0) return;
      void propagateKeyframes(tles, change === "rate" ? "retarget" : "snap");
      scheduleTick();
    });

    async function fetchTles() {
      let tickStarted = false;

      while (!aborted) {
        const resp = await fetchSatellites(1, PAGE_SIZE, opts);
        if (aborted) return;
        const tles: SatTle[] = (resp.satellites ?? [])
          .filter((x: any) => x?.satelliteId && x?.line1 && x?.line2)
          .map((x: any) => {
            const satrec = satellite.twoline2satrec(x.line1, x.line2);
            return { satelliteId: x.satelliteId, name: x.name ?? String(x.satelliteId), satrec, line1: x.line1, line2: x.line2 };
          })
          .filter((s: SatTle) => s.satrec);
        satTlesRef.current = tles;
        setTleVersion((v) => v + 1);
        setSatCount(resp.totalItems ?? tles.length);
        if (resp.dataSource) setDataSource(resp.dataSource);
        setTleUpdatedAt(resp.tleUpdatedAt ?? null);
        void propagateKeyframes(tles, "snap");
        setLoading(Boolean(resp.loading));

        // Propagation loop — pure math from the TLEs, no network calls
        if (!tickStarted && tles.length > 0) {
          tickStarted = true;
          scheduleTick();
        }

        if (!resp.loading) {
          restorePendingShare(tles);
          break;
        }
        await new Promise((r) => setTimeout(r, LOADING_POLL_MS));
      }
    }

    /** If the page was opened from a shared link for this filter, re-select its satellites. */
    function restorePendingShare(tles: SatTle[]) {
      const pending = pendingShareRef.current;
      if (!pending || pending.type !== satType || pending.company !== satCompany) return;
      pendingShareRef.current = null;
      const now = clock.now();
      for (const id of pending.sats.slice(0, MAX_SELECTED)) {
        const tle = tles.find((t) => t.satelliteId === id);
        const geo = tle ? propagateToGeodetic(tle.satrec, now) : null;
        if (!tle || !geo) continue;
        toggleSelectionRef.current({
          satelliteId: id, name: tle.name, latitude: geo.lat, longitude: geo.lng, altitudeKm: geo.alt,
          color: satColor(id, geo.alt),
        });
      }
      if (pending.follow !== null && selectedSatsRef.current.some((s) => s.satelliteId === pending.follow)) {
        setFollow(pending.follow);
      }
    }

    fetchTles().catch((e) => {
      const message = e instanceof Error ? e.message : String(e);
      const loaded = satTlesRef.current.length;
      if (loaded > 0) {
        // e.g. page 2+ returned 5xx while page 1 already populated the globe — not a hard failure.
        console.warn(
          `[GlobeView] Satellite catalog fetch stopped early (${loaded} in memory, expected more):`,
          message
        );
        return;
      }
      console.warn("[GlobeView] Satellite catalog failed:", message);
      setLoading(false);
      setErrorMsg(message);
      setTimeout(() => setErrorMsg(null), 8000);
    });
    return () => {
      aborted = true;
      unsubscribeClock();
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

  // Sync orbit paths to globe. Also runs once the globe is ready, since a shared link's selection
  // can be restored before the globe has finished initialising.
  useEffect(() => {
    if (!globeRef.current) return;
    globeRef.current.pathsData([...orbitPaths, ...groundTrack]);
  }, [orbitPaths, groundTrack, globeInitialized]);

  // Day/night: paint the daytime Earth over the night (city lights) texture; with other map styles
  // just darken the night side. Redraw the dots so ones in Earth's shadow get (un)dimmed.
  useEffect(() => {
    dayNightEnabledRef.current = dayNightEnabled;
    dayNightRef.current?.setEnabled(dayNightEnabled);
    dayNightRef.current?.setStyle({ paintDay: mapStyle === "default" && !isDayMode, nightDim: 0.65 });
    propagateAllRef.current(satTlesRef.current, true);
  }, [dayNightEnabled, mapStyle, isDayMode, globeInitialized]);

  const removeSat = useCallback((id: number) => {
    const nextSelected = selectedSatsRef.current.filter((s) => s.satelliteId !== id);
    const nextPaths = orbitPathsRef.current.filter((p) => p.satelliteId !== id);
    selectedSatsRef.current = nextSelected;
    orbitPathsRef.current = nextPaths;
    setSelectedSats(nextSelected);
    setOrbitPaths(nextPaths);
    followNextAfterRemoval(id, nextSelected);
  }, [followNextAfterRemoval]);

  const clearAll = useCallback(() => {
    selectedSatsRef.current = [];
    orbitPathsRef.current = [];
    setSelectedSats([]);
    setOrbitPaths([]);
    setFollow(null);
  }, [setFollow]);

  // Recolour when the colour mode changes or new TLEs arrive. Selected satellites and their
  // orbit paths take their new colour too.
  useEffect(() => {
    const now = clock.now();
    // Only satellites that can be placed on the globe count (old TLEs of re-entered satellites can't).
    const shown = satTlesRef.current.filter((t) => propagateToGeodetic(t.satrec, now));
    const coloring = computeStaticColoring(colorMode, shown, now);
    staticColorsRef.current = coloring?.colorById ?? null;
    setColorLegend(coloring ? { items: coloring.legend, categorical: coloring.categorical } : null);
    propagateAllRef.current(satTlesRef.current, true);

    const colorById = new Map<number, string>();
    for (const s of selectedSatsRef.current) {
      const geo = propagateToGeodetic(s.satrec, now);
      colorById.set(s.satelliteId, satColor(s.satelliteId, geo?.alt ?? 0));
    }
    if (colorById.size > 0) {
      const nextSelected = selectedSatsRef.current.map((s) => ({ ...s, color: colorById.get(s.satelliteId) ?? s.color }));
      const nextPaths = orbitPathsRef.current.map((p) => ({ ...p, color: colorById.get(p.satelliteId) ?? p.color }));
      selectedSatsRef.current = nextSelected;
      orbitPathsRef.current = nextPaths;
      setSelectedSats(nextSelected);
      setOrbitPaths(nextPaths);
    }
  }, [colorMode, tleVersion, satColor, clock]);

  // Shareable links: ?type=Internet&company=Starlink&sats=44713,45001&follow=44713&color=launch
  // Read once on load (after mount, so server and client render the same defaults first).
  useEffect(() => {
    if (mode !== "satellite-tracker") return;
    const params = new URLSearchParams(window.location.search);
    const type = params.get("type");
    const company = params.get("company");
    const color = params.get("color");
    const validType = type && type in SAT_TYPE_OPTS ? type : "Popular";
    const validCompany = company && (COMPANY_OPTIONS[validType] ?? ["All"]).includes(company) ? company : "All";
    if (validType !== "Popular") setSatType(validType);
    if (validCompany !== "All") setSatCompany(validCompany);
    if (isColorMode(color)) setColorMode(color);
    const t = Date.parse(params.get("t") ?? "");
    if (Number.isFinite(t)) clock.setTime(t);
    const sats = (params.get("sats") ?? "").split(",").map(Number).filter((n) => Number.isInteger(n) && n > 0);
    const follow = Number(params.get("follow"));
    if (sats.length > 0) {
      pendingShareRef.current = {
        type: validType,
        company: validCompany,
        sats,
        follow: Number.isInteger(follow) && sats.includes(follow) ? follow : null,
      };
    }
    shareReadRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read the URL once per mount
  }, []);

  const buildShareUrl = useCallback(() => {
    const params = new URLSearchParams();
    if (satType !== "Popular") params.set("type", satType);
    if (satCompany !== "All") params.set("company", satCompany);
    if (selectedSats.length > 0) params.set("sats", selectedSats.map((s) => s.satelliteId).join(","));
    if (followId !== null) params.set("follow", String(followId));
    if (colorMode !== "altitude") params.set("color", colorMode);
    if (!clock.isLive()) params.set("t", new Date(Math.round(clock.nowMs() / 1000) * 1000).toISOString().replace(".000Z", "Z"));
    const query = params.toString().replace(/%2C/g, ",").replace(/%3A/g, ":"); // keep "sats=1,2,3" and times readable
    return `${window.location.origin}${window.location.pathname}${query ? `?${query}` : ""}`;
    // clockVersion: rebuild when the time controls change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [satType, satCompany, selectedSats, followId, colorMode, clock, clockVersion]);

  // Keep the address bar in sync (without adding history entries), so a refresh keeps the view.
  // Skipped while a shared link is still being restored, so it isn't overwritten with defaults.
  useEffect(() => {
    if (mode !== "satellite-tracker" || !shareReadRef.current || pendingShareRef.current) return;
    const url = buildShareUrl();
    if (url !== window.location.href) window.history.replaceState(window.history.state, "", url);
  }, [mode, buildShareUrl]);

  const copyShareLink = useCallback(async () => {
    const url = buildShareUrl();
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Clipboard API refused (no permission / not focused): fall back to a hidden textarea + execCommand.
      const ta = document.createElement("textarea");
      ta.value = url;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      if (!ok) throw new Error("Copy failed");
    }
  }, [buildShareUrl]);

  // When the time controls change, refresh the share URL (the catalog effect redraws the dots).
  useEffect(() => clock.subscribe(() => setClockVersion((v) => v + 1)), [clock]);

  // Orbit trails are drawn ±90 min around a moment; redraw them once simulated time moves away from it.
  useEffect(() => {
    const recenter = () => {
      const nowMs = clock.nowMs();
      const stale = (p: OrbitPath) => Math.abs(p.centerMs - nowMs) > TRAIL_RECENTER_MS;
      if (!orbitPathsRef.current.some(stale)) return;
      const satrecById = new Map(selectedSatsRef.current.map((s) => [s.satelliteId, s.satrec]));
      const next = orbitPathsRef.current.map((p) => {
        const satrec = satrecById.get(p.satelliteId);
        return satrec && stale(p) ? { ...p, points: computeOrbitTrail(satrec, nowMs), centerMs: nowMs } : p;
      });
      orbitPathsRef.current = next;
      setOrbitPaths(next);
    };
    const timer = window.setInterval(recenter, 1000);
    const unsubscribe = clock.subscribe(recenter);
    return () => {
      window.clearInterval(timer);
      unsubscribe();
    };
  }, [clock]);

  // Observer location for pass predictions: remembered in this browser only (never put in share links).
  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(OBSERVER_STORAGE_KEY) ?? "null");
      if (saved && Number.isFinite(saved.latDeg) && Number.isFinite(saved.lngDeg)) setObserverState(saved);
    } catch {
      /* storage unavailable or corrupt: start without a location */
    }
  }, []);
  const setObserver = useCallback((next: Observer | null) => {
    setObserverState(next);
    try {
      if (next) window.localStorage.setItem(OBSERVER_STORAGE_KEY, JSON.stringify(next));
      else window.localStorage.removeItem(OBSERVER_STORAGE_KEY);
    } catch {
      /* storage unavailable: keep it for this session only */
    }
  }, []);
  // Mark the observer on the globe.
  useEffect(() => {
    globeRef.current?.pointsData(observer ? [{ lat: observer.latDeg, lng: observer.lngDeg }] : []);
  }, [observer, globeInitialized]);

  /** "show" on a pass: jump to a minute before it rises and follow the satellite. */
  const showPass = useCallback((satelliteId: number, riseMs: number) => {
    clock.setTime(riseMs - 60_000);
    setFollow(satelliteId);
  }, [clock, setFollow]);

  // When the layout changes (e.g. a phone in portrait), zoom out far enough that the whole Earth fits the
  // visible area. Uses the narrower of the camera's two fields of view; never zooms in past the defaults.
  useEffect(() => {
    const globe = globeRef.current;
    const el = containerRef.current;
    if (!globeInitialized || !globe || !el || el.clientHeight === 0) return;
    const halfVFov = (25 * Math.PI) / 180; // globe.gl's camera has a 50° vertical field of view
    const halfHFov = Math.atan(Math.tan(halfVFov) * (el.clientWidth / el.clientHeight));
    const fit = 1 / Math.sin(Math.min(halfVFov, halfHFov) * 0.85) - 1; // Earth radius = 1, 15% margin
    const base = mode === "orbital-intelligence" ? 3.35 : 2.2;
    const pov = globe.pointOfView();
    globe.pointOfView({ ...pov, altitude: Math.max(base, fit) }, 400);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the layout mode changes
  }, [layout.mode, globeInitialized]);

  // The followed satellite's dot is drawn bigger and glowing (re-applied once the globe is ready).
  useEffect(() => {
    satelliteLayerRef.current?.setHighlight(followId);
  }, [followId, globeInitialized]);

  const toggleFollow = useCallback((id: number) => {
    setFollow(followIdRef.current === id ? null : id);
  }, [setFollow]);

  // While following: keep the camera over the satellite at the current zoom, show its coverage
  // footprint, and draw its ground track (redrawn once simulated time moves away from it).
  useEffect(() => {
    if (followId === null) return;
    let frame = 0;
    let trackCenterMs = -Infinity;
    const step = () => {
      const sat = selectedSatsRef.current.find((s) => s.satelliteId === followIdRef.current);
      const nowMs = clock.nowMs();
      const geo = sat ? propagateToGeodetic(sat.satrec, new Date(nowMs)) : null;
      const globe = globeRef.current;
      if (sat && geo && globe) {
        globe.pointOfView({ lat: geo.lat, lng: geo.lng, altitude: globe.pointOfView().altitude }, 0);
        coverageRef.current?.show(geo.lat, geo.lng, geo.alt, sat.color);
        if (Math.abs(nowMs - trackCenterMs) > GROUND_TRACK_RECENTER_MS) {
          trackCenterMs = nowMs;
          setGroundTrack(computeGroundTrack(sat.satrec, sat.color, nowMs));
        }
      }
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(frame);
      coverageRef.current?.hide();
      setGroundTrack([]);
    };
  }, [followId, clock]);

  // Dragging the globe while following hands the camera back to the user (zooming doesn't).
  useEffect(() => {
    const el = containerRef.current;
    if (followId === null || !el) return;
    let start: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => { start = { x: e.clientX, y: e.clientY }; };
    const onMove = (e: PointerEvent) => {
      if (!start || e.buttons === 0) return;
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > 5) setFollow(null);
    };
    const onUp = () => { start = null; };
    el.addEventListener("pointerdown", onDown, { passive: true });
    el.addEventListener("pointermove", onMove, { passive: true });
    el.addEventListener("pointerup", onUp, { passive: true });
    return () => {
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
    };
  }, [followId, setFollow]);

  const runClustering = useCallback(async (payload: ClusterRunPayload) => {
    const tles = satTlesRef.current;
    if (tles.length < 2) return;
    if (payload.algorithm === "kmeans" && payload.k < 2) return;
    setClusteringBusy(true);
    setClusterError(null);
    try {
      const now = clock.now();
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

      const body =
        payload.algorithm === "kmeans"
          ? {
              algorithm: "kmeans" as const,
              k: Math.min(payload.k, points.length),
              points,
            }
          : payload.algorithm === "dbscan"
            ? {
                algorithm: "dbscan" as const,
                dbscanEps: payload.eps,
                dbscanMinSamples: Math.min(payload.minSamples, points.length),
                points,
              }
            : {
                algorithm: "isolation_forest" as const,
                isolationContamination: payload.contamination,
                points,
              };

      const resp = await fetchClusterAnalytics(body);
      const map = new Map<number, number>();
      points.forEach((p, i) => map.set(p.satelliteId, resp.labels[i] ?? 0));
      clusterBySatIdRef.current = map;
      const resolvedAlgo = (resp.algorithm ?? payload.algorithm) as ClusterAlgorithm;
      clusterAlgorithmRef.current = resolvedAlgo;
      const sizes: Record<number, number> = {};
      resp.labels.forEach((label) => {
        sizes[label] = (sizes[label] ?? 0) + 1;
      });
      setClusterSummary({
        algorithm: resolvedAlgo,
        nClusters: resp.nClusters,
        inertia: resp.inertia ?? null,
        sizes,
        noiseCount: resp.noiseCount ?? null,
        paramsLine: formatClusterParamsLine(payload),
      });
      propagateAllRef.current(tles, true);
    } catch (e) {
      console.error(e);
      setClusterError(e instanceof Error ? e.message : "Clustering request failed");
    } finally {
      setClusteringBusy(false);
    }
  }, [clock]);

  const clearClustering = useCallback(() => {
    clusterBySatIdRef.current = null;
    clusterAlgorithmRef.current = null;
    setClusterSummary(null);
    setClusterError(null);
    propagateAllRef.current(satTlesRef.current, true);
  }, []);

  const handleSearchSelect = useCallback((sat: any) => {
    const satrec = satellite.twoline2satrec(sat.line1, sat.line2);
    if (!satrec) return;
    satTlesRef.current = [{ satelliteId: sat.satelliteId, name: sat.name, satrec, line1: sat.line1, line2: sat.line2 }];
    setTleVersion((v) => v + 1);
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
      const now = new Date(clock.nowMs() + (clock.paused ? 0 : SEARCH_TICK_MS * KEYFRAME_LEAD * clock.rate));
      const sats: Sat[] = [];
      for (const s of tles) {
        const geo = propagateToGeodetic(s.satrec, now);
        if (geo) sats.push({ satelliteId: s.satelliteId, name: s.name, latitude: geo.lat, longitude: geo.lng, altitudeKm: geo.alt });
      }
      const points = sats.map(s => ({ ...s, color: satColor(s.satelliteId, s.altitudeKm) }));
      const altitudeCounts = ALTITUDE_BANDS.map(() => 0);
      for (const s of sats) altitudeCounts[altitudeBandIndex(s.altitudeKm)]++;
      statsStore.set({ count: sats.length, altitudeCounts, lastUpdated: clock.now().toLocaleTimeString() });
      satelliteLayerRef.current?.setKeyframe(keyframeFromPoints(points), now.getTime(), { snap: firstTick });
      firstTick = false;
      searchPropTimerRef.current = window.setTimeout(tick, SEARCH_TICK_MS);
    };
    let firstTick = true;
    tick();
  }, [satColor, clock, statsStore]);

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

    controls.autoRotate = rotationSpeed > 0 && followId === null; // following drives the camera itself
    controls.autoRotateSpeed = rotationSpeed * 2;
  }, [globeInitialized, rotationSpeed, followId]);

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

  // Every floating panel, placed by the dock for the current layout.
  const dockPanels: DockPanel[] = [
    {
      id: "filter",
      label: "Filter",
      icon: MdTune,
      zone: "left-top",
      content: (
        <LuneGlobePanel
          docked
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
          statsStore={statsStore}
          satCount={satCount}
          dataSource={dataSource}
          tleUpdatedAt={tleUpdatedAt}
          loading={loading}
        />
      ),
    },
    {
      id: "satellites",
      label: "Satellites",
      icon: MdSatelliteAlt,
      zone: "right",
      badge: selectedSats.length || undefined,
      empty: selectedSats.length === 0,
      emptyText: "Tap a satellite on the globe to select it: tap once to see its name, again to select it.",
      content: (
        <SelectedSatellitesPanel
          docked
          selectedSats={selectedSats}
          maxSelected={MAX_SELECTED}
          followId={followId}
          onToggleFollow={toggleFollow}
          onRemoveSat={removeSat}
          onClearAll={clearAll}
          onCopyLink={mode === "satellite-tracker" ? copyShareLink : undefined}
          getNow={getNow}
          observer={observer}
          onObserverChange={setObserver}
          onShowPass={showPass}
        />
      ),
    },
    ...(mode === "satellite-tracker"
      ? ([
          {
            id: "colour",
            label: "Colour",
            icon: MdPalette,
            zone: "right",
            pinBottom: true,
            content: (
              <WithStats store={statsStore}>
                {(stats) => (
                  <OrbitalViewPanel
                    docked
                    altitudeBands={ALTITUDE_BANDS}
                    shownCount={stats.count}
                    altitudeCounts={stats.altitudeCounts}
                    satCount={satCount}
                    colorMode={colorMode}
                    onColorModeChange={setColorMode}
                    legend={colorLegend}
                  />
                )}
              </WithStats>
            ),
          },
          { id: "time", label: "Time", icon: MdSchedule, zone: "left-bottom", content: <TimeControls clock={clock} /> },
        ] satisfies DockPanel[])
      : ([
          {
            id: "analytics",
            label: "Analytics",
            icon: MdInsights,
            zone: "sidebar",
            sidebarWidth: ANALYTICS_PANEL_WIDTH_PX,
            content: (
              <WithStats store={statsStore}>
                {(stats) => (
                  <OrbitalAnalyticsPanel
                    variant={isPhone ? "sheet" : "sidebar"}
                    satelliteSampleCount={stats.count}
                    satelliteTotalCount={satCount}
                    loadingCatalog={loading}
                    clusteringBusy={clusteringBusy}
                    clusterError={clusterError}
                    clusterSummary={clusterSummary}
                    onRunClustering={(payload) => void runClustering(payload)}
                    onClearClustering={clearClustering}
                  />
                )}
              </WithStats>
            ),
          },
        ] satisfies DockPanel[])),
    {
      id: "view",
      label: "View",
      icon: MdLayers,
      zone: "left-bottom",
      content: (
        <VisualizationPanel
          docked
          rightGutterPx={analyticsOpen ? ANALYTICS_PANEL_WIDTH_PX : 0}
          isDayMode={isDayMode}
          showAtmosphere={showAtmosphere}
          showGraticules={showGraticules}
          showBorders={showBorders}
          showClouds={showClouds}
          dayNight={dayNightEnabled}
          onToggleDayNight={() => setDayNightEnabled((v) => !v)}
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
      ),
    },
  ];

  return (
    <div
      style={{
        position: "relative",
        width: "100vw",
        height: "100vh",
        overflow: "hidden",
        paddingRight: analyticsOpen ? ANALYTICS_PANEL_WIDTH_PX : 0,
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

      {/* On phones the globe sits between the top bar and the tab bar / open sheet, so it stays centred. */}
      <div
        style={
          isPhone
            ? { position: "absolute", zIndex: 1, left: 0, right: 0, top: PHONE_TOP_BAR_PX, bottom: bottomInset }
            : { position: "relative", zIndex: 1, width: "100%", height: "100%" }
        }
      >
        <GlobeCanvas containerRef={containerRef} />
      </div>

      <Navbar
        current={mode === "orbital-intelligence" ? "orbital-intelligence" : "satellite-tracker"}
        compact={layout.compactNav}
        status={isPhone ? <PhoneStatus store={statsStore} clock={clock} /> : undefined}
      />

      <PanelDock
        mode={layout.mode}
        panels={dockPanels}
        collapsed={collapsed}
        onToggleCollapsed={toggleCollapsed}
        sheet={sheet}
        onSheetChange={setSheet}
        onBottomInsetChange={setBottomInset}
        topInset={layout.compactNav && !isPhone ? 52 : 0}
      />

      {/* Error toast – bottom left */}
      {errorMsg && (
        <div
          style={{
            position: "absolute",
            bottom: isPhone ? bottomInset + 12 : 20,
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

