import type { RefObject } from "react";

type GlobeCanvasProps = {
  containerRef: RefObject<HTMLDivElement | null>;
};

export default function GlobeCanvas({ containerRef }: GlobeCanvasProps) {
  return <div ref={containerRef} style={{ width: "100%", height: "100%" }} />;
}
