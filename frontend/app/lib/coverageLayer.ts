import * as THREE from "three";
import { EARTH_RADIUS_KM, GLOBE_RADIUS, polarToGlobe } from "./propagateBatch";

/**
 * Coverage footprint: the patch of Earth from which a satellite is above the horizon right now,
 * drawn as a translucent cap with an outline, centred under the satellite.
 */
export type CoverageLayer = {
  show: (latitude: number, longitude: number, altitudeKm: number, color: string) => void;
  hide: () => void;
  dispose: () => void;
};

// Just above the country borders (drawn at 0.5% altitude): their invisible fills would otherwise hide it over land.
const CAP_RADIUS = GLOBE_RADIUS * 1.007;
const RING_SEGMENTS = 128;
/** Rebuild the cap geometry only when its angular size changes noticeably. */
const REBUILD_THRESHOLD_RAD = 0.002;

/**
 * Angular radius (radians, measured at Earth's centre) of the area that sees the satellite at or
 * above minElevationDeg.
 */
export function footprintAngle(altitudeKm: number, minElevationDeg = 0): number {
  const e = (minElevationDeg * Math.PI) / 180;
  const ratio = (EARTH_RADIUS_KM * Math.cos(e)) / (EARTH_RADIUS_KM + Math.max(0, altitudeKm));
  return Math.acos(Math.min(1, ratio)) - e;
}

export function createCoverageLayer(scene: THREE.Scene): CoverageLayer {
  const group = new THREE.Group();
  group.visible = false;
  scene.add(group);

  const fillMaterial = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0.14,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const lineMaterial = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.85 });
  let fill: THREE.Mesh | null = null;
  let ring: THREE.LineLoop | null = null;
  let builtAngle = -1;

  const up = new THREE.Vector3(0, 1, 0);
  const dir = new THREE.Vector3();
  const tmp = new Float32Array(3);

  // Geometry is built as a cap around +Y, then the group is rotated so +Y points at the sub-satellite point.
  function build(angle: number) {
    fill?.geometry.dispose();
    ring?.geometry.dispose();
    if (fill) group.remove(fill);
    if (ring) group.remove(ring);

    fill = new THREE.Mesh(new THREE.SphereGeometry(CAP_RADIUS, 64, 12, 0, Math.PI * 2, 0, angle), fillMaterial);
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < RING_SEGMENTS; i++) {
      const t = (i / RING_SEGMENTS) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.sin(angle) * Math.cos(t), Math.cos(angle), Math.sin(angle) * Math.sin(t)).multiplyScalar(CAP_RADIUS));
    }
    ring = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), lineMaterial);
    group.add(fill, ring);
    builtAngle = angle;
  }

  return {
    show(latitude, longitude, altitudeKm, color) {
      const angle = footprintAngle(altitudeKm);
      if (Math.abs(angle - builtAngle) > REBUILD_THRESHOLD_RAD) build(angle);
      polarToGlobe(latitude, longitude, 0, tmp, 0);
      dir.set(tmp[0], tmp[1], tmp[2]).normalize();
      group.quaternion.setFromUnitVectors(up, dir);
      fillMaterial.color.set(color);
      lineMaterial.color.set(color);
      group.visible = true;
    },
    hide() {
      group.visible = false;
    },
    dispose() {
      scene.remove(group);
      fill?.geometry.dispose();
      ring?.geometry.dispose();
      fillMaterial.dispose();
      lineMaterial.dispose();
    },
  };
}
