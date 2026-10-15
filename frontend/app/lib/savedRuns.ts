import type { ClusterAlgorithm } from "./clusterLabels";

/**
 * Clustering runs saved in this browser, to compare later ("what changed group since yesterday?").
 * Only the labels are kept (≈100 KB for Starlink), not the features, so a saved run can be compared but not inspected.
 */
export type SavedRun = {
  id: string;
  savedAt: number;
  /** The satellite filter it was run on, e.g. "Internet / Starlink". */
  filter: string;
  algorithm: ClusterAlgorithm;
  paramsLine: string;
  featuresLine: string;
  computedAtMs: number;
  ids: number[];
  labels: number[];
};

const STORAGE_KEY = "lune.savedRuns";
/** localStorage holds ~5 MB; this many Starlink-sized runs stay well under it. */
const MAX_SAVED = 8;

export function loadSavedRuns(): SavedRun[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Saves the run (dropping the oldest beyond MAX_SAVED) and returns the new list; throws if storage is full or blocked. */
export function saveRun(run: Omit<SavedRun, "id" | "savedAt">): SavedRun[] {
  const entry: SavedRun = { ...run, id: `${run.computedAtMs}-${run.algorithm}-${Math.random().toString(36).slice(2, 7)}`, savedAt: Date.now() };
  const next = [entry, ...loadSavedRuns()].slice(0, MAX_SAVED);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

export function deleteRun(id: string): SavedRun[] {
  const next = loadSavedRuns().filter((r) => r.id !== id);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* storage blocked: the list in memory still drops it */
  }
  return next;
}

export type RunComparison = {
  /** Satellites in both runs. */
  common: number;
  /** Adjusted Rand index: 1 = identical groupings, ~0 = no more alike than chance. */
  agreement: number;
  /**
   * In both runs, but not in the group that most of their old group moved to. Cluster numbers are arbitrary between
   * runs, so `expected` (where the rest went) is what to compare `after` with, not `before`.
   */
  changed: { satelliteId: number; before: number; after: number; expected: number }[];
  onlyBefore: number;
  onlyAfter: number;
};

/**
 * Compare two runs' labels. Cluster numbers are arbitrary between runs, so each old group is matched to the new group
 * most of its satellites ended up in; a satellite "changed group" if it went somewhere else.
 */
export function compareRuns(before: { ids: number[]; labels: number[] }, after: { ids: number[]; labels: number[] }): RunComparison {
  const afterById = new Map(after.ids.map((id, i) => [id, after.labels[i]]));
  const beforeIds = new Set(before.ids);
  const pairs: { id: number; a: number; b: number }[] = [];
  before.ids.forEach((id, i) => {
    const b = afterById.get(id);
    if (b !== undefined) pairs.push({ id, a: before.labels[i], b });
  });

  // Contingency table: how many satellites went from old group a to new group b.
  const table = new Map<number, Map<number, number>>();
  for (const { a, b } of pairs) {
    const row = table.get(a) ?? new Map<number, number>();
    row.set(b, (row.get(b) ?? 0) + 1);
    table.set(a, row);
  }
  const matched = new Map<number, number>();
  for (const [a, row] of table) {
    let best = -Infinity;
    let bestCount = -1;
    for (const [b, count] of row) {
      if (count > bestCount) {
        bestCount = count;
        best = b;
      }
    }
    matched.set(a, best);
  }

  return {
    common: pairs.length,
    agreement: adjustedRandIndex(table, pairs.length),
    changed: pairs
      .filter((p) => matched.get(p.a) !== p.b)
      .map((p) => ({ satelliteId: p.id, before: p.a, after: p.b, expected: matched.get(p.a) ?? p.a })),
    onlyBefore: before.ids.length - pairs.length,
    onlyAfter: after.ids.filter((id) => !beforeIds.has(id)).length,
  };
}

function adjustedRandIndex(table: Map<number, Map<number, number>>, n: number): number {
  if (n < 2) return 1;
  const choose2 = (x: number) => (x * (x - 1)) / 2;
  let sumCells = 0;
  const colTotals = new Map<number, number>();
  let sumRows = 0;
  for (const row of table.values()) {
    let rowTotal = 0;
    for (const [b, count] of row) {
      sumCells += choose2(count);
      rowTotal += count;
      colTotals.set(b, (colTotals.get(b) ?? 0) + count);
    }
    sumRows += choose2(rowTotal);
  }
  let sumCols = 0;
  for (const total of colTotals.values()) sumCols += choose2(total);
  const expected = (sumRows * sumCols) / choose2(n);
  const maxIndex = (sumRows + sumCols) / 2;
  return maxIndex === expected ? 1 : (sumCells - expected) / (maxIndex - expected);
}
