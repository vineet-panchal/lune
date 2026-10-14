import * as THREE from "three";
import type { CoverageGrid } from "./coverage";
import { GLOBE_RADIUS } from "./propagateBatch";

/**
 * The coverage map drawn on the globe: a translucent sphere just above the surface whose texture colours each cell
 * by how many satellites it can see. Mapped like the globe's own Earth texture (equirectangular, west to east), so
 * cells line up with the country borders.
 */
export type CoverageHeatmap = {
  show: (grid: CoverageGrid) => void;
  hide: () => void;
  dispose: () => void;
};

// Above the borders (0.5% altitude) so it isn't hidden by their invisible fills; below the satellites.
const RADIUS = GLOBE_RADIUS * 1.006;

export function createCoverageHeatmap(scene: THREE.Scene): CoverageHeatmap {
  const canvas = document.createElement("canvas");
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(RADIUS, 96, 48), material);
  mesh.rotation.y = -Math.PI / 2; // same as three-globe's Earth, so the texture's longitudes line up
  mesh.visible = false;
  scene.add(mesh);

  return {
    show(grid) {
      canvas.width = grid.cols;
      canvas.height = grid.rows;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const image = ctx.createImageData(grid.cols, grid.rows);
      for (let i = 0; i < grid.counts.length; i++) {
        const [r, g, b, a] = heatColor(grid.counts[i], grid.max);
        image.data[i * 4] = r;
        image.data[i * 4 + 1] = g;
        image.data[i * 4 + 2] = b;
        image.data[i * 4 + 3] = a;
      }
      ctx.putImageData(image, 0, 0);
      texture.needsUpdate = true;
      mesh.visible = true;
    },
    hide() {
      mesh.visible = false;
    },
    dispose() {
      scene.remove(mesh);
      mesh.geometry.dispose();
      material.dispose();
      texture.dispose();
    },
  };
}

/** Transparent where nothing is overhead, through blue and cyan to yellow at the busiest cells. */
export function heatColor(count: number, max: number): [number, number, number, number] {
  if (count === 0 || max === 0) return [0, 0, 0, 0];
  const t = Math.min(1, count / max);
  const stops: [number, number, number][] = [
    [30, 60, 160],
    [0, 190, 230],
    [120, 230, 120],
    [255, 220, 60],
  ];
  const x = t * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  const f = x - i;
  const mix = (k: number) => Math.round(stops[i][k] + (stops[i + 1][k] - stops[i][k]) * f);
  return [mix(0), mix(1), mix(2), Math.round(70 + 120 * t)];
}
