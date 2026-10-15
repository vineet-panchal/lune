import * as THREE from "three";
import { flightState, type Flight } from "./launch";
import type { Stage } from "./vehicles";

/**
 * A close-up 3D model of the rocket, built from each stage's real length and diameter: boosters, core, upper
 * stage, fairing and a generic spacecraft. It follows the flight: engines light and shut down, spent stages
 * and the fairing fall away, and the spacecraft flies on alone after separation. Units are metres, y up.
 */
export type RocketView = {
  setFlight: (flight: Flight | null) => void;
  setActive: (active: boolean) => void;
  dispose: () => void;
};

/** How long a dropped part stays in view (s of flight time). */
const DROP_VISIBLE_S = 30;

type Part = { obj: THREE.Object3D; sepS: () => number | null; drift: THREE.Vector3; spin: THREE.Vector3 };

export function createRocketView(el: HTMLElement, getTimeMs: () => number): RocketView {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.domElement.style.display = "block";
  el.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 5000);
  scene.add(new THREE.AmbientLight(0xffffff, 0.55));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(40, 60, 50);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x88aaff, 0.8);
  rim.position.set(-50, 20, -40);
  scene.add(rim);

  let root = new THREE.Group();
  scene.add(root);
  let parts: Part[] = [];
  let plumes: { mesh: THREE.Mesh; when: (firing: string | null) => boolean }[] = [];
  let spacecraft: THREE.Object3D | null = null;
  let flight: Flight | null = null;

  const resize = () => {
    const w = Math.max(1, el.clientWidth);
    const h = Math.max(1, el.clientHeight);
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(el);

  let active = true;
  let raf = 0;
  const frame = () => {
    raf = requestAnimationFrame(frame);
    if (!active || !flight) {
      renderer.render(scene, camera);
      return;
    }
    const ms = getTimeMs();
    const tS = (ms - flight.window.launchMs) / 1000;
    const state = flightState(flight, ms);

    // Spent parts fall behind (down, in the rocket's frame) and tumble.
    let lowestAttached = Infinity;
    let highest = 0;
    for (const p of parts) {
      const sep = p.sepS();
      const base = p.obj.userData.base as THREE.Vector3;
      if (sep === null || tS < sep) {
        p.obj.visible = true;
        p.obj.position.copy(base);
        p.obj.rotation.set(0, 0, 0);
        const box = new THREE.Box3().setFromObject(p.obj);
        lowestAttached = Math.min(lowestAttached, box.min.y);
        highest = Math.max(highest, box.max.y);
        continue;
      }
      const dt = tS - sep;
      p.obj.visible = dt < DROP_VISIBLE_S;
      p.obj.position.copy(base).addScaledVector(p.drift, dt).add(new THREE.Vector3(0, -1.6 * dt * dt, 0));
      p.obj.rotation.set(p.spin.x * dt, p.spin.y * dt, p.spin.z * dt);
    }
    if (spacecraft) {
      spacecraft.visible = !state.attached.fairing;
      const box = new THREE.Box3().setFromObject(spacecraft);
      highest = Math.max(highest, box.max.y);
      if (!state.attached.upper) lowestAttached = box.min.y;
    }
    const flicker = 0.85 + Math.random() * 0.3;
    for (const pl of plumes) {
      pl.mesh.visible = pl.when(state.firing);
      pl.mesh.scale.set(1, flicker, 1);
    }

    // Frame what's still flying, turning slowly around it.
    if (!Number.isFinite(lowestAttached)) lowestAttached = 0;
    const span = Math.max(6, highest - lowestAttached);
    const centre = (highest + lowestAttached) / 2;
    const dist = span * 2.1;
    const angle = performance.now() / 9000;
    camera.position.set(Math.sin(angle) * dist, centre + span * 0.15, Math.cos(angle) * dist);
    camera.lookAt(0, centre, 0);
    renderer.render(scene, camera);
  };
  raf = requestAnimationFrame(frame);

  const build = (f: Flight) => {
    scene.remove(root);
    disposeTree(root);
    root = new THREE.Group();
    scene.add(root);
    parts = [];
    plumes = [];
    const v = f.vehicle;
    const p = f.perf;
    const departEndS = (f.departMs - f.window.launchMs) / 1000 + p.departBurnS / 2;

    const coreR = v.core.diameterM / 2;
    const add = (obj: THREE.Object3D, sepS: () => number | null, drift: THREE.Vector3, spin: THREE.Vector3) => {
      obj.userData.base = obj.position.clone();
      root.add(obj);
      parts.push({ obj, sepS, drift, spin });
    };

    // Core with engines.
    const core = stageMesh(v.core, true);
    add(core, () => p.mecoS + 3, new THREE.Vector3(0, -2, 0), new THREE.Vector3(0.02, 0, 0.05));
    plumes.push({ mesh: plume(coreR * 0.9, v.core.lengthM * 0.5, core, 0), when: (fire) => fire === "core" || fire === "boosters+core" });

    // Boosters around the core.
    if (v.boosters) {
      const b = v.boosters;
      const r = b.diameterM / 2;
      for (let i = 0; i < b.count; i++) {
        const a = (i / b.count) * Math.PI * 2 + Math.PI / 4;
        const mesh = stageMesh(b, true);
        mesh.position.set(Math.cos(a) * (coreR + r + 0.05), 0, Math.sin(a) * (coreR + r + 0.05));
        add(mesh, () => p.boosterSepS, new THREE.Vector3(Math.cos(a) * 3, -1, Math.sin(a) * 3), new THREE.Vector3(Math.sin(a) * 0.15, 0, -Math.cos(a) * 0.15));
        plumes.push({ mesh: plume(r * 0.9, b.lengthM * 0.6, mesh, 0), when: (fire) => fire === "boosters+core" });
      }
    }

    // Interstage and upper stage.
    let y = v.core.lengthM;
    const upperR = v.upper.diameterM / 2;
    const interstage = new THREE.Mesh(new THREE.CylinderGeometry(upperR, coreR, Math.max(1.5, v.upper.lengthM * 0.25), 32, 1, true), new THREE.MeshStandardMaterial({ color: 0x2b2d31, roughness: 0.8, side: THREE.DoubleSide }));
    interstage.position.y = y + Math.max(1.5, v.upper.lengthM * 0.25) / 2;
    add(interstage, () => p.mecoS + 3, new THREE.Vector3(0, -2, 0), new THREE.Vector3(0.03, 0, 0.04));
    y += Math.max(1.5, v.upper.lengthM * 0.25) * 0.4;
    const upper = stageMesh(v.upper, true);
    upper.position.y = y;
    add(upper, () => departEndS + 300, new THREE.Vector3(0, -0.6, 0.4), new THREE.Vector3(0.01, 0.02, 0.03));
    plumes.push({ mesh: plume(upperR * 0.55, v.upper.lengthM * 1.1, upper, 0), when: (fire) => fire === "upper" });
    y += v.upper.lengthM;

    // Spacecraft (generic) on top, inside the fairing until it opens.
    spacecraft = genericSpacecraft(Math.min(v.fairing.diameterM * 0.7, 4));
    spacecraft.position.y = y + 0.4;
    root.add(spacecraft);

    // Fairing halves.
    if (v.fairingKg > 0) {
      const fr = v.fairing.diameterM / 2;
      const cyl = v.fairing.lengthM * 0.62;
      const cone = v.fairing.lengthM - cyl;
      for (const side of [0, 1]) {
        const half = new THREE.Group();
        const mat = new THREE.MeshStandardMaterial({ color: v.fairing.color, roughness: 0.55, side: THREE.DoubleSide });
        const body = new THREE.Mesh(new THREE.CylinderGeometry(fr, fr, cyl, 32, 1, true, side * Math.PI, Math.PI), mat);
        body.position.y = cyl / 2;
        const nose = new THREE.Mesh(new THREE.CylinderGeometry(0.25, fr, cone, 32, 1, true, side * Math.PI, Math.PI), mat);
        nose.position.y = cyl + cone / 2;
        half.add(body, nose);
        half.position.y = y;
        const out = side === 0 ? 1 : -1;
        add(half, () => Math.max(v.fairingSepS, p.boosterSepS ?? 0), new THREE.Vector3(0, -1, out * 2.5), new THREE.Vector3(out * 0.25, 0, 0));
      }
    }
  };

  return {
    setFlight(next) {
      flight = next;
      if (next) build(next);
      else {
        scene.remove(root);
        disposeTree(root);
        root = new THREE.Group();
        scene.add(root);
        parts = [];
        plumes = [];
        spacecraft = null;
      }
    },
    setActive(next) {
      active = next;
    },
    dispose() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      disposeTree(scene);
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}

/** A stage as a cylinder with a nose (boosters) or flat top, and engine bells underneath. */
function stageMesh(s: Stage, withEngines: boolean): THREE.Group {
  const g = new THREE.Group();
  const r = s.diameterM / 2;
  const mat = new THREE.MeshStandardMaterial({ color: s.color, roughness: 0.6, metalness: 0.05 });
  const isBooster = s.name.toLowerCase().includes("booster") && s.diameterM < 4;
  const bodyLen = isBooster ? s.lengthM * 0.9 : s.lengthM;
  const body = new THREE.Mesh(new THREE.CylinderGeometry(r, r, bodyLen, 32), mat);
  body.position.y = bodyLen / 2;
  g.add(body);
  if (isBooster) {
    const nose = new THREE.Mesh(new THREE.ConeGeometry(r, s.lengthM * 0.1, 32), mat);
    nose.position.y = bodyLen + s.lengthM * 0.05;
    g.add(nose);
  }
  // A dark band near the top, like the black interstage / tank domes on real stages.
  const band = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.002, r * 1.002, Math.min(1.2, bodyLen * 0.04), 32), new THREE.MeshStandardMaterial({ color: 0x3a3d44, roughness: 0.7 }));
  band.position.y = bodyLen * 0.97;
  g.add(band);
  if (withEngines) {
    const bell = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.35, r * 0.75, Math.max(0.8, r * 0.7), 24, 1, true), new THREE.MeshStandardMaterial({ color: 0x5b5e66, metalness: 0.6, roughness: 0.35, side: THREE.DoubleSide }));
    bell.position.y = -Math.max(0.8, r * 0.7) / 2;
    g.add(bell);
  }
  return g;
}

/** Exhaust: a glowing cone pointing down from the bottom of a part (added as a child, so it moves with it). */
function plume(radius: number, length: number, parent: THREE.Object3D, y: number): THREE.Mesh {
  const geo = new THREE.ConeGeometry(radius, length, 24, 1, true);
  geo.translate(0, -length / 2, 0);
  geo.rotateX(Math.PI);
  geo.translate(0, -length, 0);
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
  );
  mesh.position.y = y - 0.5;
  mesh.visible = false;
  parent.add(mesh);
  return mesh;
}

/** A generic probe: gold-foil bus, two solar wings and a high-gain dish. */
function genericSpacecraft(size: number): THREE.Group {
  const g = new THREE.Group();
  const bus = new THREE.Mesh(new THREE.BoxGeometry(size * 0.5, size * 0.55, size * 0.5), new THREE.MeshStandardMaterial({ color: 0xc9a24a, metalness: 0.7, roughness: 0.35 }));
  bus.position.y = size * 0.3;
  g.add(bus);
  const panelMat = new THREE.MeshStandardMaterial({ color: 0x1d2c5a, metalness: 0.3, roughness: 0.4, side: THREE.DoubleSide });
  for (const side of [-1, 1]) {
    const wing = new THREE.Mesh(new THREE.BoxGeometry(size * 0.9, size * 0.02, size * 0.38), panelMat);
    wing.position.set(side * size * 0.72, size * 0.3, 0);
    g.add(wing);
  }
  const dish = new THREE.Mesh(new THREE.SphereGeometry(size * 0.3, 24, 8, 0, Math.PI * 2, 0, Math.PI / 3.2), new THREE.MeshStandardMaterial({ color: 0xe6e6e6, side: THREE.DoubleSide }));
  dish.rotation.x = Math.PI;
  dish.position.y = size * 0.85;
  g.add(dish);
  return g;
}

function disposeTree(obj: THREE.Object3D) {
  obj.traverse((o) => {
    const mesh = o as THREE.Mesh;
    mesh.geometry?.dispose?.();
    const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
    else mat?.dispose?.();
  });
}

