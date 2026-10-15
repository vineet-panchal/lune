import { useCallback, useEffect, useState } from "react";
import type { Observer } from "./passes";

const OBSERVER_STORAGE_KEY = "lune.observer";

/**
 * The observer's location for pass predictions and sky views, shared by every page and remembered in this browser
 * only (never put in share links). Read after mount, so the server and client render the same thing first.
 */
export function useObserver(): [Observer | null, (next: Observer | null) => void] {
  const [observer, setObserverState] = useState<Observer | null>(null);
  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(OBSERVER_STORAGE_KEY) ?? "null");
      // Read after mount on purpose: localStorage doesn't exist during server rendering.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (saved && Number.isFinite(saved.latDeg) && Number.isFinite(saved.lngDeg)) setObserverState(saved);
    } catch {
      /* storage unavailable or corrupt: start without a location */
    }
  }, []);
  const setObserver = useCallback((next: Observer | null) => {
    setObserverState(next);
    try {
      if (next) window.localStorage.setItem(OBSERVER_STORAGE_KEY, JSON.stringify(next));
      else window.localStorage.removeItem(OBSERVER_STORAGE_KEY);
    } catch {
      /* storage unavailable: keep it for this session only */
    }
  }, []);
  return [observer, setObserver];
}
