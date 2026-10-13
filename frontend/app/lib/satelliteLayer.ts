import * as THREE from "three";

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

export type SatelliteLayer = {
  setData: (points: SatellitePoint[]) => void;
  dispose: () => void;
};

const EARTH_RADIUS_KM = 6371;
const DOT_RADIUS = 0.2;
const PICK_RADIUS_PX = 8;
const CLICK_MAX_MOVE_PX = 5;

export function createSatelliteLayer(
  globe: GlobeLike,
  container: HTMLElement,
  options: {
    onClick: (point: SatellitePoint) => void;
    label: (point: SatellitePoint) => string;
  }
): SatelliteLayer {
  const geometry = new THREE.SphereGeometry(DOT_RADIUS, 8, 8);
  const material = new THREE.MeshLambertMaterial({ color: 0xffffff });
  let capacity = 0;
  let mesh: THREE.InstancedMesh | null = null;
  let points: SatellitePoint[] = [];
  let positions = new Float32Array(0);

  const matrix = new THREE.Matrix4();
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
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    // Instances span the whole globe; the base geometry's bounds would make three cull them wrongly.
    mesh.frustumCulled = false;
    mesh.count = 0;
    globe.scene().add(mesh);
  }

  function colorFor(css: string): THREE.Color {
    let c = colorCache.get(css);
    if (!c) {
      c = new THREE.Color(css);
      colorCache.set(css, c);
    }
    return c;
  }

  function setData(next: SatellitePoint[]) {
    ensureCapacity(next.length);
    if (!mesh) return;
    if (positions.length < next.length * 3) positions = new Float32Array(capacity * 3);
    for (let i = 0; i < next.length; i++) {
      const p = next[i];
      const c = globe.getCoords(p.latitude, p.longitude, Math.max(0, p.altitudeKm / EARTH_RADIUS_KM));
      positions[i * 3] = c.x;
      positions[i * 3 + 1] = c.y;
      positions[i * 3 + 2] = c.z;
      matrix.makeTranslation(c.x, c.y, c.z);
      mesh.setMatrixAt(i, matrix);
      mesh.setColorAt(i, color.copy(colorFor(p.color)));
    }
    mesh.count = next.length;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    points = next;
  }

  // ── Picking ──
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const globeSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), globe.getGlobeRadius());
  const hit = new THREE.Vector3();

  function pick(clientX: number, clientY: number): SatellitePoint | null {
    if (points.length === 0) return null;
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
    for (let i = 0; i < points.length; i++) {
      const dx = positions[i * 3] - origin.x;
      const dy = positions[i * 3 + 1] - origin.y;
      const dz = positions[i * 3 + 2] - origin.z;
      const along = dx * direction.x + dy * direction.y + dz * direction.z;
      if (along <= 0 || along > globeDist) continue;
      const perpSq = dx * dx + dy * dy + dz * dz - along * along;
      const tol = Math.max(PICK_RADIUS_PX * worldPerPxAtUnit * along, DOT_RADIUS);
      const score = perpSq / (tol * tol);
      if (score < 1 && score < bestScore) {
        bestScore = score;
        best = i;
      }
    }
    return best >= 0 ? points[best] : null;
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
    lastMove = e;
    if (!hoverFrame) hoverFrame = requestAnimationFrame(updateHover);
  };
  const onPointerLeave = () => {
    lastMove = null;
    tooltip.style.display = "none";
    container.style.cursor = "";
  };
  const onPointerDown = (e: PointerEvent) => {
    down = { x: e.clientX, y: e.clientY };
  };
  const onPointerUp = (e: PointerEvent) => {
    if (!down) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    down = null;
    if (moved > CLICK_MAX_MOVE_PX) return; // a drag to rotate, not a click
    const p = pick(e.clientX, e.clientY);
    if (p) options.onClick(p);
  };

  container.addEventListener("pointermove", onPointerMove, { passive: true });
  container.addEventListener("pointerleave", onPointerLeave, { passive: true });
  container.addEventListener("pointerdown", onPointerDown, { passive: true });
  container.addEventListener("pointerup", onPointerUp, { passive: true });

  return {
    setData,
    dispose() {
      container.removeEventListener("pointermove", onPointerMove);
      container.removeEventListener("pointerleave", onPointerLeave);
      container.removeEventListener("pointerdown", onPointerDown);
      container.removeEventListener("pointerup", onPointerUp);
      if (hoverFrame) cancelAnimationFrame(hoverFrame);
      tooltip.remove();
      if (mesh) {
        globe.scene().remove(mesh);
        mesh.dispose();
      }
      geometry.dispose();
      material.dispose();
    },
  };
}
