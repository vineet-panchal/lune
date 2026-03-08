"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { fetchSatellites, fetchSatellitePositions, fetchSatelliteTrail } from "../lib/api";
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

/** Convert ECI (km) + datetime → geodetic lat/lng/alt */
function eciToGeodetic(x: number, y: number, z: number, datetime: string) {
  const d = new Date(datetime);
  const jd = d.getTime() / 86400000 + 2440587.5;
  const T = (jd - 2451545.0) / 36525;
  let gmst =
    280.46061837 +
    360.98564736629 * (jd - 2451545.0) +
    0.000387933 * T * T -
    (T * T * T) / 38710000;
  gmst = ((gmst % 360) + 360) % 360;
  const gmstRad = (gmst * Math.PI) / 180;

  const xEcef = x * Math.cos(gmstRad) + y * Math.sin(gmstRad);
  const yEcef = -x * Math.sin(gmstRad) + y * Math.cos(gmstRad);
  const zEcef = z;

  const lng = (Math.atan2(yEcef, xEcef) * 180) / Math.PI;
  const lat =
    (Math.atan2(zEcef, Math.sqrt(xEcef * xEcef + yEcef * yEcef)) * 180) /
    Math.PI;
  const alt = Math.sqrt(x * x + y * y + z * z) - EARTH_RADIUS_KM;
  return { lat, lng, alt };
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

export default function GlobeView() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const globeRef = useRef<GlobeInstance | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [satellites, setSatellites] = useState<Sat[]>([]);
  const [satType, setSatType] = useState<string>("Internet");
  const [satIds, setSatIds] = useState<{ id: number; name: string }[]>([]);
  const [selectedSats, setSelectedSats] = useState<SelectedSat[]>([]);
  const [orbitPaths, setOrbitPaths] = useState<OrbitPath[]>([]);
  const [loading, setLoading] = useState(true);
  const selectedSatsRef = useRef<SelectedSat[]>([]);
  const orbitPathsRef = useRef<OrbitPath[]>([]);

  const SAT_TYPES = [
    "Internet",
    "Popular",
    "Stations",
    "Starlink",
    "OneWeb",
    "GPS",
    "GLONASS",
    "Galileo",
    "BeiDou",
    "Communications",
    "Geostationary",
    "Weather",
    "Earth Imaging",
    "Amateur",
  ];

  // Maps display label → backend params (type = CelesTrak group name, group = curated list)
  const SAT_TYPE_OPTS: Record<string, { type?: string; group?: string }> = {
    "Internet":      { type: "STARLINK" },
    "Popular":       { group: "popular" },
    "Stations":      { type: "STATIONS" },
    "Starlink":      { type: "STARLINK" },
    "OneWeb":        { type: "ONEWEB" },
    "GPS":           { type: "GPS-OPS" },
    "GLONASS":       { type: "GLO-OPS" },
    "Galileo":       { type: "GALILEO" },
    "BeiDou":        { type: "BEIDOU" },
    "Communications":{ type: "INTELSAT" },
    "Geostationary": { type: "GEO" },
    "Weather":       { type: "NOAA" },
    "Earth Imaging": { type: "RESOURCE" },
    "Amateur":       { type: "AMATEUR" },
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
        // Use a small fixed altitude so satellites render as dots, not vertical beams
        .pointAltitude(0.01)
        // .pointAltitude((d: any) => d.altitudeRatio)  // original: beam height = orbit altitude
        .pointColor((d: any) => d.color)
        .pointRadius(0.35)
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
          // Select – fetch orbit trail
          const sat: SelectedSat = {
            satelliteId: point.satelliteId,
            name: point.name,
            color: point.color,
            altitudeKm: point.altitudeKm ?? 0,
          };
          const nextSelected = [...selectedSatsRef.current, sat];
          selectedSatsRef.current = nextSelected;
          setSelectedSats(nextSelected);
          fetchSatelliteTrail(point.satelliteId, 50)
            .then((trail: any) => {
              const pts = (trail.trail ?? []).map((tp: any) =>
                eciToGeodetic(tp.x, tp.y, tp.z, tp.datetime)
              );
              const path: OrbitPath = {
                satelliteId: point.satelliteId,
                color: point.color,
                points: pts,
              };
              const nextPaths = [...orbitPathsRef.current, path];
              orbitPathsRef.current = nextPaths;
              setOrbitPaths(nextPaths);
            })
            .catch((e: any) =>
              console.error("Failed to load orbit trail", e)
            );
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

  // Fetch satellite list — paginate through ALL satellites when the type changes
  useEffect(() => {
    let aborted = false;
    setSatellites([]);
    setSatIds([]);
    setLoading(true);
    const opts = SAT_TYPE_OPTS[satType] ?? { search: satType };
    const PAGE_SIZE = 100;
    const MAX_SATELLITES = 500; // cap to keep position updates fast

    async function fetchAll() {
      let allIds: { id: number; name: string }[] = [];
      let page = 1;
      let totalItems = Infinity;

      while (allIds.length < totalItems && allIds.length < MAX_SATELLITES && !aborted) {
        const resp = await fetchSatellites(page, PAGE_SIZE, opts);
        if (aborted) return;
        const sats = (resp.satellites ?? [])
          .filter((x: any) => typeof x?.satelliteId === "number")
          .map((x: any) => ({ id: x.satelliteId, name: x.name ?? String(x.satelliteId) }));
        allIds = [...allIds, ...sats];
        totalItems = resp.totalItems ?? allIds.length;
        if (sats.length < PAGE_SIZE) break; // last page
        page++;
      }

      if (!aborted) {
        setSatIds(allIds.slice(0, MAX_SATELLITES));
      }
    }

    fetchAll().catch((e) => console.error("Failed to load satellite list", e));
    return () => { aborted = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [satType]);

  // Poll positions using the fetched IDs — chunks of 200, adaptive poll rate
  useEffect(() => {
    if (satIds.length === 0) return;
    let timer: number | null = null;
    let aborted = false;
    const ids = satIds.map((s) => s.id);
    const nameMap = Object.fromEntries(satIds.map((s) => [s.id, s.name]));
    const CHUNK_SIZE = 200;
    // Adaptive poll: more satellites → slower poll to avoid overloading
    const pollInterval = ids.length > 200 ? 15000 : ids.length > 50 ? 10000 : 5000;

    const tick = async () => {
      try {
        // Chunk IDs into batches
        const chunks: number[][] = [];
        for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
          chunks.push(ids.slice(i, i + CHUNK_SIZE));
        }
        const results = await Promise.all(
          chunks.map((chunk) => fetchSatellitePositions(chunk))
        );
        if (aborted) return;
        const allData = results.flat();
        const sats: Sat[] = (allData ?? [])
          .filter((x: any) => typeof x?.satelliteId === "number")
          .map((x: any) => ({
            satelliteId: x.satelliteId,
            name: x.name ?? nameMap[x.satelliteId] ?? String(x.satelliteId),
            latitude: x.latitude,
            longitude: x.longitude,
            altitudeKm: x.altitudeKm,
          }));
        setSatellites(sats);
        setLoading(false);
        setLastUpdated(new Date().toLocaleTimeString());
      } catch (e) {
        console.error("satellite position update failed", e);
      } finally {
        if (!aborted) timer = window.setTimeout(tick, pollInterval);
      }
    };

    tick();
    return () => {
      aborted = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [satIds]);

  useEffect(() => {
    if (!globeRef.current) return;
    const SATELLITE_COLORS = ["#ff9800", "#ffeb3b", "#8bc34a", "#ff5722", "#ffc107", "#4caf50", "#ffa726"];
    const points = satellites.map((s, i) => ({
      ...s,
      altitudeRatio: Math.max(0, Math.min(0.5, (s.altitudeKm ?? 0) / EARTH_RADIUS_KM)),
      color: SATELLITE_COLORS[i % SATELLITE_COLORS.length],
    }));
    globeRef.current.pointsData(points);
  }, [satellites]);

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
        <div style={{ fontWeight: 700, marginBottom: 6 }}>Lune Globe</div>
        <div style={{ marginBottom: 8 }}>
          <label htmlFor="sat-type-select" style={{ marginRight: 8 }}>Type:</label>
          <select
            id="sat-type-select"
            value={satType}
            onChange={e => setSatType(e.target.value)}
            style={{ fontSize: 13, padding: "2px 8px", borderRadius: 6, background: "#222", color: "#fff" }}
          >
            {SAT_TYPES.map(type => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>
        </div>
        <div>Satellites: {satellites.length}{satIds.length > 0 && satellites.length < satIds.length ? ` / ${satIds.length}` : ""}</div>
        <div>Update: {lastUpdated ?? "--"}</div>
        {loading && (
          <div style={{ marginTop: 6, color: "#4fc3f7" }}>
            Loading satellite positions...
          </div>
        )}
        <div style={{ marginTop: 6, color: "rgba(255,255,255,0.75)" }}>
          Tip: click a satellite dot to show its orbit path.
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
              textAlign: "right",
              color: "rgba(255,255,255,0.4)",
              cursor: "pointer",
              fontSize: 11,
            }}
            onClick={clearAll}
          >
            clear {selectedSats.length}
          </div>
        </div>
      )}
    </div>
  );
}

