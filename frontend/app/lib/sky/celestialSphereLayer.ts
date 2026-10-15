import * as satellite from "satellite.js";
import * as THREE from "three";
import { createGlowTexture } from "../satelliteLayer";
import { polarToGlobe } from "../propagateBatch";
import { constellationAt, type SkyData } from "./skyData";
import { bvToRgb, solarSystemBodies, type SkyBody } from "./skyMath";

/**
 * The real sky around the globe: stars, constellation figures, names and boundaries, the ecliptic, and the Sun,
 * Moon and planets, turning with sidereal time (the Earth spins inside it once a sidereal day).
 *
 * Everything sits on a sphere that follows the camera, so the sky behaves as if infinitely far away (no parallax
 * when orbiting the Earth), while the Earth still hides whatever is behind it.
 *
 * Built in the equatorial frame (globe "longitude" = right ascension), then turned about the polar axis by the
 * Greenwich sidereal time each frame: on the Earth-fixed globe, a star is overhead where longitude = RA − GMST.
 */
export type SkyLayers = {
  lines: boolean;
  labels: boolean;
  bounds: boolean;
  starNames: boolean;
  ecliptic: boolean;
  bodies: boolean;
};

export type SkyHit = {
  /** Constellation under the pointer (any part of the sky belongs to one), or null over the Earth. */
  constellation: number | null;
  /** Star or Sun / Moon / planet near the pointer. */
  star: number | null;
  body: SkyBody | null;
};

export type CelestialSphereLayer = {
  setLayers: (layers: SkyLayers) => void;
  /** Draw this constellation's figure, name and boundary brighter (null: none). */
  setHighlight: (constellation: number | null) => void;
  /**
   * A camera position (globe point of view) that shows this whole constellation just above the Earth, at the globe's
   * current time.
   */
  viewOf: (constellation: number) => { lat: number; lng: number; altitude: number };
  dispose: () => void;
};

type GlobeLike = {
  scene: () => THREE.Scene;
  camera: () => THREE.Camera;
  renderer: () => THREE.WebGLRenderer;
  getGlobeRadius: () => number;
};

const SKY_RADIUS = 30_000; // inside the camera's far plane (globe.gl: 125,000)
const LABEL_PX = 12;
const STAR_LABEL_PX = 10;
/** Proper names are drawn for stars brighter than this. */
const STAR_LABEL_MAG = 1.6;
const PICK_PX = 9;
const BOUNDARY_STEP_DEG = 2;
const BODY_REFRESH_MS = 1000;
/** ...or sooner once simulated time has moved this far (fast time controls). */
const BODY_REFRESH_SIM_MS = 20 * 60_000;
const OBLIQUITY_DEG = 23.4393;
const DEG = Math.PI / 180;
const Y_AXIS = new THREE.Vector3(0, 1, 0);

const LINE_RGB = new THREE.Color(0.33, 0.47, 0.75);
const LINE_HIGHLIGHT_RGB = new THREE.Color(0.55, 0.9, 1.0);
const LABEL_COLOR = "rgba(150,175,225,0.85)";
const LABEL_FAINT_COLOR = "rgba(130,150,195,0.6)";
const LABEL_HIGHLIGHT_COLOR = "rgba(160,235,255,1)";

export function createCelestialSphereLayer(
  globe: GlobeLike,
  container: HTMLElement,
  data: SkyData,
  options: {
    getTimeMs: () => number;
    label: (hit: SkyHit) => string | null;
    onClick?: (hit: SkyHit) => void;
  }
): CelestialSphereLayer {
  const scene = globe.scene();
  const group = new THREE.Group();
  scene.add(group);
  const disposables: { dispose: () => void }[] = [];
  const track = <T extends { dispose: () => void }>(d: T) => (disposables.push(d), d);

  /** Unit-sphere direction of an RA/Dec in the group's (equatorial) frame, scaled to r. */
  const tmp = new Float32Array(3);
  const toXyz = (ra: number, dec: number, r = SKY_RADIUS): [number, number, number] => {
    polarToGlobe(dec, ra, 0, tmp, 0);
    const s = r / 100; // polarToGlobe puts altitude 0 on the globe's radius (100)
    return [tmp[0] * s, tmp[1] * s, tmp[2] * s];
  };

  // ── Stars ──
  const { stars } = data;
  const starPos = new Float32Array(stars.count * 3);
  const starUnit = new Float32Array(stars.count * 3);
  const starColor = new Float32Array(stars.count * 3);
  const starSize = new Float32Array(stars.count);
  const starAlpha = new Float32Array(stars.count);
  for (let i = 0; i < stars.count; i++) {
    const p = toXyz(stars.ra[i], stars.dec[i]);
    starPos.set(p, i * 3);
    starUnit.set([p[0] / SKY_RADIUS, p[1] / SKY_RADIUS, p[2] / SKY_RADIUS], i * 3);
    starColor.set(bvToRgb(stars.bv[i]), i * 3);
    const mag = stars.mag[i];
    starSize[i] = Math.max(2.4, 10 - 1.3 * mag);
    starAlpha[i] = Math.min(1, Math.max(0.4, 1.1 - (mag - 1) * 0.12));
  }
  const starGeometry = track(new THREE.BufferGeometry());
  starGeometry.setAttribute("position", new THREE.BufferAttribute(starPos, 3));
  starGeometry.setAttribute("color", new THREE.BufferAttribute(starColor, 3));
  starGeometry.setAttribute("size", new THREE.BufferAttribute(starSize, 1));
  starGeometry.setAttribute("alpha", new THREE.BufferAttribute(starAlpha, 1));
  const starMaterial = track(
    new THREE.ShaderMaterial({
      uniforms: { uPixelRatio: { value: globe.renderer().getPixelRatio() } },
      vertexShader: `
        attribute float size;
        attribute float alpha;
        attribute vec3 color;
        uniform float uPixelRatio;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vColor = color;
          vAlpha = alpha;
          gl_PointSize = size * uPixelRatio;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          // A bright core with a soft halo, so brighter (bigger) stars glow.
          float a = smoothstep(0.5, 0.0, d);
          a = a * a * (0.6 + 0.4 * smoothstep(0.25, 0.0, d)) * 1.6;
          gl_FragColor = vec4(vColor, min(1.0, a) * vAlpha);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
  );
  const starPoints = new THREE.Points(starGeometry, starMaterial);
  starPoints.frustumCulled = false;
  group.add(starPoints);

  // ── Constellation figures (one geometry; each constellation's vertex range is recoloured on highlight) ──
  const linePositions: number[] = [];
  const lineRanges: [number, number][] = [];
  data.constellations.forEach((c) => {
    const start = linePositions.length / 3;
    for (const line of c.lines) {
      for (let k = 1; k < line.length; k++) {
        linePositions.push(...toXyz(line[k - 1][0], line[k - 1][1]), ...toXyz(line[k][0], line[k][1]));
      }
    }
    lineRanges.push([start, linePositions.length / 3]);
  });
  const lineColors = new Float32Array(linePositions.length);
  for (let i = 0; i < lineColors.length; i += 3) LINE_RGB.toArray(lineColors, i);
  const lineGeometry = track(new THREE.BufferGeometry());
  lineGeometry.setAttribute("position", new THREE.Float32BufferAttribute(linePositions, 3));
  const lineColorAttr = new THREE.BufferAttribute(lineColors, 3);
  lineGeometry.setAttribute("color", lineColorAttr);
  const lineMaterial = track(new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.5, depthWrite: false }));
  const figureLines = new THREE.LineSegments(lineGeometry, lineMaterial);
  figureLines.frustumCulled = false;
  group.add(figureLines);

  // ── Boundaries: long edges follow lines of constant declination, so they're subdivided to stay curved ──
  const boundaryGeometryFor = (indices: number[]) => {
    const pos: number[] = [];
    for (const idx of indices) {
      for (const ring of data.constellations[idx].bounds) {
        for (let k = 0; k < ring.length; k++) {
          const [ra0, dec0] = ring[k];
          const [ra1raw, dec1] = ring[(k + 1) % ring.length];
          let dRa = ra1raw - ra0;
          if (dRa > 180) dRa -= 360;
          if (dRa < -180) dRa += 360;
          const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dRa), Math.abs(dec1 - dec0)) / BOUNDARY_STEP_DEG));
          for (let s = 0; s < steps; s++) {
            const a = s / steps;
            const b = (s + 1) / steps;
            pos.push(...toXyz(ra0 + dRa * a, dec0 + (dec1 - dec0) * a), ...toXyz(ra0 + dRa * b, dec0 + (dec1 - dec0) * b));
          }
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    return g;
  };
  const boundaryMaterial = track(new THREE.LineBasicMaterial({ color: 0x5c6b8a, transparent: true, opacity: 0.35, depthWrite: false }));
  const allBounds = new THREE.LineSegments(track(boundaryGeometryFor(data.constellations.map((_, i) => i))), boundaryMaterial);
  allBounds.frustumCulled = false;
  group.add(allBounds);
  const highlightBoundaryMaterial = track(new THREE.LineBasicMaterial({ color: 0x7fdcff, transparent: true, opacity: 0.6, depthWrite: false }));
  let highlightBounds: THREE.LineSegments | null = null;

  // ── Ecliptic: the Sun's yearly path, where the Moon and planets wander ──
  const eclipticPos: number[] = [];
  for (let lon = 0; lon <= 360; lon += 2) {
    const l = lon * DEG;
    const e = OBLIQUITY_DEG * DEG;
    const ra = Math.atan2(Math.sin(l) * Math.cos(e), Math.cos(l)) / DEG;
    const dec = Math.asin(Math.sin(e) * Math.sin(l)) / DEG;
    eclipticPos.push(...toXyz(ra, dec));
  }
  const eclipticGeometry = track(new THREE.BufferGeometry());
  eclipticGeometry.setAttribute("position", new THREE.Float32BufferAttribute(eclipticPos, 3));
  const eclipticMaterial = track(new THREE.LineDashedMaterial({ color: 0xc9a54a, dashSize: 300, gapSize: 220, transparent: true, opacity: 0.55, depthWrite: false }));
  const ecliptic = new THREE.Line(eclipticGeometry, eclipticMaterial);
  ecliptic.computeLineDistances();
  ecliptic.frustumCulled = false;
  group.add(ecliptic);

  // ── Text labels (sprites keep a constant on-screen size; rescaled when the view's height changes) ──
  type Label = { sprite: THREE.Sprite; px: number; aspect: number };
  const labels: Label[] = [];
  const makeLabel = (text: string, color: string, px: number, anchorLeft = false): Label => {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
    const scale = 2; // drawn at 2× for crisp text on high-density screens
    const font = `${px * scale}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    ctx.font = font;
    const w = Math.ceil(ctx.measureText(text).width) + 8 * scale;
    const h = Math.ceil(px * scale * 1.4);
    canvas.width = w;
    canvas.height = h;
    ctx.font = font;
    ctx.textBaseline = "middle";
    ctx.textAlign = anchorLeft ? "left" : "center";
    ctx.shadowColor = "rgba(0,0,0,0.9)";
    ctx.shadowBlur = 4 * scale;
    ctx.fillStyle = color;
    ctx.fillText(text, anchorLeft ? 4 * scale : w / 2, h / 2);
    const texture = track(new THREE.CanvasTexture(canvas));
    texture.colorSpace = THREE.SRGBColorSpace;
    const material = track(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, sizeAttenuation: false }));
    const sprite = new THREE.Sprite(material);
    if (anchorLeft) sprite.center.set(-0.08, 0.5);
    const label = { sprite, px, aspect: w / h };
    labels.push(label);
    return label;
  };

  const labelGroup = new THREE.Group();
  group.add(labelGroup);
  type ConstellationLabel = { normal: Label; highlight: Label };
  const constellationLabels: ConstellationLabel[] = data.constellations.map((c) => {
    const text = c.name.toUpperCase();
    const normal = makeLabel(text, c.rank >= 3 ? LABEL_FAINT_COLOR : LABEL_COLOR, c.rank >= 3 ? LABEL_PX - 1 : LABEL_PX);
    const highlight = makeLabel(text, LABEL_HIGHLIGHT_COLOR, LABEL_PX + 2);
    const p = toXyz(c.center[0], c.center[1]);
    normal.sprite.position.set(...p);
    highlight.sprite.position.set(...p);
    highlight.sprite.visible = false;
    labelGroup.add(normal.sprite, highlight.sprite);
    return { normal, highlight };
  });

  const starLabelGroup = new THREE.Group();
  group.add(starLabelGroup);
  for (let i = 0; i < stars.count; i++) {
    if (!stars.name[i] || stars.mag[i] > STAR_LABEL_MAG) continue;
    const l = makeLabel(stars.name[i], "rgba(235,238,245,0.8)", STAR_LABEL_PX, true);
    l.sprite.position.set(starPos[i * 3], starPos[i * 3 + 1], starPos[i * 3 + 2]);
    starLabelGroup.add(l.sprite);
  }

  // ── Sun, Moon and planets ──
  const glowTexture = track(createGlowTexture());
  const bodyGroup = new THREE.Group();
  group.add(bodyGroup);
  let bodies: SkyBody[] = [];
  const bodySprites = new Map<string, { glow: THREE.Sprite; label: Label; size: number }>();
  const bodySize = (b: SkyBody) => (b.id === "sun" ? 0.09 : b.id === "moon" ? 0.06 : Math.min(0.035, Math.max(0.016, 0.03 - b.mag * 0.004)));
  let bodiesAtSim = -Infinity;
  let bodiesAtReal = -Infinity;
  const updateBodies = (simMs: number) => {
    bodies = solarSystemBodies(simMs, null);
    bodiesAtSim = simMs;
    bodiesAtReal = performance.now();
    for (const b of bodies) {
      let entry = bodySprites.get(b.id);
      if (!entry) {
        const material = track(new THREE.SpriteMaterial({ map: glowTexture, color: new THREE.Color(b.color), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: false }));
        const glow = new THREE.Sprite(material);
        const label = makeLabel(b.name, b.color, STAR_LABEL_PX + 1, true);
        bodyGroup.add(glow, label.sprite);
        entry = { glow, label, size: bodySize(b) };
        bodySprites.set(b.id, entry);
      }
      const p = toXyz(b.raDeg, b.decDeg, SKY_RADIUS * 0.98); // just in front of the stars
      entry.glow.position.set(...p);
      entry.glow.scale.setScalar(entry.size);
      entry.label.sprite.position.set(...p);
    }
  };

  // ── Layers and highlight ──
  let layers: SkyLayers = { lines: true, labels: true, bounds: false, starNames: true, ecliptic: true, bodies: true };
  let highlighted: number | null = null;
  const applyLayers = () => {
    figureLines.visible = layers.lines;
    labelGroup.visible = layers.labels;
    allBounds.visible = layers.bounds;
    starLabelGroup.visible = layers.starNames;
    ecliptic.visible = layers.ecliptic;
    bodyGroup.visible = layers.bodies;
  };
  applyLayers();

  const setHighlight = (index: number | null) => {
    if (index === highlighted) return;
    const recolor = (i: number | null, color: THREE.Color) => {
      if (i === null) return;
      const [a, b] = lineRanges[i];
      for (let v = a; v < b; v++) color.toArray(lineColors, v * 3);
      constellationLabels[i].normal.sprite.visible = color === LINE_RGB;
      constellationLabels[i].highlight.sprite.visible = color !== LINE_RGB;
    };
    recolor(highlighted, LINE_RGB);
    recolor(index, LINE_HIGHLIGHT_RGB);
    lineColorAttr.needsUpdate = true;
    if (highlightBounds) {
      group.remove(highlightBounds);
      highlightBounds.geometry.dispose();
      highlightBounds = null;
    }
    if (index !== null) {
      highlightBounds = new THREE.LineSegments(boundaryGeometryFor([index]), highlightBoundaryMaterial);
      highlightBounds.frustumCulled = false;
      group.add(highlightBounds);
    }
    highlighted = index;
  };

  // ── Each frame: follow the camera, turn with the Earth, keep labels a constant size ──
  const camera = globe.camera() as THREE.PerspectiveCamera;
  let lastHeight = 0;
  const size = new THREE.Vector2();
  let frameId = requestAnimationFrame(function loop() {
    const simMs = options.getTimeMs();
    group.position.copy(camera.position);
    group.rotation.y = -satellite.gstime(new Date(simMs));
    if (layers.bodies && (performance.now() - bodiesAtReal > BODY_REFRESH_MS || Math.abs(simMs - bodiesAtSim) > BODY_REFRESH_SIM_MS)) {
      updateBodies(simMs);
    }
    globe.renderer().getSize(size);
    if (size.y !== lastHeight && size.y > 0) {
      lastHeight = size.y;
      // With sizeAttenuation off, a sprite's scale is its height at unit distance: px → that height.
      const perPx = (2 * Math.tan(((camera.fov ?? 50) * DEG) / 2)) / size.y;
      for (const l of labels) l.sprite.scale.set(l.px * 1.4 * perPx * l.aspect, l.px * 1.4 * perPx, 1);
      starMaterial.uniforms.uPixelRatio.value = globe.renderer().getPixelRatio();
    }
    frameId = requestAnimationFrame(loop);
  });

  // ── Where each constellation's figure is and how big it is (for turning the camera to it) ──
  const extents = new Map<number, { dir: THREE.Vector3; radius: number }>();
  const extentOf = (index: number) => {
    let extent = extents.get(index);
    if (!extent) {
      const c = data.constellations[index];
      const pts = (c.lines.length > 0 ? c.lines : c.bounds).flat();
      const units = pts.map(([ra, dec]) => new THREE.Vector3(...toXyz(ra, dec, 1)));
      const dir = units.reduce((sum, u) => sum.add(u), new THREE.Vector3()).normalize();
      const radius = Math.max(2 * DEG, ...units.map((u) => u.angleTo(dir)));
      extent = { dir, radius };
      extents.set(index, extent);
    }
    return extent;
  };

  // ── Picking: the pointer's ray, turned into the sky's frame ──
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const earth = new THREE.Sphere(new THREE.Vector3(), globe.getGlobeRadius());
  const inverse = new THREE.Quaternion();

  function hitAt(clientX: number, clientY: number): SkyHit | null {
    const canvas = globe.renderer().domElement;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    if (raycaster.ray.intersectsSphere(earth)) return null;
    const dir = raycaster.ray.direction.clone().applyQuaternion(inverse.copy(group.quaternion).invert());
    // Back from the group's frame to RA/Dec (the inverse of polarToGlobe's angles).
    const dec = Math.asin(Math.max(-1, Math.min(1, dir.y))) / DEG;
    const ra = (((90 - Math.atan2(dir.z, dir.x) / DEG) % 360) + 360) % 360;
    const tolerance = Math.cos((PICK_PX * (camera.fov ?? 50) * DEG) / rect.height);

    let body: SkyBody | null = null;
    if (layers.bodies) {
      let best = tolerance;
      for (const b of bodies) {
        const p = toXyz(b.raDeg, b.decDeg, 1);
        const dot = p[0] * dir.x + p[1] * dir.y + p[2] * dir.z;
        if (dot > best) {
          best = dot;
          body = b;
        }
      }
    }
    let star: number | null = null;
    if (!body) {
      let best = tolerance;
      for (let i = 0; i < stars.count; i++) {
        const dot = starUnit[i * 3] * dir.x + starUnit[i * 3 + 1] * dir.y + starUnit[i * 3 + 2] * dir.z;
        // Prefer brighter stars when several are within reach.
        const score = dot + (stars.mag[i] < 3 ? 2e-6 * (3 - stars.mag[i]) : 0);
        if (score > best) {
          best = score;
          star = i;
        }
      }
    }
    return { constellation: constellationAt(data, ra, dec), star, body };
  }

  const tooltip = document.createElement("div");
  Object.assign(tooltip.style, {
    position: "fixed",
    pointerEvents: "none",
    zIndex: "1000",
    padding: "4px 8px",
    borderRadius: "4px",
    background: "rgba(0, 0, 0, 0.78)",
    color: "#fff",
    font: "12px ui-monospace, SFMono-Regular, Menlo, monospace",
    whiteSpace: "nowrap",
    display: "none",
  });
  document.body.appendChild(tooltip);

  let hoverFrame = 0;
  let lastMove: PointerEvent | null = null;
  let down: { x: number; y: number } | null = null;
  const updateHover = () => {
    hoverFrame = 0;
    const e = lastMove;
    if (!e || e.buttons !== 0) {
      tooltip.style.display = "none";
      return;
    }
    const hit = hitAt(e.clientX, e.clientY);
    const text = hit ? options.label(hit) : null;
    if (!text) {
      tooltip.style.display = "none";
      return;
    }
    tooltip.textContent = text;
    tooltip.style.left = `${Math.min(e.clientX + 14, window.innerWidth - 260)}px`;
    tooltip.style.top = `${e.clientY + 14}px`;
    tooltip.style.display = "block";
  };
  const onMove = (e: PointerEvent) => {
    lastMove = e;
    if (!hoverFrame) hoverFrame = requestAnimationFrame(updateHover);
  };
  const onLeave = () => {
    lastMove = null;
    tooltip.style.display = "none";
  };
  const onDown = (e: PointerEvent) => {
    down = { x: e.clientX, y: e.clientY };
  };
  const onUp = (e: PointerEvent) => {
    if (!down) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    down = null;
    if (moved > 6 || !options.onClick) return;
    const hit = hitAt(e.clientX, e.clientY);
    if (hit) options.onClick(hit);
  };
  container.addEventListener("pointermove", onMove, { passive: true });
  container.addEventListener("pointerleave", onLeave, { passive: true });
  container.addEventListener("pointerdown", onDown, { passive: true });
  container.addEventListener("pointerup", onUp, { passive: true });

  return {
    setLayers(next) {
      layers = next;
      applyLayers();
      if (layers.bodies) bodiesAtReal = -Infinity; // refresh on the next frame
    },
    setHighlight,
    viewOf(index) {
      const { dir, radius } = extentOf(index);
      // Its direction on the Earth-fixed globe right now (the sky is turned by −GMST about the polar axis).
      const d = dir.clone().applyAxisAngle(Y_AXIS, -satellite.gstime(new Date(options.getTimeMs())));
      // The camera always looks at the Earth's centre, so the constellation goes above the Earth: back off until the
      // Earth is small enough for the whole figure to fit between it and the top of the view.
      const halfFov = ((camera.fov ?? 50) * DEG) / 2;
      const margin = 3.5 * DEG;
      const maxEarth = halfFov - 2 * radius - 2 * margin;
      const altitude = Math.min(25, Math.max(2.5, maxEarth > 0.04 ? 1 / Math.sin(maxEarth) - 1 : 25));
      const earthAngle = Math.asin(1 / (1 + altitude));
      // Too big to fit (Hydra, Eridanus): keep its middle in view rather than its edges.
      const theta = maxEarth > 0.04 ? earthAngle + margin + radius : Math.min(earthAngle + margin + radius, halfFov * 0.55);
      // View direction θ below the constellation (towards the south on the sky): view = cos θ·d − sin θ·up⊥.
      const e = Y_AXIS.clone().sub(d.clone().multiplyScalar(Y_AXIS.dot(d)));
      if (e.lengthSq() < 1e-6) e.set(1, 0, 0);
      e.normalize();
      const view = d.multiplyScalar(Math.cos(theta)).sub(e.multiplyScalar(Math.sin(theta)));
      const cam = view.negate(); // the camera sits opposite where it looks
      const lat = Math.asin(Math.max(-1, Math.min(1, cam.y))) / DEG;
      const lng = ((((90 - Math.atan2(cam.z, cam.x) / DEG) % 360) + 540) % 360) - 180;
      return { lat, lng, altitude };
    },
    dispose() {
      cancelAnimationFrame(frameId);
      if (hoverFrame) cancelAnimationFrame(hoverFrame);
      container.removeEventListener("pointermove", onMove);
      container.removeEventListener("pointerleave", onLeave);
      container.removeEventListener("pointerdown", onDown);
      container.removeEventListener("pointerup", onUp);
      tooltip.remove();
      scene.remove(group);
      if (highlightBounds) highlightBounds.geometry.dispose();
      allBounds.geometry.dispose();
      disposables.forEach((d) => d.dispose());
    },
  };
}
