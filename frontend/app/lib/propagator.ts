import type * as satellite from "satellite.js";
import { propagateBatch, toSatrecs, type TleLines } from "./propagateBatch";
import type { WorkerRequest, WorkerResponse } from "./propagation.worker";

/**
 * Propagates the whole catalog in a background Web Worker (falling back to the main thread if
 * workers aren't available). Requests are answered in order.
 */
export type Positions = { geo: Float32Array; xyz: Float32Array; shadow: Uint8Array };

export type Propagator = {
  /** Replace the catalog; later results are in this order. */
  setTles: (tles: TleLines[]) => void;
  /** Per satellite at atMs: geo [lat°, lng°, altitude km] and globe-space xyz (NaN where propagation fails). */
  propagate: (atMs: number) => Promise<Positions>;
  dispose: () => void;
};

export function createPropagator(): Propagator {
  let worker: Worker | null = null;
  try {
    worker = new Worker(new URL("./propagation.worker.ts", import.meta.url), { type: "module" });
  } catch (e) {
    console.warn("[propagator] Web Worker unavailable, propagating on the main thread:", e);
  }

  if (!worker) {
    let satrecs: (satellite.SatRec | null)[] = [];
    return {
      setTles: (tles) => {
        satrecs = toSatrecs(tles);
      },
      propagate: async (atMs) => propagateBatch(satrecs, atMs),
      dispose: () => {},
    };
  }

  const w = worker;
  let nextId = 0;
  const pending = new Map<number, (positions: Positions) => void>();
  w.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const resolve = pending.get(event.data.requestId);
    pending.delete(event.data.requestId);
    resolve?.({ geo: event.data.geo, xyz: event.data.xyz, shadow: event.data.shadow });
  };
  const send = (msg: WorkerRequest) => w.postMessage(msg);

  return {
    setTles: (tles) => send({ type: "tles", tles }),
    propagate: (atMs) =>
      new Promise((resolve) => {
        const requestId = nextId++;
        pending.set(requestId, resolve);
        send({ type: "propagate", requestId, atMs });
      }),
    dispose: () => {
      w.terminate();
      pending.clear();
    },
  };
}
