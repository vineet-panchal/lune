import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { helioState, planet, type PlanetId } from "./bodies";
import { earthRotationRad } from "./launch";
import { legPosition, sampleLeg, type LegArc, type MoonLeg } from "./moonTrip";
import { moonOrbit, moonsOf, moonState, type MoonBody } from "./moons";
import { dotTexture } from "./solarSystemScene";
import type { Vec3 } from "./vec";

/**
 * Around the destination planet for a moon trip: the planet, its major moons on their orbits, and the last leg
 * (arrival, capture orbit, transfer, or from a parking orbit) with the spacecraft on it. Planet-centred J2000
 * equatorial; 1 unit = the planet's radius. Scene axes: x = EQJ x, y = celestial north, z = −EQJ y.
 */
export type PlanetScene = {
  setTrip: (trip: { planet: PlanetId; leg: MoonLeg } | null) => void;
  setActive: (active: boolean) => void;
  dispose: () => void;
};

const EARTH_TEXTURE = "https://unpkg.com/three-globe@2.45.0/example/img/earth-blue-marble.jpg";
const MIN_MOON_PX = 3;
const LABEL_LINE_PX = 14;
/** Saturn's north pole (IAU), so its rings and moons line up. */
const SATURN_POLE_EQJ: Vec3 = (() => {
  const ra = (40.589 * Math.PI) / 180;
  const dec = (83.537 * Math.PI) / 180;
  return [Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)];
})();
const ARC_STYLE: Record<LegArc["id"], { color: number; opacity: number; dashed: boolean }> = {
  approach: { color: 0x7fb2ff, opacity: 0.85, dashed: false },
  parking: { color: 0xe0e6f0, opacity: 0.55, dashed: true },
  capture: { color: 0xe0e6f0, opacity: 0.5, dashed: true },
  transfer: { color: 0x4dd0e1, opacity: 0.95, dashed: false },
};

export function createPlanetScene(el: HTMLElement, getTimeMs: () => number): PlanetScene {
  const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000003);
  renderer.domElement.style.display = "block";
  el.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 1e-4, 1e6);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 1.2;
  controls.maxDistance = 5000;
  scene.add(new THREE.AmbientLight(0xffffff, 0.3));
  const sunLight = new THREE.DirectionalLight(0xffffff, 2.2);
  scene.add(sunLight);
  scene.add(stars());

  const world = new THREE.Group();
  scene.add(world);
  const craft = new THREE.Sprite(new THREE.SpriteMaterial({ map: dotTexture(), color: 0x4dd0e1, sizeAttenuation: false, depthTest: false, transparent: true }));
  craft.scale.setScalar(0.02);
  craft.renderOrder = 10;
  scene.add(craft);

  const labelLayer = document.createElement("div");
  Object.assign(labelLayer.style, { position: "absolute", inset: "0", pointerEvents: "none", overflow: "hidden" });
  el.appendChild(labelLayer);
  type Label = { div: HTMLDivElement; world: () => THREE.Vector3 | null };
  let labels: Label[] = [];
  const label = (text: string, color: string, at: () => THREE.Vector3 | null, strong = false): Label => {
    const div = document.createElement("div");
    div.textContent = text;
    Object.assign(div.style, {
      position: "absolute",
      left: "0",
      top: "0",
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      fontSize: strong ? "11px" : "10px",
      fontWeight: strong ? "700" : "400",
      color: "rgba(230,236,246,0.9)",
      whiteSpace: "nowrap",
      textShadow: "0 0 4px #000, 0 0 2px #000",
      borderLeft: `2px solid ${color}`,
      paddingLeft: "4px",
    });
    labelLayer.appendChild(div);
    const l = { div, world: at };
    labels.push(l);
    return l;
  };

  // What's being shown: rebuilt by setTrip.
  let body: PlanetId | null = null;
  let radiusKm = 1;
  let leg: MoonLeg | null = null;
  let globe: THREE.Mesh | null = null;
  let moonMeshes: { m: MoonBody; mesh: THREE.Mesh; orbit: THREE.LineLoop | null; orbitMs: number }[] = [];
  const toScene = (v: Vec3) => new THREE.Vector3(v[0] / radiusKm, v[2] / radiusKm, -v[1] / radiusKm);

  const clearWorld = () => {
    world.traverse((o) => {
      const mesh = o as THREE.Mesh;
      mesh.geometry?.dispose?.();
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat?.dispose?.();
    });
    world.clear();
    for (const l of labels) l.div.remove();
    labels = [];
    moonMeshes = [];
    globe = null;
  };

  let width = 1;
  let height = 1;
  const resize = () => {
    width = Math.max(1, el.clientWidth);
    height = Math.max(1, el.clientHeight);
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(el);
  const worldPerPixel = (pos: THREE.Vector3) => (2 * camera.position.distanceTo(pos) * Math.tan((camera.fov * Math.PI) / 360)) / height;

  let active = true;
  let raf = 0;
  const projected = new THREE.Vector3();
  const frame = () => {
    raf = requestAnimationFrame(frame);
    if (!active || !body) return;
    const ms = getTimeMs();
    const sun = helioState(body, ms).r;
    sunLight.position.copy(toScene([-sun[0], -sun[1], -sun[2]]).normalize().multiplyScalar(50));
    if (body === "Earth" && globe) globe.rotation.y = earthRotationRad(ms);

    for (const mm of moonMeshes) {
      const s = moonState(mm.m.id, ms);
      mm.mesh.visible = !!s;
      if (!s) continue;
      mm.mesh.position.copy(toScene(s.r));
      mm.mesh.scale.setScalar(Math.max(mm.m.radiusKm / radiusKm, MIN_MOON_PX * worldPerPixel(mm.mesh.position)));
      // The orbit drifts slowly (precession): redraw it now and then.
      if (!mm.orbit || Math.abs(ms - mm.orbitMs) > 5 * mm.m.periodDays * 86_400_000) {
        const pts = moonOrbit(mm.m.id, ms);
        if (pts) {
          if (mm.orbit) {
            world.remove(mm.orbit);
            mm.orbit.geometry.dispose();
            (mm.orbit.material as THREE.Material).dispose();
          }
          mm.orbit = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts.map(toScene)), new THREE.LineBasicMaterial({ color: mm.m.color, transparent: true, opacity: 0.35 }));
          mm.orbitMs = ms;
          world.add(mm.orbit);
        }
      }
    }
    const p = leg ? legPosition(leg, ms) : null;
    craft.visible = !!p;
    if (p) craft.position.copy(toScene(p));

    controls.update();
    renderer.render(scene, camera);

    // A label that would overlap one already placed moves down a line (burns often share a point).
    const placed: { x: number; y: number; w: number }[] = [];
    for (const l of labels) {
      const w = l.world();
      if (!w) {
        l.div.style.display = "none";
        continue;
      }
      projected.copy(w).project(camera);
      const hidden = projected.z > 1 || Math.abs(projected.x) > 1.2 || Math.abs(projected.y) > 1.2 || behindPlanet(camera.position, w);
      l.div.style.display = hidden ? "none" : "block";
      if (hidden) continue;
      const x = ((projected.x + 1) / 2) * width + 8;
      let y = ((1 - projected.y) / 2) * height - 7;
      const lw = l.div.offsetWidth || 60;
      for (let tries = 0; tries < 5 && placed.some((q) => x < q.x + q.w && q.x < x + lw && Math.abs(q.y - y) < LABEL_LINE_PX); tries++) y += LABEL_LINE_PX;
      placed.push({ x, y, w: lw });
      l.div.style.transform = `translate(${x}px, ${y}px)`;
    }
  };
  raf = requestAnimationFrame(frame);

  return {
    setTrip(next) {
      clearWorld();
      leg = next?.leg ?? null;
      body = next?.planet ?? null;
      if (!next) return;
      const P = planet(next.planet);
      radiusKm = P.radiusKm;

      // The planet: Earth with its map, the others plain.
      const material = new THREE.MeshPhongMaterial({ color: next.planet === "Earth" ? 0xffffff : P.color, shininess: 6 });
      globe = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 48), material);
      if (next.planet === "Earth") {
        new THREE.TextureLoader().load(EARTH_TEXTURE, (tex) => {
          tex.colorSpace = THREE.SRGBColorSpace;
          material.map = tex;
          material.needsUpdate = true;
        });
      }
      if (next.planet === "Saturn") {
        const ring = new THREE.Mesh(new THREE.RingGeometry(1.24, 2.27, 128), new THREE.MeshBasicMaterial({ color: 0xd8c79a, side: THREE.DoubleSide, transparent: true, opacity: 0.5 }));
        ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), toScene(SATURN_POLE_EQJ).normalize());
        world.add(ring);
      }
      world.add(globe);
      label(P.id, P.color, () => new THREE.Vector3(0, 1.1, 0));

      for (const m of moonsOf(next.planet)) {
        const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), new THREE.MeshLambertMaterial({ color: m.color }));
        world.add(mesh);
        moonMeshes.push({ m, mesh, orbit: null, orbitMs: 0 });
        label(m.id, m.color, () => (mesh.visible ? mesh.position : null), m.id === next.leg.moon);
      }

      const reach = Math.max(4, (1.6 * moonsOf(next.planet).find((m) => m.id === next.leg.moon)!.smaKm) / radiusKm);
      for (const { arc, points } of sampleLeg(next.leg)) {
        const style = ARC_STYLE[arc.id];
        const g = new THREE.BufferGeometry().setFromPoints(points.map(toScene));
        const mat = style.dashed
          ? new THREE.LineDashedMaterial({ color: style.color, transparent: true, opacity: style.opacity, dashSize: reach * 0.015, gapSize: reach * 0.01 })
          : new THREE.LineBasicMaterial({ color: style.color, transparent: true, opacity: style.opacity });
        const line = new THREE.Line(g, mat);
        if (style.dashed) line.computeLineDistances();
        world.add(line);
      }
      // A dot at each burn.
      const burnTexture = dotTexture();
      for (const b of next.leg.burns) {
        const at = legPosition(next.leg, b.ms);
        if (!at) continue;
        const dot = new THREE.Sprite(new THREE.SpriteMaterial({ map: burnTexture, color: 0xffd54f, sizeAttenuation: false, depthTest: false, transparent: true }));
        dot.scale.setScalar(0.013);
        dot.position.copy(toScene(at));
        world.add(dot);
        label(b.label, "#ffd54f", () => dot.position);
      }
      // The spacecraft's label goes first, so it keeps its place next to the dot.
      const craftLabel = label("Spacecraft", "#4dd0e1", () => (craft.visible ? craft.position : null), true);
      labels = [craftLabel, ...labels.filter((l) => l !== craftLabel)];

      // Frame the target moon's orbit.
      controls.target.set(0, 0, 0);
      camera.position.set(0, reach * 0.9, reach * 1.6);
      camera.near = 1e-4 * reach;
      camera.updateProjectionMatrix();
    },
    setActive(next) {
      active = next;
    },
    dispose() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      clearWorld();
      controls.dispose();
      renderer.dispose();
      scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        mesh.geometry?.dispose?.();
        const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else mat?.dispose?.();
      });
      renderer.domElement.remove();
      labelLayer.remove();
    },
  };
}

/** Whether the planet (radius 1 at the origin) blocks the line of sight from the camera to a point. */
function behindPlanet(cam: THREE.Vector3, p: THREE.Vector3): boolean {
  const d = p.clone().sub(cam);
  const len = d.length();
  d.divideScalar(len);
  const t = -cam.dot(d);
  if (t <= 0 || t >= len) return false;
  return cam.clone().add(d.multiplyScalar(t)).length() < 0.995;
}

function stars(): THREE.Points {
  const n = 2000;
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const u = Math.random() * 2 - 1;
    const th = Math.random() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    pos.set([s * Math.cos(th) * 1e5, u * 1e5, s * Math.sin(th) * 1e5], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  return new THREE.Points(g, new THREE.PointsMaterial({ color: 0x9aa4b8, size: 1.2, sizeAttenuation: false, transparent: true, opacity: 0.7 }));
}
