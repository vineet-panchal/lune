import * as THREE from "three";
import { EARTH_RADIUS_KM, GLOBE_RADIUS, polarToGlobe } from "./propagateBatch";

/**
 * Draws every satellite as one THREE.InstancedMesh: a single draw call whose positions and colours
 * are rewritten in place on each update. globe.gl's objects layer instead builds a separate mesh,
 * geometry and material per satellite and rebuilds them all on every data change, which is
 * what made large groups like Starlink (~12k) lag while rotating.
 *
 * Hover labels and clicks are handled here by projecting the pointer ray against the stored
 * positions — a cheap distance check per satellite instead of a mesh raycast.
 */

export type SatellitePoint = {
  satelliteId: number;
  name: string;
  latitude: number;
  longitude: number;
  altitudeKm: number;
  color: string;
};

type GlobeLike = {
  scene: () => THREE.Scene;
  camera: () => THREE.Camera;
  renderer: () => THREE.WebGLRenderer;
  getGlobeRadius: () => number;
  getCoords: (lat: number, lng: number, altitude?: number) => { x: number; y: number; z: number };
};

/**
 * Every satellite's position at one moment, in slots. Pass the same ids array object for as long as
 * the catalog is unchanged: the layer then knows slot i is the same satellite and skips re-indexing.
 */
export type Keyframe = {
  ids: number[];
  names: string[];
  /** Globe-space position per slot (3 floats); NaN hides the slot (satellite can't be propagated). */
  xyz: Float32Array;
  /** CSS colour per slot. */
  colors: string[];
  /** Optional: 1 draws the slot dimmed (e.g. satellite in Earth's shadow). */
  dimmed?: Uint8Array;
};

export type SatelliteLayer = {
  /**
   * Where every satellite will be at atMs (normally a few seconds ahead of the globe's time).
   * Each frame, dots glide from where they're drawn now towards these positions, arriving at atMs.
   * With snap they jump straight there (time jumps, a newly loaded catalog).
   */
  setKeyframe: (frame: Keyframe, atMs: number, options?: { snap?: boolean }) => void;
  /** Draw one satellite larger with a pulsing glow (the followed satellite), or none with null. */
  setHighlight: (satelliteId: number | null) => void;
  dispose: () => void;
};

const DOT_RADIUS = 0.2;
const PICK_RADIUS_PX = 8;
/** Fingers are less precise than a mouse pointer. */
const TOUCH_PICK_RADIUS_PX = 20;
/** A first tap shows the label; a second tap on the same satellite within this time selects it. */
const TAP_CONFIRM_MS = 5000;
const HIGHLIGHT_DOT_RADIUS = DOT_RADIUS * 2.2;
// Fraction of the viewport height, so the glow reads the same at any zoom (the dots themselves are tiny on screen).
const GLOW_SIZE = 0.045;
const GLOW_PULSE_MS = 1800;
const CLICK_MAX_MOVE_PX = 5;
/** Brightness of satellites in Earth's shadow (when day/night shading is on). */
const SHADOW_DIM = 0.3;
const IDENTITY = new THREE.Matrix4();

export function createSatelliteLayer(
  globe: GlobeLike,
  container: HTMLElement,
  options: {
    onClick: (point: SatellitePoint) => void;
    label: (point: SatellitePoint) => string;
    /** The globe's current (possibly simulated) time, used to place dots between keyframes. */
    getTimeMs: () => number;
  }
): SatelliteLayer {
  const geometry = new THREE.SphereGeometry(DOT_RADIUS, 8, 8);
  const material = new THREE.MeshLambertMaterial({ color: 0xffffff });
  let capacity = 0;
  let mesh: THREE.InstancedMesh | null = null;
  let count = 0;
  let ids: number[] = [];
  let names: string[] = [];
  let colors: string[] = [];
  let dimmed = new Uint8Array(0);
  let indexById = new Map<number, number>();
  // Interpolation: dots move from fromPos (at fromMs) to toPos (at toMs); positions holds what's drawn now.
  let fromPos = new Float32Array(0);
  let toPos = new Float32Array(0);
  let positions = new Float32Array(0);
  let fromMs = 0;
  let toMs = 0;
  let lastAlpha = -1;

  // Highlight: a bigger, unlit (so it reads brighter) dot plus an additive glow sprite in the satellite's colour.
  const highlightDot = new THREE.Mesh(
    new THREE.SphereGeometry(HIGHLIGHT_DOT_RADIUS, 16, 16),
    new THREE.MeshBasicMaterial({ color: 0xffffff })
  );
  const glowTexture = createGlowTexture();
  const glow = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: glowTexture,
      color: 0xffffff,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: false,
    })
  );
  const highlight = new THREE.Group();
  highlight.add(highlightDot, glow);
  highlight.visible = false;
  globe.scene().add(highlight);
  let highlightId: number | null = null;

  const color = new THREE.Color();
  const colorCache = new Map<string, THREE.Color>();

  function ensureCapacity(n: number) {
    if (mesh && n <= capacity) return;
    capacity = Math.max(n, capacity * 2, 256);
    if (mesh) {
      globe.scene().remove(mesh);
      mesh.dispose();
    }
    mesh = new THREE.InstancedMesh(geometry, material, capacity);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // Every instance is a pure translation: start from identity, then each frame only the translation is written.
    for (let i = 0; i < capacity; i++) mesh.setMatrixAt(i, IDENTITY);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    // Instances span the whole globe; the base geometry's bounds would make three cull them wrongly.
    mesh.frustumCulled = false;
    mesh.count = 0;
    globe.scene().add(mesh);

    const grow = (old: Float32Array) => {
      const next = new Float32Array(capacity * 3);
      next.set(old.subarray(0, Math.min(old.length, next.length)));
      return next;
    };
    fromPos = grow(fromPos);
    toPos = grow(toPos);
    positions = grow(positions);
  }

  function colorFor(css: string): THREE.Color {
    let c = colorCache.get(css);
    if (!c) {
      c = new THREE.Color(css);
      colorCache.set(css, c);
    }
    return c;
  }

  function setKeyframe(frame: Keyframe, atMs: number, { snap = false } = {}) {
    const n = frame.ids.length;
    const sameSlots = frame.ids === ids;
    const previousIndex = indexById;
    const previousPositions = sameSlots ? positions : positions.slice(0, count * 3);
    ensureCapacity(n);
    if (!mesh) return;

    // Start each dot from where it's drawn right now, so a new keyframe never makes it jump.
    if (snap) {
      fromPos.set(frame.xyz.subarray(0, n * 3));
    } else if (sameSlots) {
      fromPos.set(positions.subarray(0, n * 3));
    } else {
      for (let i = 0; i < n; i++) {
        const prev = previousIndex.get(frame.ids[i]);
        const src = prev === undefined ? frame.xyz : previousPositions;
        const j = (prev === undefined ? i : prev) * 3;
        fromPos[i * 3] = src[j];
        fromPos[i * 3 + 1] = src[j + 1];
        fromPos[i * 3 + 2] = src[j + 2];
      }
    }
    toPos.set(frame.xyz.subarray(0, n * 3));

    if (!sameSlots) {
      ids = frame.ids;
      names = frame.names;
      indexById = new Map(ids.map((id, i) => [id, i]));
    }
    // Colours only change occasionally (altitude band, colour mode, entering shadow), so only rewrite those.
    if (dimmed.length < n) dimmed = new Uint8Array(capacity);
    let colorsChanged = false;
    for (let i = 0; i < n; i++) {
      const dim = frame.dimmed?.[i] ?? 0;
      if (sameSlots && frame.colors[i] === colors[i] && dim === dimmed[i]) continue;
      color.copy(colorFor(frame.colors[i]));
      if (dim) color.multiplyScalar(SHADOW_DIM);
      mesh.setColorAt(i, color);
      dimmed[i] = dim;
      colorsChanged = true;
    }
    if (colorsChanged && mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    colors = frame.colors;
    count = n;
    mesh.count = n;
    fromMs = snap ? atMs : getTimeMs();
    toMs = atMs;
    lastAlpha = -1;
    renderFrame();
  }

  /** Place every dot for the current time. Cheap: no orbit maths, just an arc between two known points. */
  function renderFrame() {
    if (!mesh) return;
    const now = getTimeMs();
    const alpha = toMs > fromMs ? Math.min(1, Math.max(0, (now - fromMs) / (toMs - fromMs))) : 1;
    if (alpha !== lastAlpha) {
      lastAlpha = alpha;
      interpolatePositions(fromPos, toPos, alpha, positions, count);
      const m = mesh.instanceMatrix.array as Float32Array;
      for (let i = 0; i < count; i++) {
        const x = positions[i * 3];
        const hidden = x !== x; // NaN: satellite couldn't be propagated
        const scale = hidden ? 0 : 1;
        const o = i * 16;
        m[o] = scale;
        m[o + 5] = scale;
        m[o + 10] = scale;
        m[o + 12] = hidden ? 0 : x;
        m[o + 13] = hidden ? 0 : positions[i * 3 + 1];
        m[o + 14] = hidden ? 0 : positions[i * 3 + 2];
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
    placeHighlight();
  }

  /** The satellite in slot i as currently drawn (for hover labels and clicks). */
  function pointAt(i: number): SatellitePoint {
    const x = positions[i * 3];
    const y = positions[i * 3 + 1];
    const z = positions[i * 3 + 2];
    const r = Math.sqrt(x * x + y * y + z * z);
    const lng = 90 - (Math.atan2(z, x) * 180) / Math.PI;
    return {
      satelliteId: ids[i],
      name: names[i],
      latitude: 90 - (Math.acos(y / r) * 180) / Math.PI,
      longitude: ((lng + 540) % 360) - 180,
      altitudeKm: (r / GLOBE_RADIUS - 1) * EARTH_RADIUS_KM,
      color: colors[i],
    };
  }

  const { getTimeMs } = options;
  let frameId = requestAnimationFrame(function loop() {
    renderFrame();
    frameId = requestAnimationFrame(loop);
  });

  function placeHighlight() {
    const i = highlightId === null ? undefined : indexById.get(highlightId);
    if (i === undefined) {
      highlight.visible = false;
      return;
    }
    if (Number.isNaN(positions[i * 3])) {
      highlight.visible = false;
      return;
    }
    highlight.position.set(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
    const c = colorFor(colors[i]);
    (highlightDot.material as THREE.MeshBasicMaterial).color.copy(c);
    glow.material.color.copy(c);
    const pulse = 1 + 0.18 * Math.sin((performance.now() / GLOW_PULSE_MS) * Math.PI * 2);
    glow.scale.setScalar(GLOW_SIZE * pulse);
    highlight.visible = true;
  }

  function setHighlight(satelliteId: number | null) {
    highlightId = satelliteId;
    placeHighlight();
  }

  // ── Picking ──
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const globeSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), globe.getGlobeRadius());
  const hit = new THREE.Vector3();

  function pick(clientX: number, clientY: number, radiusPx = PICK_RADIUS_PX): SatellitePoint | null {
    if (count === 0) return null;
    const canvas = globe.renderer().domElement;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const camera = globe.camera();
    ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const { origin, direction } = raycaster.ray;

    // Anything farther along the ray than where it enters the Earth is hidden behind it.
    const globeDist = raycaster.ray.intersectSphere(globeSphere, hit) ? origin.distanceTo(hit) : Infinity;
    // World units per screen pixel at distance 1 (perspective camera).
    const fov = (camera as THREE.PerspectiveCamera).fov ?? 50;
    const worldPerPxAtUnit = (2 * Math.tan(THREE.MathUtils.degToRad(fov) / 2)) / rect.height;

    let best = -1;
    let bestScore = Infinity;
    for (let i = 0; i < count; i++) {
      const dx = positions[i * 3] - origin.x;
      const dy = positions[i * 3 + 1] - origin.y;
      const dz = positions[i * 3 + 2] - origin.z;
      const along = dx * direction.x + dy * direction.y + dz * direction.z;
      if (along <= 0 || along > globeDist) continue;
      const perpSq = dx * dx + dy * dy + dz * dz - along * along;
      const tol = Math.max(radiusPx * worldPerPxAtUnit * along, DOT_RADIUS);
      const score = perpSq / (tol * tol);
      if (score < 1 && score < bestScore) {
        bestScore = score;
        best = i;
      }
    }
    return best >= 0 ? pointAt(best) : null;
  }

  // ── Hover label + click ──
  const tooltip = document.createElement("div");
  Object.assign(tooltip.style, {
    position: "fixed",
    pointerEvents: "none",
    zIndex: "1000",
    padding: "4px 8px",
    borderRadius: "4px",
    background: "rgba(0, 0, 0, 0.75)",
    color: "#fff",
    font: "12px sans-serif",
    whiteSpace: "nowrap",
    display: "none",
  });
  document.body.appendChild(tooltip);

  let hoverFrame = 0;
  let lastMove: PointerEvent | null = null;
  let down: { x: number; y: number } | null = null;

  function updateHover() {
    hoverFrame = 0;
    const e = lastMove;
    if (!e) return;
    const p = e.buttons === 0 ? pick(e.clientX, e.clientY) : null; // skip picking while dragging
    if (p) {
      tooltip.textContent = options.label(p);
      tooltip.style.left = `${e.clientX + 12}px`;
      tooltip.style.top = `${e.clientY + 12}px`;
      tooltip.style.display = "block";
      container.style.cursor = "pointer";
    } else {
      tooltip.style.display = "none";
      container.style.cursor = "";
    }
  }

  const onPointerMove = (e: PointerEvent) => {
    if (e.pointerType === "touch") return; // touch labels come from taps (see onPointerUp)
    lastMove = e;
    if (!hoverFrame) hoverFrame = requestAnimationFrame(updateHover);
  };
  const onPointerLeave = (e: PointerEvent) => {
    if (e.pointerType === "touch") return; // fires after every tap; would hide the tap label at once
    lastMove = null;
    tooltip.style.display = "none";
    container.style.cursor = "";
  };
  const onPointerDown = (e: PointerEvent) => {
    down = { x: e.clientX, y: e.clientY };
  };
  // Touch has no hover, so the first tap on a satellite shows its label and a second tap selects it.
  let pendingTap: { id: number; at: number } | null = null;
  let tooltipTimer = 0;
  const showTooltip = (text: string, x: number, y: number) => {
    tooltip.textContent = text;
    tooltip.style.left = `${Math.min(x + 12, window.innerWidth - 220)}px`;
    tooltip.style.top = `${Math.max(8, y - 40)}px`;
    tooltip.style.display = "block";
  };
  const hideTooltip = () => {
    tooltip.style.display = "none";
  };

  const onPointerUp = (e: PointerEvent) => {
    if (!down) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    down = null;
    if (moved > CLICK_MAX_MOVE_PX * (e.pointerType === "touch" ? 2 : 1)) return; // a drag to rotate, not a click
    if (e.pointerType !== "touch") {
      const p = pick(e.clientX, e.clientY);
      if (p) options.onClick(p);
      return;
    }
    const p = pick(e.clientX, e.clientY, TOUCH_PICK_RADIUS_PX);
    window.clearTimeout(tooltipTimer);
    if (!p) {
      pendingTap = null;
      hideTooltip();
      return;
    }
    if (pendingTap?.id === p.satelliteId && performance.now() - pendingTap.at < TAP_CONFIRM_MS) {
      pendingTap = null;
      hideTooltip();
      options.onClick(p);
      return;
    }
    pendingTap = { id: p.satelliteId, at: performance.now() };
    showTooltip(`${options.label(p)} · tap again to select`, e.clientX, e.clientY);
    tooltipTimer = window.setTimeout(() => {
      pendingTap = null;
      hideTooltip();
    }, TAP_CONFIRM_MS);
  };

  container.addEventListener("pointermove", onPointerMove, { passive: true });
  container.addEventListener("pointerleave", onPointerLeave, { passive: true });
  container.addEventListener("pointerdown", onPointerDown, { passive: true });
  container.addEventListener("pointerup", onPointerUp, { passive: true });

  return {
    setKeyframe,
    setHighlight,
    dispose() {
      container.removeEventListener("pointermove", onPointerMove);
      container.removeEventListener("pointerleave", onPointerLeave);
      container.removeEventListener("pointerdown", onPointerDown);
      container.removeEventListener("pointerup", onPointerUp);
      if (hoverFrame) cancelAnimationFrame(hoverFrame);
      window.clearTimeout(tooltipTimer);
      cancelAnimationFrame(frameId);
      tooltip.remove();
      if (mesh) {
        globe.scene().remove(mesh);
        mesh.dispose();
      }
      geometry.dispose();
      material.dispose();
      globe.scene().remove(highlight);
      highlightDot.geometry.dispose();
      (highlightDot.material as THREE.Material).dispose();
      glow.material.dispose();
      glowTexture.dispose();
    },
  };
}

/** Soft round glow: white in the centre fading to transparent, tinted by the sprite colour. */
function createGlowTexture(): THREE.Texture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.2, "rgba(255,255,255,0.6)");
    g.addColorStop(0.5, "rgba(255,255,255,0.15)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  return new THREE.CanvasTexture(canvas);
}

/** Build a keyframe from a few ready-made points (search results, clearing the globe). */
export function keyframeFromPoints(points: SatellitePoint[]): Keyframe {
  const xyz = new Float32Array(points.length * 3);
  points.forEach((p, i) => polarToGlobe(p.latitude, p.longitude, p.altitudeKm, xyz, i * 3));
  return {
    ids: points.map((p) => p.satelliteId),
    names: points.map((p) => p.name),
    xyz,
    colors: points.map((p) => p.color),
  };
}

/**
 * Positions between two keyframes, for count points stored as xyz triples. Moves along the arc around
 * the Earth's centre (direction slerped, distance from centre lerped), so dots stay at orbital height
 * even when a keyframe step covers a large part of an orbit (fast time controls).
 */
export function interpolatePositions(from: Float32Array, to: Float32Array, alpha: number, out: Float32Array, count: number) {
  if (alpha >= 1) {
    out.set(to.subarray(0, count * 3));
    return;
  }
  if (alpha <= 0) {
    out.set(from.subarray(0, count * 3));
    return;
  }
  for (let i = 0; i < count; i++) {
    const k = i * 3;
    const ax = from[k], ay = from[k + 1], az = from[k + 2];
    const bx = to[k], by = to[k + 1], bz = to[k + 2];
    const ra = Math.sqrt(ax * ax + ay * ay + az * az);
    const rb = Math.sqrt(bx * bx + by * by + bz * bz);
    const cos = (ax * bx + ay * by + az * bz) / (ra * rb || 1);
    let wa: number;
    let wb: number;
    if (cos > 0.99999 || !(ra > 0 && rb > 0)) {
      // Nearly the same direction: a straight line is indistinguishable and avoids dividing by ~0.
      wa = 1 - alpha;
      wb = alpha;
    } else {
      const omega = Math.acos(Math.max(-1, Math.min(1, cos)));
      const sin = Math.sin(omega);
      wa = Math.sin((1 - alpha) * omega) / sin;
      wb = Math.sin(alpha * omega) / sin;
    }
    // Unit directions blended, then scaled to the interpolated distance from the centre.
    const r = ra + (rb - ra) * alpha;
    const ux = (wa * ax) / ra + (wb * bx) / rb;
    const uy = (wa * ay) / ra + (wb * by) / rb;
    const uz = (wa * az) / ra + (wb * bz) / rb;
    out[k] = ux * r;
    out[k + 1] = uy * r;
    out[k + 2] = uz * r;
  }
}
