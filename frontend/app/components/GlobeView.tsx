"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { fetchSatellitePositions } from "../lib/api";

type Sat = {
  satelliteId: number;
  name: string;
  latitude: number;
  longitude: number;
  altitudeKm: number;
};

type GlobeInstance = {
  width: (w: number) => GlobeInstance;
  height: (h: number) => GlobeInstance;
  backgroundColor: (c: string) => GlobeInstance;
  backgroundImageUrl: (url: string) => GlobeInstance;
  globeImageUrl: (url: string) => GlobeInstance;
  showAtmosphere: (v: boolean) => GlobeInstance;
  atmosphereAltitude: (v: number) => GlobeInstance;
  objectsData: (d: any[]) => GlobeInstance;
  objectLat: (a: any) => GlobeInstance;
  objectLng: (a: any) => GlobeInstance;
  objectAltitude: (a: any) => GlobeInstance;
  objectLabel: (a: any) => GlobeInstance;
  objectFacesSurface: (v: boolean) => GlobeInstance;
  objectThreeObject: (fn: any) => GlobeInstance;
  pointOfView: (pov: { lat: number; lng: number; altitude: number }, ms?: number) => GlobeInstance;
};

const EARTH_RADIUS_KM = 6371;

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

  // Stars
  for (let i = 0; i < stars; i++) {
    const x = Math.random() * width;
    const y = Math.random() * height;
    const r = Math.random() < 0.92 ? Math.random() * 1.2 : 1.2 + Math.random() * 1.8;
    const a = 0.3 + Math.random() * 0.7;
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

  const markerGeometry = useMemo(() => new THREE.SphereGeometry(0.8, 12, 12), []);
  const markerMaterial = useMemo(
    () => new THREE.MeshBasicMaterial({ color: 0x00e5ff }),
    []
  );

  useEffect(() => {
    const init = async () => {
      if (!containerRef.current) return;

      const GlobeCtor = (await import("globe.gl")).default as unknown as new (
        el: HTMLElement
      ) => GlobeInstance;

      const starBg = generateStarfieldDataUrl();
      const globe = new GlobeCtor(containerRef.current)
        .backgroundColor("#000008")
        .backgroundImageUrl(starBg)
        // Using the globe.gl example texture (fast to get started)
        .globeImageUrl("//unpkg.com/three-globe/example/img/earth-dark.jpg")
        .showAtmosphere(true)
        .atmosphereAltitude(0.18)
        .objectLat("latitude")
        .objectLng("longitude")
        .objectAltitude((d: any) => d.altitudeRatio)
        .objectLabel((d: any) => `${d.name} (#${d.satelliteId})`)
        .objectFacesSurface(false)
        .objectThreeObject(() => new THREE.Mesh(markerGeometry, markerMaterial))
        .objectsData([]);

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
  }, [markerGeometry, markerMaterial]);

  useEffect(() => {
    let timer: number | null = null;
    let aborted = false;

    const ids = [25544, 49260, 20580, 33591, 28654, 25338, 48274];

    const tick = async () => {
      try {
        const data = (await fetchSatellitePositions(ids)) as any[];
        if (aborted) return;
        const sats: Sat[] = (data ?? [])
          .filter((x) => typeof x?.satelliteId === "number")
          .map((x) => ({
            satelliteId: x.satelliteId,
            name: x.name ?? String(x.satelliteId),
            latitude: x.latitude,
            longitude: x.longitude,
            altitudeKm: x.altitudeKm,
          }));
        setSatellites(sats);
        setLastUpdated(new Date().toLocaleTimeString());
      } catch (e) {
        // Keep trying; network tab will show failures
        // eslint-disable-next-line no-console
        console.error("satellite update failed", e);
      } finally {
        timer = window.setTimeout(tick, 1000);
      }
    };

    tick();
    return () => {
      aborted = true;
      if (timer) window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (!globeRef.current) return;
    const objects = satellites.map((s) => ({
      ...s,
      altitudeRatio: Math.max(0, Math.min(0.5, (s.altitudeKm ?? 0) / EARTH_RADIUS_KM)),
    }));
    globeRef.current.objectsData(objects);
  }, [satellites]);

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
        <div>Satellites: {satellites.length}</div>
        <div>Update: {lastUpdated ?? "--"}</div>
        <div style={{ marginTop: 6, color: "rgba(255,255,255,0.75)" }}>
          Tip: open DevTools → Network → Fetch/XHR to see the live polling.
        </div>
      </div>
    </div>
  );
}

