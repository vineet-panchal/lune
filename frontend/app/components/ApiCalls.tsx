"use client";

import { useEffect, useState } from "react";
import {
  fetchSatellites,
  fetchSatellite,
  fetchSatellitePosition,
  fetchSatelliteTrail,
  fetchSatellitePositions,
  fetchLaunches,
  fetchLaunchTrajectory,
  planTrajectory,
} from "../lib/api";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

export default function ApiCalls() {
  const [status, setStatus] = useState<string[]>([]);

  useEffect(() => {
    const run = async () => {
      const log = (msg: string) => setStatus((s) => [...s, msg]);
      try {
        log("Calling satellites (popular)...");
        await fetchSatellites(1, 10, { group: "popular" });
        log("✓ GET /api/satellites?group=popular");

        log("Calling satellite 25544...");
        await fetchSatellite(25544);
        log("✓ GET /api/satellites/25544");

        log("Calling position...");
        await fetchSatellitePosition(25544);
        log("✓ GET /api/satellites/25544/position");

        log("Calling trail...");
        await fetchSatelliteTrail(25544, 15);
        log("✓ GET /api/satellites/25544/trail");

        log("Calling batch positions...");
        await fetchSatellitePositions([25544, 49260, 20580]);
        log("✓ GET /api/satellites/positions");

        log("Calling launches...");
        await fetchLaunches(5);
        log("✓ GET /api/launches");

        log("Calling launch trajectory...");
        await fetchLaunchTrajectory("artemis-3");
        log("✓ GET /api/launches/artemis-3/trajectory");

        log("Calling trajectory plan...");
        await planTrajectory({
          originLat: 28.5,
          originLon: -80.6,
          destination: "mars",
          launchDate: "2026-01-15",
        });
        log("✓ POST /api/trajectory/plan");
      } catch (e) {
        console.error("API call failed:", e);
        setStatus((s) => [...s, `Error: ${e instanceof Error ? e.message : String(e)}`]);
      }
    };
    run();
  }, []);

  return (
    <div style={{ padding: 16, fontFamily: "monospace", fontSize: 12 }}>
      <p style={{ marginBottom: 8, fontWeight: 600 }}>
        Backend: {API_BASE}
      </p>
      <p style={{ marginBottom: 8, color: "#666" }}>
        To see these requests in DevTools: Network tab → filter by <strong>Fetch/XHR</strong> (not &quot;All&quot;).
      </p>
      <ul style={{ margin: 0, paddingLeft: 20 }}>
        {status.map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ul>
    </div>
  );
}
