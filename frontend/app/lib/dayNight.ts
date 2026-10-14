import * as satellite from "satellite.js";
import * as THREE from "three";
import { sunEci } from "./passes";
import { polarToGlobe } from "./propagateBatch";

/**
 * Day/night shading on the globe, following the Sun at the globe's (possibly simulated) time.
 *
 * Implemented as a small hook into the globe's own material rather than an extra layer, so grid
 * lines, borders and clouds drawn on top are unaffected and every map style keeps working:
 *  - "paint day": over the night (city lights) texture, the sunlit side shows the daytime Earth
 *  - otherwise: the night side of whatever texture is shown is darkened
 * A soft band of about ±5° around the terminator blends the two.
 */
export type DayNight = {
  setEnabled: (enabled: boolean) => void;
  /** paintDay when the base texture is the night image; nightDim is how dark the night side gets otherwise. */
  setStyle: (style: { paintDay: boolean; nightDim: number }) => void;
  /** Unit vector toward the Sun in globe scene coordinates at timeMs. */
  sunDirection: (timeMs: number) => THREE.Vector3;
  dispose: () => void;
};

const DAY_TEXTURE_URL = "//unpkg.com/three-globe/example/img/earth-day.jpg";

export function createDayNight(globe: { globeMaterial: () => THREE.Material }, getTimeMs: () => number): DayNight {
  const dayMap = new THREE.TextureLoader().load(DAY_TEXTURE_URL);
  dayMap.colorSpace = THREE.SRGBColorSpace; // same as three-globe's own globe texture

  const uniforms = {
    dnEnabled: { value: 0 }, // GlobeView turns it on via setEnabled
    dnPaintDay: { value: 1 },
    dnNightDim: { value: 0.65 },
    dnSunDir: { value: new THREE.Vector3(1, 0, 0) },
    dnDayMap: { value: dayMap },
  };

  const material = globe.globeMaterial() as THREE.MeshPhongMaterial;
  const previousOnBeforeCompile = material.onBeforeCompile;
  const previousCacheKey = material.customProgramCacheKey;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vDnWorldNormal;")
      .replace(
        "#include <beginnormal_vertex>",
        "#include <beginnormal_vertex>\nvDnWorldNormal = normalize(mat3(modelMatrix) * objectNormal);"
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
varying vec3 vDnWorldNormal;
uniform float dnEnabled;
uniform float dnPaintDay;
uniform float dnNightDim;
uniform vec3 dnSunDir;
uniform sampler2D dnDayMap;`
      )
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
if (dnEnabled > 0.5) {
  float dnDay = smoothstep(-0.08, 0.08, dot(normalize(vDnWorldNormal), dnSunDir));
  if (dnPaintDay > 0.5) {
    diffuseColor.rgb = mix(diffuseColor.rgb, texture2D(dnDayMap, vMapUv).rgb, dnDay);
  } else {
    diffuseColor.rgb *= mix(1.0 - dnNightDim, 1.0, dnDay);
  }
}`
      );
  };
  material.customProgramCacheKey = () => "lune-day-night";
  material.needsUpdate = true;

  const sunDirection = (timeMs: number) => {
    const date = new Date(timeMs);
    const ecf = satellite.eciToEcf(sunEci(timeMs), satellite.gstime(date));
    const lat = (Math.atan2(ecf.z, Math.hypot(ecf.x, ecf.y)) * 180) / Math.PI;
    const lng = (Math.atan2(ecf.y, ecf.x) * 180) / Math.PI;
    const p = new Float32Array(3);
    polarToGlobe(lat, lng, 0, p, 0);
    return new THREE.Vector3(p[0], p[1], p[2]).normalize();
  };

  // The Sun moves slowly (in real time); updating its direction each frame keeps up with fast time controls too.
  let frameId = requestAnimationFrame(function loop() {
    uniforms.dnSunDir.value.copy(sunDirection(getTimeMs()));
    frameId = requestAnimationFrame(loop);
  });

  return {
    setEnabled: (enabled) => {
      uniforms.dnEnabled.value = enabled ? 1 : 0;
    },
    setStyle: ({ paintDay, nightDim }) => {
      uniforms.dnPaintDay.value = paintDay ? 1 : 0;
      uniforms.dnNightDim.value = nightDim;
    },
    sunDirection,
    dispose: () => {
      cancelAnimationFrame(frameId);
      material.onBeforeCompile = previousOnBeforeCompile;
      material.customProgramCacheKey = previousCacheKey;
      material.needsUpdate = true;
      dayMap.dispose();
    },
  };
}
