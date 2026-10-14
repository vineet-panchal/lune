/**
 * The time the globe shows. Normally real time ("live"), but it can be paused, sped up, or moved
 * to another moment. Everything that propagates satellites reads clock.now() instead of new Date().
 * Subscribers are notified when the controls change (not on every tick), with what changed:
 * "jump" (time moved: scrub, ±1h, Now), "rate" (speed) or "pause" (paused / resumed).
 */
export type ClockChange = "jump" | "rate" | "pause";

export type SimClock = {
  now: () => Date;
  nowMs: () => number;
  readonly rate: number;
  readonly paused: boolean;
  /** Real-time speed, unpaused, and within a couple of seconds of the real clock. */
  isLive: () => boolean;
  setRate: (rate: number) => void;
  setPaused: (paused: boolean) => void;
  setTime: (ms: number) => void;
  goLive: () => void;
  subscribe: (listener: (change: ClockChange) => void) => () => void;
};

export function createSimClock(): SimClock {
  let baseSim = Date.now();
  let baseReal = Date.now();
  let rate = 1;
  let paused = false;
  const listeners = new Set<(change: ClockChange) => void>();

  const nowMs = () => (paused ? baseSim : baseSim + (Date.now() - baseReal) * rate);
  // Freeze the current simulated time as the new base before changing how it advances.
  const rebase = () => {
    baseSim = nowMs();
    baseReal = Date.now();
  };
  const emit = (change: ClockChange) => listeners.forEach((l) => l(change));

  return {
    nowMs,
    now: () => new Date(nowMs()),
    get rate() {
      return rate;
    },
    get paused() {
      return paused;
    },
    isLive: () => !paused && rate === 1 && Math.abs(nowMs() - Date.now()) < 2000,
    setRate(next) {
      rebase();
      rate = next;
      emit("rate");
    },
    setPaused(next) {
      rebase();
      paused = next;
      emit("pause");
    },
    setTime(ms) {
      baseSim = ms;
      baseReal = Date.now();
      emit("jump");
    },
    goLive() {
      baseSim = Date.now();
      baseReal = Date.now();
      rate = 1;
      paused = false;
      emit("jump");
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
