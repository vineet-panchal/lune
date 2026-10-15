/// <reference lib="webworker" />
import { computePorkchop, type PorkchopGrid, type PorkchopRequest } from "./porkchop";

/**
 * Builds porkchop grids off the main thread (14,000 Lambert solves take a few hundred ms, more for Pluto).
 * In: { requestId, request }   Out: { requestId, grid }  (arrays transferred)
 */
export type PorkchopWorkerRequest = { requestId: number; request: PorkchopRequest };
export type PorkchopWorkerResponse = { requestId: number; grid: PorkchopGrid };

self.onmessage = (event: MessageEvent<PorkchopWorkerRequest>) => {
  const { requestId, request } = event.data;
  const grid = computePorkchop(request);
  const response: PorkchopWorkerResponse = { requestId, grid };
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(response, [grid.c3.buffer, grid.vInfArrive.buffer, grid.total.buffer]);
};
