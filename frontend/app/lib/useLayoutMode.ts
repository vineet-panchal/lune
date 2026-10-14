import { useEffect, useState } from "react";

/**
 * How the page lays out its panels:
 *  - desktop: floating panels (collapsible to side-wall tabs)
 *  - tablet:  same, but panels start collapsed so the globe gets the room
 *  - phone:   bottom tab bar + bottom sheet (also short landscape phones)
 */
export type LayoutMode = "desktop" | "tablet" | "phone";

const PHONE_MAX_WIDTH = 640;
const PHONE_MAX_HEIGHT = 500; // landscape phones: too short for floating panels
const TABLET_MAX_WIDTH = 1100;
/** Below this the full navbar doesn't fit, so it becomes a hamburger menu. */
const COMPACT_NAV_MAX_WIDTH = 900;

export type Layout = { mode: LayoutMode; compactNav: boolean };

function layoutFor(width: number, height: number): Layout {
  const mode: LayoutMode =
    width < PHONE_MAX_WIDTH || height < PHONE_MAX_HEIGHT ? "phone" : width < TABLET_MAX_WIDTH ? "tablet" : "desktop";
  return { mode, compactNav: mode === "phone" || width < COMPACT_NAV_MAX_WIDTH };
}

/** Starts as desktop (what the server renders), then follows the real window size. */
export function useLayoutMode(): Layout {
  const [layout, setLayout] = useState<Layout>({ mode: "desktop", compactNav: false });
  useEffect(() => {
    const update = () => {
      const next = layoutFor(window.innerWidth, window.innerHeight);
      setLayout((prev) => (prev.mode === next.mode && prev.compactNav === next.compactNav ? prev : next));
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  return layout;
}
