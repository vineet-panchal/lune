import * as Astronomy from "astronomy-engine";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { dotTexture } from "./solarSystemScene";
import { EARTH_RADIUS_KM, earthRotationRad, flightPath, flightState, type Flight } from "./launch";
import type { LaunchSite } from "./launchSites";
import type { Vec3 } from "./vec";

/**
 * Close to Earth for the launch: the turning globe with the pad on it, the climb, the parking orbit and the
 * start of the escape. Geocentric J2000 equatorial, 1 unit = Earth's equatorial radius.
 * Scene axes: x = EQJ x, y = celestial north, z = −EQJ y (the globe texture lines up when rotated by GMST).
 */
export type EarthScene = {
  setFlight: (flight: Flight | null, sites: LaunchSite[]) => void;
  /** Keep the camera on the rocket / spacecraft, or let it look at the whole Earth. */
  setFollow: (follow: boolean) => void;
  setActive: (active: boolean) => void;
  dispose: () => void;
};

const R = EARTH_RADIUS_KM;
const toScene = (v: Vec3, k = 1 / R) => new THREE.Vector3(v[0] * k, v[2] * k, -v[1] * k);
const EARTH_TEXTURE = "https://unpkg.com/three-globe@2.45.0/example/img/earth-blue-marble.jpg";

export function createEarthScene(el: HTMLElement, getTimeMs: () => number): EarthScene {
  const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000003);
  renderer.domElement.style.display = "block";
  el.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 1e-5, 1e5);
  camera.position.set(0, 1.5, 4.5);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 0.002;
  controls.maxDistance = 400;

  scene.add(new THREE.AmbientLight(0xffffff, 0.35));
  const sunLight = new THREE.DirectionalLight(0xffffff, 2.2);
  scene.add(sunLight);
  scene.add(stars());

  const earth = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 48), new THREE.MeshPhongMaterial({ color: 0xffffff, shininess: 8 }));
  new THREE.TextureLoader().load(EARTH_TEXTURE, (tex) => {
    tex.colorSpace = THREE.SRGBColorSpace;
    (earth.material as THREE.MeshPhongMaterial).map = tex;
    (earth.material as THREE.MeshPhongMaterial).needsUpdate = true;
  });
  const atmosphere = new THREE.Mesh(
    new THREE.SphereGeometry(1.015, 64, 32),
    new THREE.MeshBasicMaterial({ color: 0x5fa0ff, transparent: true, opacity: 0.12, side: THREE.BackSide })
  );
  scene.add(earth, atmosphere);

  const moon = new THREE.Mesh(new THREE.SphereGeometry(1737.4 / R, 32, 16), new THREE.MeshLambertMaterial({ color: 0xb8b4ac }));
  scene.add(moon);

  // Pads: children of the globe so they turn with it.
  const padGroup = new THREE.Group();
  const padTexture = dotTexture();
  earth.add(padGroup);

  const lineGroup = new THREE.Group();
  scene.add(lineGroup);
  const craft = new THREE.Sprite(new THREE.SpriteMaterial({ map: dotTexture(), color: 0xffb74d, sizeAttenuation: false, depthTest: false, transparent: true }));
  craft.scale.setScalar(0.02);
  craft.renderOrder = 10;
  craft.visible = false;
  scene.add(craft);

  // Labels
  const labelLayer = document.createElement("div");
  Object.assign(labelLayer.style, { position: "absolute", inset: "0", pointerEvents: "none", overflow: "hidden" });
  el.appendChild(labelLayer);
  type Label = { div: HTMLDivElement; world: () => THREE.Vector3 | null };
  const label = (text: string, color: string, world: () => THREE.Vector3 | null, strong = false): Label => {
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
    return { div, world };
  };
  const moonLabel = label("Moon", "#b8b4ac", () => moon.position);

  let flight: Flight | null = null;
  let follow = true;
  let lastCraftDir: THREE.Vector3 | null = null;
  let craftLabel: Label | null = null;
  let padLabels: Label[] = [];

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

  let active = true;
  let raf = 0;
  const projected = new THREE.Vector3();
  const frame = () => {
    raf = requestAnimationFrame(frame);
    if (!active) return;
    const ms = getTimeMs();
    const date = new Date(ms);
    earth.rotation.y = earthRotationRad(ms);
    const sunDir = Astronomy.GeoVector(Astronomy.Body.Sun, date, false);
    sunLight.position.copy(toScene([sunDir.x, sunDir.y, sunDir.z], 1).normalize().multiplyScalar(50));
    const m = Astronomy.GeoVector(Astronomy.Body.Moon, date, false);
    moon.position.copy(toScene([m.x * 149_597_870.7, m.y * 149_597_870.7, m.z * 149_597_870.7]));

    if (flight) {
      const s = flightState(flight, ms);
      craft.visible = true;
      craft.position.copy(toScene(s.r));
      if (follow) {
        // Keep the camera where it was relative to the craft and the ground below it: turn its offset by however
        // far the craft has moved round Earth, so a jump half an orbit ahead doesn't leave it inside the planet.
        const offset = camera.position.clone().sub(controls.target);
        const dir = craft.position.clone().normalize();
        if (lastCraftDir) offset.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(lastCraftDir, dir));
        lastCraftDir = dir;
        controls.target.copy(craft.position);
        camera.position.copy(craft.position).add(offset);
      }
    } else {
      craft.visible = false;
    }
    controls.update();
    renderer.render(scene, camera);

    for (const l of [moonLabel, ...padLabels, ...(craftLabel ? [craftLabel] : [])]) {
      const w = l.world();
      if (!w) {
        l.div.style.display = "none";
        continue;
      }
      projected.copy(w).project(camera);
      // Hide labels behind the globe as well as off screen.
      const hidden = projected.z > 1 || Math.abs(projected.x) > 1.2 || Math.abs(projected.y) > 1.2 || behindEarth(camera.position, w);
      l.div.style.display = hidden ? "none" : "block";
      if (!hidden) l.div.style.transform = `translate(${((projected.x + 1) / 2) * width + 8}px, ${((1 - projected.y) / 2) * height - 7}px)`;
    }
  };
  raf = requestAnimationFrame(frame);

  const clearLines = () => {
    for (const child of [...lineGroup.children]) {
      lineGroup.remove(child);
      const l = child as THREE.Line;
      l.geometry.dispose();
      (l.material as THREE.Material).dispose();
    }
  };

  return {
    setFlight(next, sites) {
      flight = next;
      clearLines();
      for (const l of padLabels) l.div.remove();
      for (const child of [...padGroup.children]) {
        padGroup.remove(child);
        (child as THREE.Sprite).material.dispose();
      }
      craftLabel?.div.remove();
      craftLabel = null;
      padLabels = [];

      for (const site of sites) {
        const chosen = next?.site.id === site.id;
        const lat = (site.latDeg * Math.PI) / 180;
        const lon = (site.lngDeg * Math.PI) / 180;
        // A dot of fixed size on screen, so it reads the same from orbit and from just above the pad.
        const dot = new THREE.Sprite(new THREE.SpriteMaterial({ map: padTexture, color: chosen ? 0xffd54f : 0x8fb4f0, sizeAttenuation: false, transparent: true }));
        dot.scale.setScalar(chosen ? 0.014 : 0.009);
        dot.position.set(Math.cos(lat) * Math.cos(lon), Math.sin(lat), -Math.cos(lat) * Math.sin(lon)).multiplyScalar(1.0005);
        padGroup.add(dot);
        if (chosen) padLabels.push(label(site.short, "#ffd54f", () => dot.getWorldPosition(new THREE.Vector3())));
      }
      if (!next) return;

      const path = flightPath(next);
      const line = (pts: Vec3[], color: number, opacity: number, dashed = false) => {
        const g = new THREE.BufferGeometry().setFromPoints(pts.map((p) => toScene(p)));
        const mat = dashed
          ? new THREE.LineDashedMaterial({ color, transparent: true, opacity, dashSize: 0.03, gapSize: 0.02 })
          : new THREE.LineBasicMaterial({ color, transparent: true, opacity });
        const l = new THREE.Line(g, mat);
        if (dashed) l.computeLineDistances();
        lineGroup.add(l);
      };
      line(path.ascent, 0xffb74d, 0.95);
      line(path.parking, 0xe0e6f0, 0.55, true);
      if (next.perf.canDo) line(path.escape, 0x7fb2ff, 0.9);
      craftLabel = label(next.vehicle.name, "#ffb74d", () => (craft.visible ? craft.position : null), true);

      // Start near the pad, looking along the way the rocket will fly.
      lastCraftDir = null;
      const pad = toScene(next.window.padDir, 1);
      controls.target.copy(pad);
      camera.position.copy(pad.clone().multiplyScalar(1.35).add(toScene(next.window.normal, 1).multiplyScalar(-0.25)));
    },
    setFollow(next) {
      follow = next;
      if (!next) {
        controls.target.set(0, 0, 0);
        camera.position.set(0, 1.5, 4.5);
      }
    },
    setActive(next) {
      active = next;
    },
    dispose() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      clearLines();
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

/** Whether Earth (radius 1 at the origin) blocks the line of sight from the camera to a point. */
function behindEarth(cam: THREE.Vector3, p: THREE.Vector3): boolean {
  const d = p.clone().sub(cam);
  const len = d.length();
  d.divideScalar(len);
  const t = -cam.dot(d);
  if (t <= 0 || t >= len) return false;
  const closest = cam.clone().add(d.multiplyScalar(t));
  return closest.length() < 0.995;
}

function stars(): THREE.Points {
  const n = 2000;
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const u = Math.random() * 2 - 1;
    const th = Math.random() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    pos.set([s * Math.cos(th) * 5e4, u * 5e4, s * Math.sin(th) * 5e4], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  return new THREE.Points(g, new THREE.PointsMaterial({ color: 0x9aa4b8, size: 1.2, sizeAttenuation: false, transparent: true, opacity: 0.7 }));
}
