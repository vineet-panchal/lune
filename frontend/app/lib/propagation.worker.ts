/// <reference lib="webworker" />
import type * as satellite from "satellite.js";
import { propagateBatch, toSatrecs, type TleLines } from "./propagateBatch";

/**
 * Runs SGP4 for the whole catalog off the main thread, so a full pass (~65 ms for Starlink)
 * never freezes the globe's frames.
 *
 * In:  { type: "tles", tles }                    — the catalog, in display order
 *      { type: "propagate", requestId, atMs }    — positions at atMs
 * Out: { requestId, geo, xyz, shadow }           — per satellite [lat, lng, altKm], globe-space xyz, in-shadow flag (transferred)
 */
export type WorkerRequest =
  | { type: "tles"; tles: TleLines[] }
  | { type: "propagate"; requestId: number; atMs: number };

export type WorkerResponse = { requestId: number; geo: Float32Array; xyz: Float32Array; shadow: Uint8Array };

let satrecs: (satellite.SatRec | null)[] = [];

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;
  if (msg.type === "tles") {
    satrecs = toSatrecs(msg.tles);
    return;
  }
  const { geo, xyz, shadow } = propagateBatch(satrecs, msg.atMs);
  const response: WorkerResponse = { requestId: msg.requestId, geo, xyz, shadow };
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(response, [geo.buffer, xyz.buffer, shadow.buffer]);
};
