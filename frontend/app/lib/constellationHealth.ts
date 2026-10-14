import type { OrbitPoint } from "./clusterFeatures";

/**
 * Constellation health: split the loaded satellites into shells (same inclination and altitude) and each shell into
 * orbital planes (same RAAN), then check every plane against the shell's usual size and for gaps in its spacing.
 *
 * Mega-constellations put the same number of satellites in every plane of a shell, evenly spaced around it, so a
 * plane with fewer satellites has empty slots (failures, deorbits, still filling), and a big gap between neighbours
 * means one is missing or drifting.
 */
export type PlaneHealth = {
  raanDeg: number;
  ids: number[];
  count: number;
  /** Largest gap between neighbours along the orbit, and what even spacing would be (degrees). */
  maxGapDeg: number;
  evenGapDeg: number;
  short: boolean;
  uneven: boolean;
};

export type ShellHealth = {
  key: string;
  inclinationDeg: number;
  altitudeKm: number;
  ids: number[];
  planes: PlaneHealth[];
  /** Usual satellites per plane in this shell (median of the planes). */
  typicalPerPlane: number;
  shortPlanes: number;
  unevenPlanes: number;
};

export type ConstellationHealth = {
  shells: ShellHealth[];
  /** Satellites in groups too small to call a shell (e.g. still climbing to their working orbit). */
  ungrouped: number;
};

/**
 * Same shell: no jump bigger than this between neighbouring inclinations (Starlink has shells at both 53.0° and
 * 53.2°; within one shell they vary by a few hundredths)...
 */
const SHELL_INCLINATION_GAP_DEG = 0.1;
/**
 * ...or between neighbouring mean altitudes. A shell holds its satellites within a few km; satellites still climbing
 * are spread thinly enough to fall apart into small groups instead of bridging two shells.
 */
const SHELL_ALTITUDE_GAP_KM = 3;
const MIN_SHELL_SIZE = 10;
/** A new plane starts where the RAAN gap is this many times the shell's typical in-plane gap (and at least 1°). */
const PLANE_GAP_FACTOR = 5;
const MIN_PLANE_GAP_DEG = 1;
/** Short: fewer than this share of the shell's usual plane size. */
const SHORT_FRACTION = 0.75;
/**
 * Uneven: the largest gap along the orbit is more than this many times even spacing. Real planes aren't perfectly
 * even (satellites shift between slots), so only a gap big enough for two or more missing neighbours counts.
 */
const UNEVEN_FACTOR = 3;

export function constellationHealth(points: OrbitPoint[]): ConstellationHealth {
  const shells: ShellHealth[] = [];
  let ungrouped = 0;
  for (const group of splitShells(points)) {
    if (group.length < MIN_SHELL_SIZE) {
      ungrouped += group.length;
      continue;
    }
    shells.push(describeShell(group));
  }
  shells.sort((a, b) => b.ids.length - a.ids.length);
  return { shells, ungrouped };
}

function splitShells(points: OrbitPoint[]): OrbitPoint[][] {
  const byInclination = splitWhere([...points].sort((a, b) => a.inclinationDeg - b.inclinationDeg), (a, b) => b.inclinationDeg - a.inclinationDeg > SHELL_INCLINATION_GAP_DEG);
  return byInclination.flatMap((group) =>
    splitWhere([...group].sort((a, b) => a.altitudeKm - b.altitudeKm), (a, b) => b.altitudeKm - a.altitudeKm > SHELL_ALTITUDE_GAP_KM)
  );
}

function describeShell(members: OrbitPoint[]): ShellHealth {
  const planes = splitPlanes(members).map((plane) => describePlane(plane));
  const sizes = planes.map((p) => p.count).filter((n) => n >= 3);
  const typical = sizes.length > 0 ? median(sizes) : 0;
  for (const p of planes) p.short = typical >= 4 && p.count < typical * SHORT_FRACTION;
  planes.sort((a, b) => a.raanDeg - b.raanDeg);
  const inclination = median(members.map((m) => m.inclinationDeg));
  const altitude = median(members.map((m) => m.altitudeKm));
  return {
    key: `${inclination.toFixed(1)}-${Math.round(altitude)}`,
    inclinationDeg: inclination,
    altitudeKm: altitude,
    ids: members.map((m) => m.satelliteId),
    planes,
    typicalPerPlane: typical,
    shortPlanes: planes.filter((p) => p.short).length,
    unevenPlanes: planes.filter((p) => p.uneven).length,
  };
}

/** Group by RAAN on a circle: start just after the widest gap, then cut wherever a gap is far wider than usual. */
function splitPlanes(members: OrbitPoint[]): OrbitPoint[][] {
  const sorted = [...members].sort((a, b) => a.raanDeg - b.raanDeg);
  if (sorted.length < 2) return [sorted];
  const gaps = sorted.map((p, i) => circularGap(p.raanDeg, sorted[(i + 1) % sorted.length].raanDeg));
  const widest = gaps.indexOf(Math.max(...gaps));
  const rotated = [...sorted.slice(widest + 1), ...sorted.slice(0, widest + 1)];
  const inner = rotated.slice(1).map((p, i) => circularGap(rotated[i].raanDeg, p.raanDeg));
  const cut = Math.max(MIN_PLANE_GAP_DEG, PLANE_GAP_FACTOR * median(inner.filter((g) => g > 0)) || MIN_PLANE_GAP_DEG);
  return splitWhere(rotated, (a, b) => circularGap(a.raanDeg, b.raanDeg) > cut);
}

function describePlane(plane: OrbitPoint[]): PlaneHealth {
  const n = plane.length;
  const evenGap = 360 / Math.max(1, n);
  let maxGap = 360;
  if (n >= 2) {
    const u = plane.map((p) => p.argLatDeg).sort((a, b) => a - b);
    maxGap = Math.max(...u.map((v, i) => circularGap(v, u[(i + 1) % n])));
  }
  return {
    raanDeg: circularMean(plane.map((p) => p.raanDeg)),
    ids: plane.map((p) => p.satelliteId),
    count: n,
    maxGapDeg: maxGap,
    evenGapDeg: evenGap,
    short: false,
    uneven: n >= 3 && maxGap > UNEVEN_FACTOR * evenGap,
  };
}

/** Split a sorted list wherever `breaks(prev, next)` is true. */
function splitWhere<T>(items: T[], breaks: (a: T, b: T) => boolean): T[][] {
  if (items.length === 0) return [];
  const groups: T[][] = [[items[0]]];
  for (let i = 1; i < items.length; i++) {
    if (breaks(items[i - 1], items[i])) groups.push([]);
    groups[groups.length - 1].push(items[i]);
  }
  return groups;
}

/** Going forward from a to b round a 360° circle. */
function circularGap(a: number, b: number): number {
  return (((b - a) % 360) + 360) % 360;
}

function circularMean(degrees: number[]): number {
  let s = 0;
  let c = 0;
  for (const d of degrees) {
    s += Math.sin((d * Math.PI) / 180);
    c += Math.cos((d * Math.PI) / 180);
  }
  return ((Math.atan2(s, c) * 180) / Math.PI + 360) % 360;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
