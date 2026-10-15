import { DAY_MS, helioState, hohmann, synodicDays, type PlanetId, type State } from "./bodies";
import { transferBetween, type ArrivalMode } from "./transfer";

/**
 * A porkchop plot: the transfer for every pair of departure date and flight time on a grid. The low-cost
 * "islands" are launch windows; the ridge through the middle is the 180° transfer, where the orbit plane is
 * undefined and the cost shoots up.
 */
export type PorkchopRequest = {
  origin: PlanetId;
  destination: PlanetId;
  departStartMs: number;
  /** Grid steps, in whole days so arrival dates repeat across cells and the planets' states can be reused. */
  departStepDays: number;
  cols: number;
  tofStartDays: number;
  tofStepDays: number;
  rows: number;
  arrival: ArrivalMode;
  parkingAltKm: number;
};

export type PorkchopGrid = PorkchopRequest & {
  /** Row-major (row = flight time, col = departure); NaN where no transfer exists. */
  c3: Float32Array;
  vInfArrive: Float32Array;
  total: Float32Array;
  /** Cheapest cell by total Δv. */
  best: { col: number; row: number } | null;
};

export function computePorkchop(req: PorkchopRequest): PorkchopGrid {
  const { cols, rows } = req;
  const c3 = new Float32Array(cols * rows).fill(NaN);
  const vInfArrive = new Float32Array(cols * rows).fill(NaN);
  const total = new Float32Array(cols * rows).fill(NaN);
  const arrivals = new Map<number, State>();
  let best: { col: number; row: number } | null = null;
  let bestValue = Infinity;

  for (let col = 0; col < cols; col++) {
    const departDay = col * req.departStepDays;
    const departMs = req.departStartMs + departDay * DAY_MS;
    const a = helioState(req.origin, departMs);
    for (let row = 0; row < rows; row++) {
      const tofDays = req.tofStartDays + row * req.tofStepDays;
      const arriveDay = departDay + tofDays;
      let b = arrivals.get(arriveDay);
      if (!b) {
        b = helioState(req.destination, req.departStartMs + arriveDay * DAY_MS);
        arrivals.set(arriveDay, b);
      }
      const t = transferBetween(req.origin, req.destination, departMs, departMs + tofDays * DAY_MS, a, b, {
        arrival: req.arrival,
        parkingAltKm: req.parkingAltKm,
      });
      if (!t) continue;
      const i = row * cols + col;
      c3[i] = t.c3;
      vInfArrive[i] = t.vInfArriveKms;
      total[i] = t.totalKms;
      if (t.totalKms < bestValue) {
        bestValue = t.totalKms;
        best = { col, row };
      }
    }
  }
  return { ...req, c3, vInfArrive, total, best };
}

/**
 * A sensible grid for a pair of planets: departures over a bit more than one synodic period (so at least one
 * window shows), flight times around the Hohmann time.
 */
export function defaultGrid(origin: PlanetId, destination: PlanetId, fromMs: number, arrival: ArrivalMode, parkingAltKm: number): PorkchopRequest {
  const cols = 140;
  const rows = 100;
  const synodic = synodicDays(origin, destination);
  const departSpan = Math.min(5 * 365, Math.max(400, synodic * 1.25));
  const h = hohmann(origin, destination).tofDays;
  const outer = h > 3 * 365;
  const tofMin = Math.max(20, h * (outer ? 0.25 : 0.4));
  const tofMax = h * (outer ? 1.3 : 1.6);
  const startDay = Math.floor(fromMs / DAY_MS) * DAY_MS;
  return {
    origin,
    destination,
    departStartMs: startDay,
    departStepDays: Math.max(1, Math.round(departSpan / cols)),
    cols,
    tofStartDays: Math.round(tofMin),
    tofStepDays: Math.max(1, Math.round((tofMax - tofMin) / rows)),
    rows,
    arrival,
    parkingAltKm,
  };
}

export function cellTimes(grid: PorkchopRequest, col: number, row: number) {
  const departMs = grid.departStartMs + col * grid.departStepDays * DAY_MS;
  const tofDays = grid.tofStartDays + row * grid.tofStepDays;
  return { departMs, tofDays, arriveMs: departMs + tofDays * DAY_MS };
}
