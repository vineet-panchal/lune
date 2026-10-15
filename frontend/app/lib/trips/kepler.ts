import { add, cross, dot, norm, scale, sub, type Vec3 } from "./vec";

/**
 * Two-body orbital mechanics with universal variables (Curtis, "Orbital Mechanics for Engineering Students",
 * ch. 3 and 5; Vallado, "Fundamentals of Astrodynamics", §7.6). Works for ellipses and hyperbolas alike.
 * Units are whatever mu is in: km, s and km³/s² here.
 */

/** Stumpff functions C(z) and S(z). */
export function stumpffC(z: number): number {
  if (z > 1e-6) return (1 - Math.cos(Math.sqrt(z))) / z;
  if (z < -1e-6) return (Math.cosh(Math.sqrt(-z)) - 1) / -z;
  return 1 / 2 - z / 24 + (z * z) / 720;
}

export function stumpffS(z: number): number {
  if (z > 1e-6) {
    const s = Math.sqrt(z);
    return (s - Math.sin(s)) / (s * s * s);
  }
  if (z < -1e-6) {
    const s = Math.sqrt(-z);
    return (Math.sinh(s) - s) / (s * s * s);
  }
  return 1 / 6 - z / 120 + (z * z) / 5040;
}

/** Where a body on (r0, v0) is dt seconds later (negative dt goes back). */
export function propagate(r0: Vec3, v0: Vec3, dt: number, mu: number): { r: Vec3; v: Vec3 } {
  if (dt === 0) return { r: r0, v: v0 };
  const r0n = norm(r0);
  const vr0 = dot(r0, v0) / r0n;
  const alpha = 2 / r0n - dot(v0, v0) / mu; // 1/a
  const sqrtMu = Math.sqrt(mu);

  // Newton on Kepler's equation in the universal anomaly chi.
  let chi = alpha > 0 ? sqrtMu * Math.abs(alpha) * dt : Math.sign(dt) * Math.sqrt(-1 / alpha) * Math.log(Math.max(1e-12, (-2 * mu * alpha * dt) / (dot(r0, v0) + Math.sign(dt) * Math.sqrt(-mu / alpha) * (1 - r0n * alpha))));
  if (!Number.isFinite(chi)) chi = sqrtMu * Math.abs(alpha) * dt;
  for (let i = 0; i < 60; i++) {
    const z = alpha * chi * chi;
    const C = stumpffC(z);
    const S = stumpffS(z);
    const F = ((r0n * vr0) / sqrtMu) * chi * chi * C + (1 - alpha * r0n) * chi * chi * chi * S + r0n * chi - sqrtMu * dt;
    const dF = ((r0n * vr0) / sqrtMu) * chi * (1 - z * S) + (1 - alpha * r0n) * chi * chi * C + r0n;
    const step = F / dF;
    chi -= step;
    if (Math.abs(step) < 1e-9 * Math.max(1, Math.abs(chi))) break;
  }

  const z = alpha * chi * chi;
  const C = stumpffC(z);
  const S = stumpffS(z);
  const f = 1 - ((chi * chi) / r0n) * C;
  const g = dt - (chi * chi * chi * S) / sqrtMu;
  const r = add(scale(r0, f), scale(v0, g));
  const rn = norm(r);
  const fdot = (sqrtMu / (rn * r0n)) * (alpha * chi * chi * chi * S - chi);
  const gdot = 1 - ((chi * chi) / rn) * C;
  return { r, v: add(scale(r0, fdot), scale(v0, gdot)) };
}

export type LambertResult = { v1: Vec3; v2: Vec3; longWay: boolean };

/**
 * The orbit from r1 to r2 in exactly tof seconds, going round `normal` the way the planets do (no full extra
 * revolutions). Solved by bisection on the universal variable psi (Vallado's robust form), which always
 * converges when a solution exists. Null when it doesn't (r1 and r2 exactly opposite or coincident).
 */
export function lambert(r1: Vec3, r2: Vec3, tof: number, mu: number, normal: Vec3): LambertResult | null {
  const r1n = norm(r1);
  const r2n = norm(r2);
  const cosDnu = dot(r1, r2) / (r1n * r2n);
  // Short way when r1 → r2 turns anticlockwise about the normal, long way (over 180°) otherwise.
  const longWay = dot(cross(r1, r2), normal) < 0;
  const sinDnu = (longWay ? -1 : 1) * Math.sqrt(Math.max(0, 1 - cosDnu * cosDnu));
  const A = sinDnu * Math.sqrt((r1n * r2n) / (1 - cosDnu));
  if (!Number.isFinite(A) || Math.abs(A) < 1e-9 * Math.sqrt(r1n * r2n)) return null;

  const sqrtMu = Math.sqrt(mu);
  let low = -4 * Math.PI;
  let high = 4 * Math.PI * Math.PI;
  let psi = 0;
  let y = 0;
  for (let i = 0; i < 200; i++) {
    const C = stumpffC(psi);
    const S = stumpffS(psi);
    y = r1n + r2n + (A * (psi * S - 1)) / Math.sqrt(C);
    if (A > 0 && y < 0) {
      // Too hyperbolic: y must stay positive, so move the lower bound up.
      low = psi;
      psi = (low + high) / 2;
      continue;
    }
    const chi = Math.sqrt(y / C);
    const t = (chi * chi * chi * S + A * Math.sqrt(y)) / sqrtMu;
    if (Math.abs(t - tof) < 1e-6 * tof) break;
    if (t <= tof) low = psi;
    else high = psi;
    psi = (low + high) / 2;
    if (high - low < 1e-12) break;
  }
  if (!(y > 0)) return null;

  const f = 1 - y / r1n;
  const g = A * Math.sqrt(y / mu);
  const gdot = 1 - y / r2n;
  const v1 = scale(sub(r2, scale(r1, f)), 1 / g);
  const v2 = scale(sub(scale(r2, gdot), r1), 1 / g);
  if (!v1.every(Number.isFinite) || !v2.every(Number.isFinite)) return null;
  return { v1, v2, longWay };
}

export type Elements = {
  /** Semi-major axis (negative for a hyperbola). */
  a: number;
  e: number;
  /** Inclination to the plane whose pole is `pole`, radians. */
  i: number;
  periapsis: number;
  /** Infinity for a hyperbola. */
  apoapsis: number;
};

export function elements(r: Vec3, v: Vec3, mu: number, pole: Vec3): Elements {
  const rn = norm(r);
  const h = cross(r, v);
  const eVec = sub(scale(cross(v, h), 1 / mu), scale(r, 1 / rn));
  const e = norm(eVec);
  const energy = dot(v, v) / 2 - mu / rn;
  const a = -mu / (2 * energy);
  const p = dot(h, h) / mu;
  const i = Math.acos(Math.max(-1, Math.min(1, dot(h, pole) / (norm(h) * norm(pole)))));
  return { a, e, i, periapsis: p / (1 + e), apoapsis: e < 1 ? p / (1 - e) : Infinity };
}
