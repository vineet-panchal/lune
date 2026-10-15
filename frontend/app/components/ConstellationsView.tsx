"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MdAutoAwesome, MdSchedule, MdTravelExplore } from "react-icons/md";
import * as satellite from "satellite.js";
import { fetchSatellites } from "../lib/api";
import { createDayNight } from "../lib/dayNight";
import { createSimClock } from "../lib/simClock";
import { createCelestialSphereLayer, type CelestialSphereLayer, type SkyHit, type SkyLayers } from "../lib/sky/celestialSphereLayer";
import { loadSkyData, starLabel, type SkyData } from "../lib/sky/skyData";
import { useLayoutMode } from "../lib/useLayoutMode";
import { useObserver } from "../lib/useObserver";
import GlobeCanvas from "./globe/GlobeCanvas";
import Navbar from "./layout/Navbar";
import PanelDock, { type DockPanel } from "./layout/PanelDock";
import ConstellationExplorer from "./panels/constellations/ConstellationExplorer";
import SkyPanel, { SATELLITE_SETS, type SatelliteSetId, type SkyView } from "./panels/constellations/SkyPanel";
import TimeControls from "./panels/TimeControls";
import SkyDome, { type DomeSatellite } from "./sky/SkyDome";

type GlobeInstance = {
  width: (w: number) => GlobeInstance;
  height: (h: number) => GlobeInstance;
  backgroundColor: (c: string) => GlobeInstance;
  globeImageUrl: (url: string) => GlobeInstance;
  bumpImageUrl: (url: string) => GlobeInstance;
  showAtmosphere: (v: boolean) => GlobeInstance;
  atmosphereAltitude: (v: number) => GlobeInstance;
  atmosphereColor: (c: string) => GlobeInstance;
  showGraticules: (v: boolean) => GlobeInstance;
  globeMaterial: () => import("three").Material;
  scene: () => import("three").Scene;
  camera: () => import("three").Camera;
  renderer: () => import("three").WebGLRenderer;
  getGlobeRadius: () => number;
  pointsData: (d: object[]) => GlobeInstance;
  pointLat: (a: string) => GlobeInstance;
  pointLng: (a: string) => GlobeInstance;
  pointAltitude: (a: number) => GlobeInstance;
  pointRadius: (a: number) => GlobeInstance;
  pointColor: (a: () => string) => GlobeInstance;
  pointLabel: (a: () => string) => GlobeInstance;
  pointOfView: {
    (): { lat: number; lng: number; altitude: number };
    (pov: { lat: number; lng: number; altitude: number }, ms?: number): GlobeInstance;
  };
  pauseAnimation: () => GlobeInstance;
  resumeAnimation: () => GlobeInstance;
  controls: () => { autoRotate: boolean; autoRotateSpeed: number };
};

const DEFAULT_LAYERS: SkyLayers = { lines: true, labels: true, starNames: true, bounds: false, ecliptic: true, bodies: true };
/** Far enough out that plenty of sky shows around the Earth. */
const DEFAULT_ALTITUDE = 4.5;
const PHONE_TOP_BAR_PX = 48;
const CAMERA_FOV_DEG = 65;
/** While the catalogue is still downloading a group for the first time, ask again this often. */
const LOADING_POLL_MS = 3000;

/**
 * Constellations page: the real night sky, as a celestial sphere around the globe or as the sky above the
 * observer, with the satellites moving across it. Share links: ?c=Ori&view=sky.
 */
export default function ConstellationsView() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const globeRef = useRef<GlobeInstance | null>(null);
  const layerRef = useRef<CelestialSphereLayer | null>(null);
  const [globeReady, setGlobeReady] = useState(false);
  const [clock] = useState(createSimClock);
  const layout = useLayoutMode();
  const isPhone = layout.mode === "phone";
  const [sheet, setSheet] = useState<string | null>(null);
  const [bottomInset, setBottomInset] = useState(0);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const [data, setData] = useState<SkyData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [view, setView] = useState<SkyView>("sphere");
  const [layers, setLayers] = useState<SkyLayers>(DEFAULT_LAYERS);
  const [selected, setSelected] = useState<number | null>(null);
  const [observer, setObserver] = useObserver();
  const [satelliteSet, setSatelliteSet] = useState<SatelliteSetId>("visual");
  const [satellites, setSatellites] = useState<DomeSatellite[]>([]);
  const [satellitesLoaded, setSatellitesLoaded] = useState(false);
  const urlReadRef = useRef(false);
  const pendingSelectRef = useRef<string | null>(null);
  /** A shared link's constellation, to turn the camera to once the sky layer is ready. */
  const pendingFlyRef = useRef<number | null>(null);

  useEffect(() => {
    loadSkyData()
      .then(setData)
      .catch((e) => setLoadError(`Couldn't load the star catalogue: ${e instanceof Error ? e.message : String(e)}`));
  }, []);

  // Share links: ?c=Ori&view=sky (read once after mount, so server and client render the defaults first).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("view") === "sky") setView("sky");
    pendingSelectRef.current = params.get("c");
    urlReadRef.current = true;
  }, []);
  useEffect(() => {
    if (!data || pendingSelectRef.current === null) return;
    const index = data.constellationIndex.get(pendingSelectRef.current);
    pendingSelectRef.current = null;
    if (index !== undefined) {
      setSelected(index);
      pendingFlyRef.current = index;
    }
  }, [data]);
  useEffect(() => {
    if (!urlReadRef.current || pendingSelectRef.current !== null) return;
    const params = new URLSearchParams();
    if (selected !== null && data) params.set("c", data.constellations[selected].id);
    if (view === "sky") params.set("view", "sky");
    const query = params.toString();
    const url = `${window.location.pathname}${query ? `?${query}` : ""}`;
    if (url !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(window.history.state, "", url);
  }, [selected, view, data]);

  // ── Globe ──
  useEffect(() => {
    let cleanup: (() => void) | undefined;
    let unmounted = false;
    (async () => {
      const el = containerRef.current;
      if (!el) return;
      const GlobeCtor = (await import("globe.gl")).default as unknown as new (el: HTMLElement) => GlobeInstance;
      if (unmounted) return;
      const globe = new GlobeCtor(el)
        .backgroundColor("#000003")
        .globeImageUrl("//unpkg.com/three-globe/example/img/earth-night.jpg")
        .bumpImageUrl("//unpkg.com/three-globe/example/img/earth-topology.png")
        .showAtmosphere(true)
        .atmosphereAltitude(0.15)
        .atmosphereColor("rgba(100, 160, 255, 0.5)")
        .showGraticules(false)
        .pointLat("lat")
        .pointLng("lng")
        .pointAltitude(0.004)
        .pointRadius(0.6)
        .pointColor(() => "#ffd54f")
        .pointLabel(() => "Your location");
      globe.pointOfView({ lat: 20, lng: 0, altitude: DEFAULT_ALTITUDE }, 0);
      // A wider view than the other pages: this page is about the sky around the Earth.
      const camera = globe.camera() as import("three").PerspectiveCamera;
      camera.fov = CAMERA_FOV_DEG;
      camera.updateProjectionMatrix();
      const controls = globe.controls();
      controls.autoRotate = false;
      // Day and night on the Earth, so it's clear where it's dark enough to see the stars.
      const dayNight = createDayNight(globe, () => clock.nowMs());
      dayNight.setEnabled(true);
      dayNight.setStyle({ paintDay: true, nightDim: 0.65 });
      const resize = () => globe.width(el.clientWidth).height(el.clientHeight);
      resize();
      const ro = new ResizeObserver(resize);
      ro.observe(el);
      globeRef.current = globe;
      setGlobeReady(true);
      cleanup = () => {
        ro.disconnect();
        dayNight.dispose();
        if (globeRef.current === globe) globeRef.current = null;
      };
    })();
    return () => {
      unmounted = true;
      cleanup?.();
    };
  }, [clock]);

  // The sky layer, once both the globe and the star data are ready.
  const selectRef = useRef(setSelected);
  useEffect(() => {
    const globe = globeRef.current;
    const el = containerRef.current;
    if (!globeReady || !globe || !el || !data) return;
    const layer = createCelestialSphereLayer(globe, el, data, {
      getTimeMs: () => clock.nowMs(),
      label: (hit) => describeHit(data, hit),
      onClick: (hit) => {
        if (hit.constellation !== null) selectRef.current(hit.constellation);
      },
    });
    layerRef.current = layer;
    if (pendingFlyRef.current !== null) {
      globe.pointOfView(layer.viewOf(pendingFlyRef.current), 0);
      pendingFlyRef.current = null;
    }
    return () => {
      layer.dispose();
      if (layerRef.current === layer) layerRef.current = null;
    };
  }, [globeReady, data, clock]);

  useEffect(() => {
    layerRef.current?.setLayers(layers);
  }, [layers, globeReady, data]);
  useEffect(() => {
    layerRef.current?.setHighlight(selected);
  }, [selected, globeReady, data]);
  useEffect(() => {
    globeRef.current?.pointsData(observer ? [{ lat: observer.latDeg, lng: observer.lngDeg }] : []);
  }, [observer, globeReady]);

  // The globe isn't visible behind My sky: stop rendering it there.
  useEffect(() => {
    const globe = globeRef.current;
    if (!globe) return;
    if (view === "sky" && observer) globe.pauseAnimation();
    else globe.resumeAnimation();
  }, [view, observer, globeReady]);

  const flyTo = useCallback((index: number) => {
    const globe = globeRef.current;
    const layer = layerRef.current;
    if (!globe || !layer) return;
    setView("sphere");
    globe.pointOfView(layer.viewOf(index), 1200);
  }, []);

  const showInSky = useCallback((index: number) => {
    setSelected(index);
    setView("sky");
  }, []);

  // ── Satellites for My sky ──
  useEffect(() => {
    let aborted = false;
    setSatellites([]);
    setSatellitesLoaded(false);
    const set = SATELLITE_SETS.find((s) => s.id === satelliteSet);
    if (!set || set.id === "none") {
      setSatellitesLoaded(true);
      return;
    }
    const opts = "group" in set ? { group: set.group } : { type: set.type };
    (async () => {
      while (!aborted) {
        const resp = await fetchSatellites(1, 20000, opts);
        if (aborted) return;
        const sats: DomeSatellite[] = (resp.satellites ?? [])
          .filter((x: { line1?: string; line2?: string }) => x?.line1 && x?.line2)
          .map((x: { satelliteId: number; name?: string; line1: string; line2: string }) => ({
            satelliteId: x.satelliteId,
            name: x.name ?? String(x.satelliteId),
            satrec: satellite.twoline2satrec(x.line1, x.line2),
          }));
        setSatellites(sats);
        if (!resp.loading) {
          setSatellitesLoaded(true);
          return;
        }
        await new Promise((r) => setTimeout(r, LOADING_POLL_MS));
      }
    })().catch((e) => {
      console.warn("[Constellations] satellites failed to load:", e);
      if (!aborted) setSatellitesLoaded(true);
    });
    return () => {
      aborted = true;
    };
  }, [satelliteSet]);

  const toggleCollapsed = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const panels: DockPanel[] = [
    {
      id: "sky",
      label: "Night Sky",
      icon: MdAutoAwesome,
      zone: "left-top",
      content: (
        <SkyPanel
          view={view}
          onViewChange={setView}
          layers={layers}
          onLayersChange={setLayers}
          satelliteSet={satelliteSet}
          onSatelliteSetChange={setSatelliteSet}
          satelliteCount={satellitesLoaded || satellites.length > 0 ? satellites.length : null}
          observer={observer}
          onObserverChange={setObserver}
          loadError={loadError}
        />
      ),
    },
    {
      id: "constellations",
      label: "Constellations",
      icon: MdTravelExplore,
      zone: "right",
      badge: selected !== null ? 1 : undefined,
      content: (
        <ConstellationExplorer
          data={data}
          selected={selected}
          onSelect={setSelected}
          onFlyTo={flyTo}
          onShowInSky={showInSky}
          view={view}
          observer={observer}
          clock={clock}
        />
      ),
    },
    { id: "time", label: "Time", icon: MdSchedule, zone: "left-bottom", content: <TimeControls clock={clock} /> },
  ];

  const globeArea = isPhone
    ? { position: "absolute" as const, zIndex: 1, left: 0, right: 0, top: PHONE_TOP_BAR_PX, bottom: bottomInset }
    : { position: "absolute" as const, zIndex: 1, inset: 0 };

  return (
    <div style={{ position: "relative", width: "100vw", height: "100vh", overflow: "hidden", background: "#000003" }}>
      <div style={globeArea}>
        <GlobeCanvas containerRef={containerRef} />
        {view === "sky" && data && observer && (
          <SkyDome
            data={data}
            observer={observer}
            clock={clock}
            layers={layers}
            highlight={selected}
            onSelect={setSelected}
            satellites={satellites}
            topInsetPx={isPhone ? 0 : 52}
          />
        )}
        {view === "sky" && !observer && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "rgba(0,0,3,0.75)",
              color: "rgba(220,228,240,0.85)",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              fontSize: 13,
              textAlign: "center",
              padding: 24,
            }}
          >
            Set your location in the Night Sky panel to see the sky above you.
          </div>
        )}
      </div>

      <Navbar current="constellations" compact={layout.compactNav} status={isPhone ? <span>{view === "sky" ? "My sky" : "Celestial sphere"}</span> : undefined} />

      <PanelDock
        mode={layout.mode}
        panels={panels}
        collapsed={collapsed}
        onToggleCollapsed={toggleCollapsed}
        sheet={sheet}
        onSheetChange={setSheet}
        onBottomInsetChange={setBottomInset}
        // Panels start below the navbar: with three panels open there isn't room beside it.
        topInset={isPhone ? 0 : 52}
      />
    </div>
  );
}

/** Hover text on the celestial sphere: the object under the pointer, else the constellation. */
function describeHit(data: SkyData, hit: SkyHit): string | null {
  const c = hit.constellation === null ? null : data.constellations[hit.constellation];
  const where = c ? ` · in ${c.name}` : "";
  if (hit.body) {
    const phase = hit.body.phase !== undefined ? ` · ${Math.round(hit.body.phase * 100)}% lit` : "";
    return `${hit.body.name}${phase}${where}`;
  }
  if (hit.star !== null) return `${starLabel(data, hit.star)} · mag ${data.stars.mag[hit.star].toFixed(1)}${where}`;
  return c ? c.name : null;
}
