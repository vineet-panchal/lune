"use client";

import { useEffect, useRef } from "react";
import * as satellite from "satellite.js";
import { inEarthShadow, sunEci, type Observer } from "../../lib/passes";
import { isPlausibleAltitude } from "../../lib/propagateBatch";
import type { SimClock } from "../../lib/simClock";
import type { SkyLayers } from "../../lib/sky/celestialSphereLayer";
import { constellationAt, starLabel, type SkyData } from "../../lib/sky/skyData";
import {
  bvToCss,
  equatorialToHorizontal,
  horizontalToEquatorial,
  localSiderealRad,
  solarSystemBodies,
  starsToHorizontal,
  sunAltitudeDeg,
  type SkyBody,
} from "../../lib/sky/skyMath";

/**
 * "My sky": the whole sky above the observer as a round chart, zenith in the centre and the horizon at the edge.
 * North is up and east is on the left, as on a printed star chart held overhead. Stereographic projection, so
 * constellations keep their shapes. Satellites move across it in real (simulated) time.
 */
export type DomeSatellite = { satelliteId: number; name: string; satrec: satellite.SatRec };

type SkyDomeProps = {
  data: SkyData;
  observer: Observer;
  clock: SimClock;
  layers: SkyLayers;
  highlight: number | null;
  onSelect: (constellation: number | null) => void;
  satellites: DomeSatellite[];
  /** Space taken at the top by the navbar: the dome is centred in what's left. */
  topInsetPx?: number;
};

const DEG = Math.PI / 180;
const FONT = "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
const MARGIN_PX = 30;
const PICK_PX = 9;
const MAX_ZOOM = 8;
const BODY_REFRESH_MS = 1000;
/** Satellites show a short tail: where they were this long ago. */
const TAIL_SECONDS = 20;
const BOUNDARY_STEP_DEG = 2;
/** With this few satellites above the horizon, all of them are named (otherwise only the visible ones). */
const LABEL_ALL_SATELLITES_BELOW = 25;

type Projected = { x: number; y: number; r: number };
type Hover = { text: string; x: number; y: number } | null;

export default function SkyDome({ data, observer, clock, layers, highlight, onSelect, satellites, topInsetPx = 0 }: SkyDomeProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  // Props the animation loop reads each frame (kept in a ref so the loop isn't restarted on every change).
  const live = useRef({ observer, layers, highlight, satellites, onSelect });
  live.current = { observer, layers, highlight, satellites, onSelect };
  const topInsetRef = useRef(topInsetPx);
  topInsetRef.current = topInsetPx;

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
    const stars = data.stars;
    const starAlt = new Float32Array(stars.count);
    const starAz = new Float32Array(stars.count);
    const starXY = new Float32Array(stars.count * 2);

    // Figure and boundary vertices as flat RA/Dec lists, projected each frame.
    const figure: { c: number; a: [number, number]; b: [number, number] }[] = [];
    data.constellations.forEach((c, ci) => {
      for (const line of c.lines) for (let k = 1; k < line.length; k++) figure.push({ c: ci, a: line[k - 1], b: line[k] });
    });
    const boundary: { c: number; pts: [number, number][] }[] = data.constellations.flatMap((c, ci) =>
      c.bounds.map((ring) => ({ c: ci, pts: subdivideRing(ring) }))
    );
    const ecliptic: [number, number][] = [];
    for (let lon = 0; lon <= 360; lon += 3) {
      const l = lon * DEG;
      const e = 23.4393 * DEG;
      ecliptic.push([Math.atan2(Math.sin(l) * Math.cos(e), Math.cos(l)) / DEG, Math.asin(Math.sin(e) * Math.sin(l)) / DEG]);
    }

    // View: zoom about a point, and pan (in CSS pixels).
    let zoom = 1;
    let panX = 0;
    let panY = 0;
    let width = 0;
    let height = 0;
    let radius = 1;
    /** Centre of the dome before panning: below the navbar, in the middle of the rest. */
    let centerY = 0;
    const resize = () => {
      width = wrap.clientWidth;
      height = wrap.clientHeight;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const top = Math.min(topInsetRef.current, height / 3);
      centerY = top + (height - top) / 2;
      radius = Math.max(40, Math.min(width, height - top) / 2 - MARGIN_PX);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    /** Altitude / azimuth → screen. r is the distance from the zenith in dome radii (1 = horizon). */
    const project = (altDeg: number, azDeg: number): Projected => {
      const r = Math.tan(((90 - altDeg) * DEG) / 2); // stereographic, horizon at 1
      const az = azDeg * DEG;
      return {
        x: width / 2 + panX + zoom * radius * -r * Math.sin(az),
        y: centerY + panY + zoom * radius * -r * Math.cos(az),
        r,
      };
    };
    /** Screen → altitude / azimuth (the inverse of project), or null past the edge of the projection. */
    const unproject = (x: number, y: number): { altDeg: number; azDeg: number } | null => {
      const dx = (x - width / 2 - panX) / (zoom * radius);
      const dy = (y - centerY - panY) / (zoom * radius);
      const r = Math.hypot(dx, dy);
      const alt = 90 - (2 * Math.atan(r)) / DEG;
      const az = (Math.atan2(-dx, -dy) / DEG + 360) % 360;
      return alt < -60 ? null : { altDeg: alt, azDeg: az };
    };

    let bodies: SkyBody[] = [];
    let bodiesAt = -Infinity;
    let bodiesFor: Observer | null = null;
    type SatState = { s: DomeSatellite; x: number; y: number; altDeg: number; azDeg: number; sunlit: boolean; tail: Projected | null };
    let satStates: SatState[] = [];
    let hover: Hover = null;
    let pointer: { x: number; y: number } | null = null;

    const draw = () => {
      const { observer: obs, layers: lay, highlight: hl, satellites: sats } = live.current;
      const ms = clock.nowMs();
      const lst = localSiderealRad(ms, obs.lngDeg);
      const sunAlt = sunAltitudeDeg(obs, ms);
      const cx = width / 2 + panX;
      const cy = centerY + panY;
      const R = zoom * radius;

      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = "#03050a";
      ctx.fillRect(0, 0, width, height);

      // Sky: dark navy at night, blue in daytime, a twilight glow in between.
      const day = Math.max(0, Math.min(1, (sunAlt + 12) / 18));
      const sky = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
      sky.addColorStop(0, mix([4, 7, 18], [40, 90, 160], day));
      sky.addColorStop(1, mix([12, 20, 42], [90, 140, 200], day));
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.fillStyle = sky;
      ctx.fill();
      ctx.clip();

      // Altitude rings (30°, 60°) and the zenith.
      ctx.strokeStyle = "rgba(140,170,220,0.12)";
      ctx.setLineDash([3, 5]);
      ctx.lineWidth = 1;
      for (const alt of [30, 60]) {
        ctx.beginPath();
        ctx.arc(cx, cy, R * Math.tan(((90 - alt) * DEG) / 2), 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.setLineDash([]);

      const starVisibility = 1 - day * 0.85; // stars fade into the daylight (still faintly drawn to keep bearings)

      if (lay.bounds) {
        ctx.strokeStyle = "rgba(110,125,160,0.28)";
        ctx.lineWidth = 0.8;
        for (const { pts } of boundary) strokePath(pts, lst, obs.latDeg);
      }
      if (hl !== null) {
        ctx.strokeStyle = "rgba(127,220,255,0.55)";
        ctx.lineWidth = 1.2;
        for (const b of boundary) if (b.c === hl) strokePath(b.pts, lst, obs.latDeg);
      }
      if (lay.ecliptic) {
        ctx.strokeStyle = "rgba(201,165,74,0.45)";
        ctx.setLineDash([6, 5]);
        ctx.lineWidth = 1;
        strokePath(ecliptic, lst, obs.latDeg);
        ctx.setLineDash([]);
      }

      if (lay.lines) {
        ctx.lineWidth = 1;
        for (const pass of [false, true]) {
          ctx.strokeStyle = pass ? "rgba(140,230,255,0.95)" : `rgba(90,125,195,${0.7 * starVisibility + 0.2})`;
          ctx.lineWidth = pass ? 1.6 : 1;
          ctx.beginPath();
          for (const seg of figure) {
            if ((seg.c === hl) !== pass) continue;
            const a = equatorialToHorizontal(seg.a[0], seg.a[1], obs.latDeg, lst);
            const b = equatorialToHorizontal(seg.b[0], seg.b[1], obs.latDeg, lst);
            if (a.altDeg < -20 && b.altDeg < -20) continue;
            const pa = project(a.altDeg, a.azDeg);
            const pb = project(b.altDeg, b.azDeg);
            ctx.moveTo(pa.x, pa.y);
            ctx.lineTo(pb.x, pb.y);
          }
          ctx.stroke();
        }
      }

      // Stars, faint ones as small squares (cheap), bright ones as glowing discs.
      starsToHorizontal(stars, obs.latDeg, lst, starAlt, starAz);
      const sizeBoost = Math.pow(zoom, 0.35);
      for (let i = 0; i < stars.count; i++) {
        const p = project(starAlt[i], starAz[i]);
        starXY[i * 2] = p.x;
        starXY[i * 2 + 1] = p.y;
        if (starAlt[i] < -1) continue;
        const mag = stars.mag[i];
        const size = Math.max(0.7, (6.4 - mag) * 0.62) * sizeBoost;
        const alpha = Math.min(1, Math.max(0.3, 1.1 - (mag - 1) * 0.14)) * starVisibility;
        if (size < 1.6) {
          ctx.fillStyle = bvToCss(stars.bv[i], alpha);
          ctx.fillRect(p.x - size / 2, p.y - size / 2, size, size);
        } else {
          const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, size * 1.6);
          g.addColorStop(0, bvToCss(stars.bv[i], alpha));
          g.addColorStop(0.35, bvToCss(stars.bv[i], alpha * 0.6));
          g.addColorStop(1, bvToCss(stars.bv[i], 0));
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(p.x, p.y, size * 1.6, 0, Math.PI * 2);
          ctx.fill();
        }
        if (lay.starNames && stars.name[i] && mag < 1.6 + Math.log2(zoom)) {
          ctx.fillStyle = `rgba(235,238,245,${0.75 * starVisibility + 0.15})`;
          ctx.font = `10px ${FONT}`;
          ctx.textAlign = "left";
          ctx.fillText(stars.name[i], p.x + size + 3, p.y + 3);
        }
      }

      if (lay.labels) {
        ctx.textAlign = "center";
        data.constellations.forEach((c, ci) => {
          const h = equatorialToHorizontal(c.center[0], c.center[1], obs.latDeg, lst);
          if (h.altDeg < 2) return;
          if (c.rank >= 3 && zoom < 1.5 && ci !== hl) return; // faint ones once zoomed in, to keep the chart readable
          const p = project(h.altDeg, h.azDeg);
          const isHl = ci === hl;
          ctx.font = `${isHl ? "bold 12px" : "11px"} ${FONT}`;
          ctx.fillStyle = isHl ? "rgba(160,235,255,1)" : `rgba(150,175,225,${0.75 * starVisibility + 0.2})`;
          ctx.fillText(c.name.toUpperCase(), p.x, p.y);
        });
      }

      // Sun, Moon and planets.
      if (lay.bodies) {
        if (performance.now() - bodiesAt > BODY_REFRESH_MS || bodiesFor !== obs) {
          bodies = solarSystemBodies(ms, obs);
          bodiesAt = performance.now();
          bodiesFor = obs;
        }
        for (const b of bodies) {
          const h = equatorialToHorizontal(b.raDeg, b.decDeg, obs.latDeg, lst);
          if (h.altDeg < -1) continue;
          const p = project(h.altDeg, h.azDeg);
          const size = b.id === "sun" ? 9 : b.id === "moon" ? 8 : Math.max(2.2, 4 - b.mag * 0.5);
          const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, size * 2.4);
          g.addColorStop(0, b.color);
          g.addColorStop(0.4, b.color);
          g.addColorStop(1, "rgba(0,0,0,0)");
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(p.x, p.y, size * 2.4, 0, Math.PI * 2);
          ctx.fill();
          if (b.id === "moon" && b.phase !== undefined) drawMoonPhase(ctx, p.x, p.y, size, b.phase);
          ctx.fillStyle = b.color;
          ctx.font = `11px ${FONT}`;
          ctx.textAlign = "left";
          ctx.fillText(b.id === "moon" && b.phase !== undefined ? `Moon ${Math.round(b.phase * 100)}%` : b.name, p.x + size + 5, p.y + 4);
        }
      }

      // Satellites: bright while sunlit against a dark sky (what you'd actually see), dim in Earth's shadow.
      const date = new Date(ms);
      const gmst = satellite.gstime(date);
      const tailDate = new Date(ms - TAIL_SECONDS * 1000);
      const tailGmst = satellite.gstime(tailDate);
      const sun = sunEci(ms);
      const gd = { latitude: obs.latDeg * DEG, longitude: obs.lngDeg * DEG, height: obs.heightKm ?? 0 };
      const dark = sunAlt < -6;
      satStates = [];
      for (const s of sats) {
        const pv = satellite.propagate(s.satrec, date);
        if (!pv || !pv.position || typeof pv.position === "boolean") continue;
        if (!isPlausibleAltitude(satellite.eciToGeodetic(pv.position, gmst).height, s.satrec)) continue;
        const look = satellite.ecfToLookAngles(gd, satellite.eciToEcf(pv.position, gmst));
        const altDeg = look.elevation / DEG;
        if (altDeg < 0) continue;
        const azDeg = look.azimuth / DEG;
        const p = project(altDeg, azDeg);
        const sunlit = !inEarthShadow(pv.position, sun);
        let tail: Projected | null = null;
        const tpv = satellite.propagate(s.satrec, tailDate);
        if (tpv && tpv.position && typeof tpv.position !== "boolean") {
          const tl = satellite.ecfToLookAngles(gd, satellite.eciToEcf(tpv.position, tailGmst));
          tail = project(tl.elevation / DEG, tl.azimuth / DEG);
        }
        satStates.push({ s, x: p.x, y: p.y, altDeg, azDeg, sunlit, tail });
      }
      for (const st of satStates) {
        const bright = st.sunlit && dark;
        const color = bright ? "rgba(255,244,200,1)" : st.sunlit ? "rgba(200,215,240,0.75)" : "rgba(130,140,160,0.55)";
        if (st.tail) {
          const g = ctx.createLinearGradient(st.tail.x, st.tail.y, st.x, st.y);
          g.addColorStop(0, "rgba(0,0,0,0)");
          g.addColorStop(1, color);
          ctx.strokeStyle = g;
          ctx.lineWidth = bright ? 1.6 : 1;
          ctx.beginPath();
          ctx.moveTo(st.tail.x, st.tail.y);
          ctx.lineTo(st.x, st.y);
          ctx.stroke();
        }
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(st.x, st.y, bright ? 3.2 : 2.4, 0, Math.PI * 2);
        ctx.fill();
        // Name the satellites when there are few, and any you could actually see right now.
        if (bright || satStates.length <= LABEL_ALL_SATELLITES_BELOW) {
          ctx.fillStyle = color;
          ctx.font = `10px ${FONT}`;
          ctx.textAlign = "left";
          ctx.fillText(shortName(st.s.name), st.x + 5, st.y - 5);
        }
      }
      ctx.restore();

      // Ground below the horizon, the horizon line and compass points.
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, width, height);
      ctx.arc(cx, cy, R, 0, Math.PI * 2, true);
      ctx.fillStyle = "rgba(3,5,10,0.92)";
      ctx.fill("evenodd");
      ctx.restore();
      ctx.strokeStyle = "rgba(160,190,235,0.45)";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.stroke();
      ctx.font = `bold 12px ${FONT}`;
      ctx.textAlign = "center";
      for (const [label, az] of [["N", 0], ["E", 90], ["S", 180], ["W", 270]] as const) {
        const p = project(-4, az);
        ctx.fillStyle = label === "N" ? "#ff8a80" : "rgba(200,215,240,0.85)";
        ctx.fillText(label, p.x, p.y + 4);
      }

      // Pointer: the nearest object, else the constellation under it.
      hover = null;
      if (pointer) hover = describeAt(pointer.x, pointer.y, lst, obs);
      const tip = tooltipRef.current;
      if (tip) {
        if (hover) {
          tip.textContent = hover.text;
          tip.style.left = `${Math.min(hover.x + 14, width - 240)}px`;
          tip.style.top = `${hover.y + 14}px`;
          tip.style.display = "block";
        } else {
          tip.style.display = "none";
        }
      }
    };

    /** Draw a polyline of RA/Dec points (for boundaries and the ecliptic), breaking it well below the horizon. */
    function strokePath(pts: [number, number][], lst: number, latDeg: number) {
      ctx.beginPath();
      let pen = false;
      for (const [ra, dec] of pts) {
        const h = equatorialToHorizontal(ra, dec, latDeg, lst);
        if (h.altDeg < -30) {
          pen = false;
          continue;
        }
        const p = project(h.altDeg, h.azDeg);
        if (pen) ctx.lineTo(p.x, p.y);
        else ctx.moveTo(p.x, p.y);
        pen = true;
      }
      ctx.stroke();
    }

    function describeAt(x: number, y: number, lst: number, obs: Observer): Hover {
      const sky = unproject(x, y);
      if (!sky || sky.altDeg < 0) return null;
      const near = (px: number, py: number) => Math.hypot(px - x, py - y) < PICK_PX;
      const inConstellation = (raDeg: number, decDeg: number) => {
        const ci = constellationAt(data, raDeg, decDeg);
        return ci === null ? "" : ` · in ${data.constellations[ci].name}`;
      };
      for (const st of satStates) {
        if (!near(st.x, st.y)) continue;
        const eq = horizontalToEquatorial(st.altDeg, st.azDeg, obs.latDeg, lst);
        return {
          text: `${st.s.name}${inConstellation(eq.raDeg, eq.decDeg)} · ${Math.round(st.altDeg)}° up · ${st.sunlit ? "sunlit" : "in Earth's shadow"}`,
          x,
          y,
        };
      }
      if (live.current.layers.bodies) {
        for (const b of bodies) {
          const h = equatorialToHorizontal(b.raDeg, b.decDeg, obs.latDeg, lst);
          const p = project(h.altDeg, h.azDeg);
          if (h.altDeg >= 0 && near(p.x, p.y)) return { text: `${b.name}${inConstellation(b.raDeg, b.decDeg)} · ${Math.round(h.altDeg)}° up`, x, y };
        }
      }
      let best = -1;
      let bestD = PICK_PX * PICK_PX;
      for (let i = 0; i < stars.count; i++) {
        if (starAlt[i] < 0) continue;
        const dx = starXY[i * 2] - x;
        const dy = starXY[i * 2 + 1] - y;
        const d = dx * dx + dy * dy - (stars.mag[i] < 2 ? 20 : 0); // bright stars win ties
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      if (best >= 0) {
        const c = data.constellations[stars.constellation[best]];
        return { text: `${starLabel(data, best)} · mag ${stars.mag[best].toFixed(1)}${c ? ` · in ${c.name}` : ""} · ${Math.round(starAlt[best])}° up`, x, y };
      }
      const eq = horizontalToEquatorial(sky.altDeg, sky.azDeg, obs.latDeg, lst);
      const ci = constellationAt(data, eq.raDeg, eq.decDeg);
      return ci === null ? null : { text: data.constellations[ci].name, x, y };
    }

    let frame = requestAnimationFrame(function loop() {
      draw();
      frame = requestAnimationFrame(loop);
    });

    // ── Pan, zoom, select ──
    let drag: { x: number; y: number; panX: number; panY: number; moved: boolean } | null = null;
    const local = (e: { clientX: number; clientY: number }) => {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };
    const zoomAt = (x: number, y: number, factor: number) => {
      const next = Math.max(1, Math.min(MAX_ZOOM, zoom * factor));
      const k = next / zoom;
      // Keep the point under the pointer fixed.
      panX = (panX + width / 2 - x) * k - width / 2 + x;
      panY = (panY + centerY - y) * k - centerY + y;
      zoom = next;
      if (zoom === 1) panX = panY = 0;
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = local(e);
      zoomAt(p.x, p.y, Math.exp(-e.deltaY * 0.0015));
    };
    const onDown = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId);
      drag = { ...local(e), panX, panY, moved: false };
    };
    const onMove = (e: PointerEvent) => {
      const p = local(e);
      pointer = e.pointerType === "touch" ? null : p;
      if (!drag) return;
      const dx = p.x - drag.x;
      const dy = p.y - drag.y;
      if (Math.hypot(dx, dy) > 4) drag.moved = true;
      if (drag.moved && zoom > 1) {
        panX = drag.panX + dx;
        panY = drag.panY + dy;
      }
    };
    const onUp = (e: PointerEvent) => {
      const wasDrag = drag?.moved;
      drag = null;
      if (wasDrag) return;
      const p = local(e);
      const sky = unproject(p.x, p.y);
      if (!sky || sky.altDeg < 0) return;
      const { observer: obs, onSelect: select } = live.current;
      const eq = horizontalToEquatorial(sky.altDeg, sky.azDeg, obs.latDeg, localSiderealRad(clock.nowMs(), obs.lngDeg));
      select(constellationAt(data, eq.raDeg, eq.decDeg));
    };
    const onLeave = () => {
      pointer = null;
    };
    const onDouble = () => {
      zoom = 1;
      panX = panY = 0;
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointerleave", onLeave);
    canvas.addEventListener("dblclick", onDouble);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("dblclick", onDouble);
    };
  }, [data, clock]);

  return (
    <div ref={wrapRef} style={{ position: "absolute", inset: 0, overflow: "hidden", background: "#03050a" }}>
      <canvas ref={canvasRef} style={{ display: "block", touchAction: "none", cursor: "crosshair" }} />
      <div
        ref={tooltipRef}
        style={{
          position: "absolute",
          display: "none",
          pointerEvents: "none",
          padding: "4px 8px",
          borderRadius: 4,
          background: "rgba(0,0,0,0.8)",
          color: "#fff",
          font: `12px ${FONT}`,
          whiteSpace: "nowrap",
          zIndex: 5,
        }}
      />
    </div>
  );
}

/** "ISS (ZARYA)" → "ISS", "CSS (TIANHE)" → "CSS": the short form fits beside a moving dot. */
function shortName(name: string): string {
  return name.replace(/\s*\(.*\)\s*$/, "") || name;
}

function mix(a: [number, number, number], b: [number, number, number], t: number): string {
  return `rgb(${Math.round(a[0] + (b[0] - a[0]) * t)},${Math.round(a[1] + (b[1] - a[1]) * t)},${Math.round(a[2] + (b[2] - a[2]) * t)})`;
}

/** Long boundary edges follow lines of constant declination: split them so they curve on the chart. */
function subdivideRing(ring: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  for (let k = 0; k <= ring.length; k++) {
    const [ra0, dec0] = ring[k % ring.length];
    if (k === ring.length) {
      out.push([ra0, dec0]);
      break;
    }
    const [ra1, dec1] = ring[(k + 1) % ring.length];
    let dRa = ra1 - ra0;
    if (dRa > 180) dRa -= 360;
    if (dRa < -180) dRa += 360;
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dRa), Math.abs(dec1 - dec0)) / BOUNDARY_STEP_DEG));
    for (let s = 0; s < steps; s++) out.push([ra0 + (dRa * s) / steps, dec0 + ((dec1 - dec0) * s) / steps]);
  }
  return out;
}

/** The Moon's disc: dark, with the lit fraction drawn as a bright crescent or gibbous shape. */
function drawMoonPhase(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, phase: number) {
  ctx.save();
  ctx.fillStyle = "rgba(40,44,52,0.95)";
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  // Terminator as an ellipse: half-width runs from +r (new) through 0 (half) to −r (full).
  const k = 1 - 2 * phase;
  ctx.fillStyle = "#eceff1";
  ctx.beginPath();
  ctx.arc(x, y, r, -Math.PI / 2, Math.PI / 2, false);
  ctx.ellipse(x, y, Math.abs(k) * r, r, 0, Math.PI / 2, -Math.PI / 2, k > 0);
  ctx.fill();
  ctx.restore();
}
