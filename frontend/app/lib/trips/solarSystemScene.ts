import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { AU_KM, eqjToEcl, helioEclipticAu, PLANETS, type PlanetId } from "./bodies";
import { moonOrbit, MOONS, moonState, type MoonBody } from "./moons";
import { scale, type Vec3 } from "./vec";

/**
 * The solar system around the Sun, in AU on the ecliptic plane (J2000), drawn with three.js. Planets sit
 * where they really are at the clock's time. Their spheres are true to scale when you're close, and never
 * smaller than a few pixels when you're far, so they stay visible without distorting flybys up close. Close
 * in on a planet and its major moons appear on their real orbits.
 * Scene axes: x = ecliptic x, y = ecliptic north, z = −ecliptic y.
 */

export type SolarPath = {
  id: string;
  label: string;
  color: string;
  /** Flat xyz (AU, ecliptic) with each vertex's time, oldest first. */
  xyz: Float32Array;
  times: Float64Array;
  /** Where the spacecraft is at a moment, or null before it starts / after it ends. */
  position: (ms: number) => Vec3 | null;
  /** Dim the whole path and brighten what's been flown by `ms`. */
  showProgress: boolean;
  /** Path and position are relative to this planet and move with it (a leg around a planet, out to its moons). */
  anchor?: PlanetId;
};

export type SolarMarker = { id: string; label: string; color: string; position: Vec3 };

export type SolarFocus = { kind: "sun" } | { kind: "planet"; id: PlanetId } | { kind: "path"; id: string };

export type SolarScene = {
  setPaths: (paths: SolarPath[]) => void;
  setMarkers: (markers: SolarMarker[]) => void;
  /** Turn the camera to something and keep it centred as it moves. distanceAu: how far to stand off. */
  focus: (target: SolarFocus, distanceAu?: number) => void;
  setActive: (active: boolean) => void;
  dispose: () => void;
};

const toScene = (v: Vec3) => new THREE.Vector3(v[0], v[2], -v[1]);
const SUN_RADIUS_AU = 696_000 / AU_KM;
const MIN_PLANET_PX = 3.5;
const MIN_SUN_PX = 7;
const FOCUS_ANIM_MS = 900;
const LABEL_LINE_PX = 14;
/** A moon shows once its orbit's radius spans this many pixels on screen. */
const MOON_FROM_PX = 14;
const MIN_MOON_PX = 2.5;

export function createSolarScene(el: HTMLElement, getTimeMs: () => number, onPickPlanet?: (id: PlanetId) => void): SolarScene {
  const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000003);
  renderer.domElement.style.display = "block";
  el.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 1e-8, 1e6);
  camera.position.set(0, 2.6, 3.4);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 1e-6;
  controls.maxDistance = 2000;
  controls.zoomSpeed = 1.4;

  scene.add(new THREE.AmbientLight(0xffffff, 0.18));
  scene.add(new THREE.PointLight(0xffffff, 2.6, 0, 0));
  scene.add(starfield());

  // ── Sun and planets ──
  const sun = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), new THREE.MeshBasicMaterial({ color: 0xffd27a }));
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffc46b, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  glow.scale.setScalar(6);
  sun.add(glow);
  scene.add(sun);

  const planetMeshes = new Map<PlanetId, THREE.Mesh>();
  for (const p of PLANETS) {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), new THREE.MeshLambertMaterial({ color: p.color }));
    mesh.userData.planet = p.id;
    if (p.id === "Saturn") {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(1.24, 2.27, 96),
        new THREE.MeshBasicMaterial({ color: 0xd8c79a, side: THREE.DoubleSide, transparent: true, opacity: 0.55 })
      );
      ring.rotation.x = -Math.PI / 2 + (p.tiltDeg * Math.PI) / 180;
      mesh.add(ring);
    }
    scene.add(mesh);
    planetMeshes.set(p.id, mesh);
  }

  // Orbits, one period sampled around the time the page opened (they barely change over centuries).
  const t0 = getTimeMs();
  for (const p of PLANETS) {
    const n = 360;
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < n; i++) pts.push(toScene(helioEclipticAu(p.id, t0 + ((i / n - 0.5) * p.periodDays) * 86_400_000)));
    const line = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: p.color, transparent: true, opacity: 0.32 }));
    scene.add(line);
  }

  // ── Moons (shown when zoomed in on their planet) ──
  type MoonObjects = { m: MoonBody; mesh: THREE.Mesh; orbit: THREE.LineLoop | null; orbitMs: number };
  const moonObjects: MoonObjects[] = MOONS.map((m) => {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 12), new THREE.MeshLambertMaterial({ color: m.color }));
    mesh.visible = false;
    scene.add(mesh);
    return { m, mesh, orbit: null, orbitMs: 0 };
  });

  // ── Labels (HTML over the canvas) ──
  const labelLayer = document.createElement("div");
  Object.assign(labelLayer.style, { position: "absolute", inset: "0", pointerEvents: "none", overflow: "hidden" });
  el.appendChild(labelLayer);
  type Label = { div: HTMLDivElement; world: () => THREE.Vector3 | null };
  const fixedLabels: Label[] = [];
  let dynamicLabels: Label[] = [];
  const makeLabel = (text: string, color: string, world: () => THREE.Vector3 | null, onClick?: () => void, strong = false): Label => {
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
      pointerEvents: onClick ? "auto" : "none",
      cursor: onClick ? "pointer" : "default",
      borderLeft: `2px solid ${color}`,
      paddingLeft: "4px",
      userSelect: "none",
    });
    if (onClick) div.addEventListener("click", onClick);
    labelLayer.appendChild(div);
    return { div, world };
  };
  fixedLabels.push(makeLabel("Sun", "#ffd27a", () => new THREE.Vector3()));
  for (const p of PLANETS) {
    const mesh = planetMeshes.get(p.id)!;
    fixedLabels.push(makeLabel(p.id, p.color, () => mesh.position, onPickPlanet ? () => onPickPlanet(p.id) : undefined));
  }
  for (const o of moonObjects) fixedLabels.push(makeLabel(o.m.id, o.m.color, () => (o.mesh.visible ? o.mesh.position : null)));

  // ── Paths (missions and planned trips) ──
  type PathObjects = { path: SolarPath; full: THREE.Line; flown: THREE.Line; craft: THREE.Sprite; geometry: THREE.BufferGeometry; flownGeometry: THREE.BufferGeometry };
  let paths: PathObjects[] = [];
  const craftTexture = dotTexture();
  const clearPaths = () => {
    for (const o of paths) {
      scene.remove(o.full, o.flown, o.craft);
      o.geometry.dispose();
      o.flownGeometry.dispose();
      (o.full.material as THREE.Material).dispose();
      (o.flown.material as THREE.Material).dispose();
      o.craft.material.dispose();
    }
    paths = [];
  };

  let markerObjects: THREE.Sprite[] = [];
  let markerLabels: Label[] = [];

  const rebuildDynamicLabels = () => {
    for (const l of dynamicLabels) l.div.remove();
    dynamicLabels = [
      ...paths.map((o) => makeLabel(o.path.label, o.path.color, () => (o.craft.visible ? o.craft.position : null), undefined, true)),
      ...markerLabels,
    ];
  };

  // ── Focus ──
  let focus: SolarFocus = { kind: "sun" };
  let anim: { start: number; fromTarget: THREE.Vector3; fromOffset: THREE.Vector3; toDistance: number | null } | null = null;
  const focusPosition = (): THREE.Vector3 => {
    if (focus.kind === "planet") return planetMeshes.get(focus.id)!.position.clone();
    if (focus.kind === "path") {
      const o = paths.find((p) => p.path.id === (focus as { id: string }).id);
      if (o?.craft.visible) return o.craft.position.clone();
    }
    return new THREE.Vector3();
  };

  // ── Picking ──
  const raycaster = new THREE.Raycaster();
  let downAt: { x: number; y: number } | null = null;
  const onDown = (e: PointerEvent) => (downAt = { x: e.clientX, y: e.clientY });
  const onUp = (e: PointerEvent) => {
    if (!downAt || Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 5 || !onPickPlanet) return;
    const rect = renderer.domElement.getBoundingClientRect();
    raycaster.setFromCamera(new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1), camera);
    const hit = raycaster.intersectObjects([...planetMeshes.values()], false)[0];
    if (hit) onPickPlanet(hit.object.userData.planet as PlanetId);
  };
  renderer.domElement.addEventListener("pointerdown", onDown);
  renderer.domElement.addEventListener("pointerup", onUp);

  // ── Sizing ──
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

  /** Place the moons whose orbits are big enough on screen to tell apart from their planet; hide the rest. */
  const updateMoons = (ms: number) => {
    for (const o of moonObjects) {
      const planetMesh = planetMeshes.get(o.m.planet)!;
      const show = o.m.smaKm / AU_KM / worldPerPixel(planetMesh.position) > MOON_FROM_PX;
      const s = show ? moonState(o.m.id, ms) : null;
      o.mesh.visible = !!s;
      if (o.orbit) o.orbit.visible = !!s;
      if (!s) continue;
      o.mesh.position.copy(planetMesh.position).add(toScene(eqjToEcl(scale(s.r, 1 / AU_KM))));
      o.mesh.scale.setScalar(Math.max(o.m.radiusKm / AU_KM, MIN_MOON_PX * worldPerPixel(o.mesh.position)));
      // Orbits are drawn relative to the planet and redrawn now and then as they slowly turn.
      if (!o.orbit || Math.abs(ms - o.orbitMs) > 5 * o.m.periodDays * 86_400_000) {
        const pts = moonOrbit(o.m.id, ms);
        if (pts) {
          if (o.orbit) {
            scene.remove(o.orbit);
            o.orbit.geometry.dispose();
            (o.orbit.material as THREE.Material).dispose();
          }
          o.orbit = new THREE.LineLoop(
            new THREE.BufferGeometry().setFromPoints(pts.map((p) => toScene(eqjToEcl(scale(p, 1 / AU_KM))))),
            new THREE.LineBasicMaterial({ color: o.m.color, transparent: true, opacity: 0.35 })
          );
          o.orbitMs = ms;
          scene.add(o.orbit);
        }
      }
      if (o.orbit) o.orbit.position.copy(planetMesh.position);
    }
  };

  // ── Frame ──
  let active = true;
  let raf = 0;
  const projected = new THREE.Vector3();
  const frame = () => {
    raf = requestAnimationFrame(frame);
    if (!active) return;
    const ms = getTimeMs();

    sun.scale.setScalar(Math.max(SUN_RADIUS_AU, MIN_SUN_PX * worldPerPixel(sun.position)));
    glow.scale.setScalar(Math.max(8, 26 * worldPerPixel(sun.position) / sun.scale.x));
    for (const p of PLANETS) {
      const mesh = planetMeshes.get(p.id)!;
      mesh.position.copy(toScene(helioEclipticAu(p.id, ms)));
      mesh.scale.setScalar(Math.max(p.radiusKm / AU_KM, MIN_PLANET_PX * worldPerPixel(mesh.position)));
    }
    updateMoons(ms);
    for (const o of paths) {
      const pos = o.path.position(ms);
      const anchor = o.path.anchor ? planetMeshes.get(o.path.anchor)!.position : null;
      if (anchor) {
        o.full.position.copy(anchor);
        o.flown.position.copy(anchor);
      }
      o.craft.visible = pos !== null;
      if (pos) o.craft.position.copy(toScene(pos));
      if (pos && anchor) o.craft.position.add(anchor);
      if (o.path.showProgress) {
        const times = o.path.times;
        let lo = 0;
        let hi = times.length;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (times[mid] <= ms) lo = mid + 1;
          else hi = mid;
        }
        o.flownGeometry.setDrawRange(0, lo);
      }
    }

    // Keep the focus centred: move camera and target together, easing in after a change of focus.
    const target = focusPosition();
    if (anim) {
      const k = Math.min(1, (performance.now() - anim.start) / FOCUS_ANIM_MS);
      const e = k * k * (3 - 2 * k);
      controls.target.lerpVectors(anim.fromTarget, target, e);
      const offset = anim.fromOffset.clone();
      if (anim.toDistance !== null) offset.setLength(THREE.MathUtils.lerp(anim.fromOffset.length(), anim.toDistance, e));
      camera.position.copy(controls.target).add(offset);
      if (k >= 1) anim = null;
    } else {
      const delta = target.clone().sub(controls.target);
      controls.target.add(delta);
      camera.position.add(delta);
    }
    controls.update();
    renderer.render(scene, camera);

    // Spacecraft and markers first, then planets; a label that would overlap one already placed moves down a line.
    const placed: { x: number; y: number; w: number }[] = [];
    for (const l of [...dynamicLabels, ...fixedLabels]) {
      const w = l.world();
      if (!w) {
        l.div.style.display = "none";
        continue;
      }
      projected.copy(w).project(camera);
      if (projected.z > 1 || Math.abs(projected.x) > 1.2 || Math.abs(projected.y) > 1.2) {
        l.div.style.display = "none";
        continue;
      }
      l.div.style.display = "block";
      const x = ((projected.x + 1) / 2) * width + 8;
      let y = ((1 - projected.y) / 2) * height - 7;
      const lw = l.div.offsetWidth || 60;
      for (let tries = 0; tries < 4 && placed.some((p) => x < p.x + p.w && p.x < x + lw && Math.abs(p.y - y) < LABEL_LINE_PX); tries++) y += LABEL_LINE_PX;
      placed.push({ x, y, w: lw });
      l.div.style.transform = `translate(${x}px, ${y}px)`;
    }
  };
  raf = requestAnimationFrame(frame);

  return {
    setPaths(next) {
      clearPaths();
      for (const path of next) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.BufferAttribute(rotateToScene(path.xyz), 3));
        const flownGeometry = new THREE.BufferGeometry();
        flownGeometry.setAttribute("position", geometry.getAttribute("position"));
        const full = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: path.color, transparent: true, opacity: path.showProgress ? 0.55 : 0.9 }));
        const flown = new THREE.Line(flownGeometry, new THREE.LineBasicMaterial({ color: path.color, transparent: true, opacity: 0.95 }));
        flown.visible = path.showProgress;
        const craft = new THREE.Sprite(new THREE.SpriteMaterial({ map: craftTexture, color: path.color, sizeAttenuation: false, depthTest: false, transparent: true }));
        craft.scale.setScalar(0.022);
        craft.renderOrder = 10;
        scene.add(full, flown, craft);
        paths.push({ path, full, flown, craft, geometry, flownGeometry });
      }
      rebuildDynamicLabels();
    },
    setMarkers(markers) {
      for (const m of markerObjects) {
        scene.remove(m);
        m.material.dispose();
      }
      for (const l of markerLabels) l.div.remove();
      markerObjects = markers.map((m) => {
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: ringTexture(), color: m.color, sizeAttenuation: false, depthTest: false, transparent: true }));
        s.scale.setScalar(0.03);
        s.position.copy(toScene(m.position));
        scene.add(s);
        return s;
      });
      markerLabels = markers.map((m, i) => makeLabel(m.label, m.color, () => markerObjects[i]?.position ?? null));
      rebuildDynamicLabels();
    },
    focus(target, distanceAu) {
      focus = target;
      anim = { start: performance.now(), fromTarget: controls.target.clone(), fromOffset: camera.position.clone().sub(controls.target), toDistance: distanceAu ?? null };
    },
    setActive(next) {
      active = next;
    },
    dispose() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      clearPaths();
      renderer.domElement.removeEventListener("pointerdown", onDown);
      renderer.domElement.removeEventListener("pointerup", onUp);
      controls.dispose();
      renderer.dispose();
      scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        mesh.geometry?.dispose?.();
        const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else mat?.dispose?.();
      });
      renderer.domElement.remove();
      labelLayer.remove();
    },
  };
}

function rotateToScene(xyz: Float32Array): Float32Array {
  const out = new Float32Array(xyz.length);
  for (let i = 0; i < xyz.length; i += 3) {
    out[i] = xyz[i];
    out[i + 1] = xyz[i + 2];
    out[i + 2] = -xyz[i + 1];
  }
  return out;
}

function starfield(): THREE.Points {
  const n = 2500;
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

function canvasTexture(draw: (ctx: CanvasRenderingContext2D, size: number) => void, size = 64): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  draw(c.getContext("2d")!, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function glowTexture() {
  return canvasTexture((ctx, s) => {
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, "rgba(255,255,255,0.9)");
    g.addColorStop(0.2, "rgba(255,220,150,0.35)");
    g.addColorStop(1, "rgba(255,200,120,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  }, 128);
}

/** A white dot with a dark rim; tinted by the sprite's colour. */
export function dotTexture() {
  return canvasTexture((ctx, s) => {
    ctx.beginPath();
    ctx.arc(s / 2, s / 2, s * 0.32, 0, Math.PI * 2);
    ctx.fillStyle = "#fff";
    ctx.fill();
    ctx.lineWidth = s * 0.08;
    ctx.strokeStyle = "rgba(0,0,0,0.85)";
    ctx.stroke();
  });
}

function ringTexture() {
  return canvasTexture((ctx, s) => {
    ctx.beginPath();
    ctx.arc(s / 2, s / 2, s * 0.36, 0, Math.PI * 2);
    ctx.lineWidth = s * 0.09;
    ctx.strokeStyle = "#fff";
    ctx.setLineDash([s * 0.12, s * 0.08]);
    ctx.stroke();
  });
}
