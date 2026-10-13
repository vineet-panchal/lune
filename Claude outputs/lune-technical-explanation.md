# Lune — Technical Walkthrough

Satellite tracking and orbital-analytics platform. Three independently deployable services — a Java/Spring Boot API, a Python/FastAPI machine-learning microservice, and a Next.js/React/Three.js frontend — that together fetch real satellite orbital data, propagate positions, and render them on an interactive 3D globe. This document explains what each piece actually does at the code level, based on a read of the current repository (not just the README's marketing description).

## 1. The three services, and how they talk to each other

**`backend/`** — Java 17, Spring Boot 4, built with Maven (`./mvnw spring-boot:run`), listens on port 8080. This is the REST API: it owns satellite-catalog retrieval, orbit propagation, and acts as a gateway to the Python service.

**`analytics-service/`** — Python 3.10+, FastAPI, run directly with `python main.py` (Uvicorn), defaults to port 8000. A single-purpose, stateless machine-learning endpoint: send it satellite feature vectors, get back cluster/anomaly labels.

**`frontend/`** — Next.js 16 (App Router), React 19, TypeScript 5, Tailwind v4, port 3000. Everything the user sees: the 3D globe (via `globe.gl`/Three.js), the search and filter UI, and — importantly — the real-time orbital math, which runs client-side (see §4).

In development the browser never talks cross-origin: `frontend/next.config.ts` rewrites every `/api/:path*` request to the Spring server (`http://127.0.0.1:8080` by default), so from the browser's point of view everything is same-origin. Spring's controllers also declare `@CrossOrigin(origins = "http://localhost:3000")` explicitly (repeated per controller, not a single global CORS bean) for the case where the frontend is served separately. Spring, in turn, calls the Python service over plain HTTP using a reactive `WebClient`, configured via `lune.analytics.base-url` (default `http://127.0.0.1:8000`).

There is no database anywhere in this stack. Every cache is an in-memory `ConcurrentHashMap` with a time-to-live, described below — the real source of truth is always the external TLE providers, so losing the cache on restart is harmless.

## 2. Backend: satellite catalog and propagation

The backend is organized by feature package (`satellite`, `analytics`, `launch`, `trajectory`, `config`), each following the same Controller → Service → DTO shape, with Lombok (`@Builder`, `@RequiredArgsConstructor`, `@Slf4j`) removing boilerplate. `LuneBackendApplication` is a bare `@SpringBootApplication`; `WebConfig` supplies one `RestTemplate` bean with a 3-second connect/read timeout, deliberately short so that a slow external API fails fast into a fallback path rather than hanging a request.

### Two upstream data sources, with a real fallback chain

Two clients fetch Two-Line Element (TLE) data — the standard format for describing a satellite's orbit:

- **`CelestrakApiClient`** talks directly to `celestrak.org` (with `celestrak.com` as a mirror), which has no meaningful rate limit. It tries the bulk `GP` JSON endpoint first, then a raw 3-line-element text endpoint if JSON fails, retries once per attempt, and caches whole groups (e.g. `STARLINK`, `GPS-OPS`) for an hour. If even the bulk group download is blocked, it has one more trick: scrape the satellite catalog numbers out of CelesTrak's HTML *table* page with a regex, then fetch each satellite individually and in parallel via `getSatelliteFast`.
- **`TleApiClient`** talks to `tle.ivanstanojevic.me`, a third-party catalog with search and pagination but a published limit of 500 requests/day, so it's used as the fallback, and its own propagation results are cached for 30 seconds per satellite specifically to avoid burning through that quota.

`SatelliteService` is the orchestrator that decides which source to use and layers its own caching on top: a 1-hour cache of individual TLEs (`tleCache`) and a 15-minute cache of already-merged catalog pages (`satelliteListCache`), keyed so that CelesTrak results and TLE-API results normalize into the same internal shape (`CelestrakSatelliteDto`) regardless of where they came from.

`getSatellites(...)` is one method that branches into several genuinely different behaviors depending on the query: a hardcoded "popular" list of 7 well-known objects (ISS, Hubble, the Chinese Space Station, a few NOAA/Landsat satellites) enriched with live TLEs; a `type` parameter that maps onto one of ~20 real CelesTrak groups (Starlink, OneWeb, GPS-OPS, GLONASS, Galileo, BeiDou, NOAA, GOES, Iridium, and so on); a handful of newer mega-constellations that CelesTrak doesn't group yet (Kuiper, Qianfan, Guowang, GalaxySpace, E-Space), found instead by name search against the TLE API; and a synthetic `INTERNET` pseudo-group that unions Starlink and OneWeb (from CelesTrak) with those five search-based constellations into one deduplicated, cached list. A plain free-text search against the TLE API is the final fallback.

### Position math: SGP4 via `predict4java`

`Sgp4Propagator` is the class that turns a TLE plus a timestamp into a position. It's worth being precise about what this class does and doesn't do: the actual SGP4/SDP4 orbital-propagation algorithm — the physics — comes from **`predict4java`**, a third-party Maven dependency (`com.github.davidmoten:predict4java`). Lune's own code wraps it: it calls `SatelliteFactory.createSatellite(tle)` and `calculateSatelliteGroundTrack()` to get latitude/longitude/altitude, then converts that geodetic position into Earth-Centered-Inertial (ECI) x/y/z by computing Greenwich Mean Sidereal Time itself (`computeGmst`, a standard IAU-1982 polynomial in Julian centuries) and rotating by it. Velocity is *not* read from the library — it's approximated by propagating one second later and taking a finite difference of the two ECI positions. That's a reasonable, common shortcut for a visualization, but it's an approximation worth being able to name if asked how precise it is.

`getTrail(...)` builds an orbital trail by repeatedly calling this same propagator at offset timestamps before and after "now," spaced so the total path length approximates the requested `trailKm` (using current speed to convert km into a time span), by default 5 points on each side of the current position.

### Analytics and Launch/Trajectory: gateway and stubs

`AnalyticsController`/`AnalyticsService` is a thin, purely reactive proxy: it takes the incoming cluster request, forwards it via `WebClient` to the Python service, blocks on the returned `Mono` for up to 60 seconds (bridging WebFlux's async client back into a synchronous MVC controller method), and turns connection failures into an HTTP 503 with a message that literally says "Is the Python API running at the configured base URL?" — useful when demoing, since the two services are started independently.

`LaunchService` and `TrajectoryService` are explicit, commented stubs: a couple of hardcoded future-mission records (Artemis III, a Starship Mars demo) and a hardcoded, non-physical placeholder path toward Mars. This matches the README's "Mission Planning (Coming Soon)" section — there is no real ephemeris or trajectory computation here yet, and being upfront about that if it comes up is better than the code speaking for itself unexpectedly.

## 3. Analytics service: clustering and anomaly detection

`analytics-service/main.py` is a single ~140-line FastAPI app with no persistence — a pure function: satellite feature vectors go in, integer labels come out. Request/response validation is Pydantic v2, and the models are set up so the same field can be sent as either `altitudeKm` (from the Java/Jackson side) or `altitude_km`, via `Field(alias=...)` plus `populate_by_name`.

Three algorithms are supported, chosen by an `algorithm` field that's normalized (`isolationforest` → `isolation_forest`, dashes to underscores, default `kmeans`). All three first standardize the 3-column feature matrix with scikit-learn's `StandardScaler`, which matters because K-means and especially DBSCAN are distance-based and sensitive to differences in feature scale.

- **K-means** (`k`, default 5, minimum 2): partitions the points into exactly `k` groups by iteratively minimizing distance to cluster centroids; the response includes `inertia` (within-cluster sum of squared distances — lower means tighter, more separated clusters).
- **DBSCAN** (`eps` bounded to 0.05–5.0, `min_samples`): a density-based method — points in dense neighborhoods form clusters, and points that don't fit any dense neighborhood get labeled `-1` ("noise"). No `k` needed, which is why it's good for finding outlier satellites without deciding cluster count in advance.
- **Isolation Forest** (`contamination`, bounded 0.001–0.5, floored to at least `1/n`): not a clustering algorithm at all — it's an anomaly detector. It builds 200 random decision trees and flags points that are unusually easy to isolate (fewer splits needed) as anomalies (`-1`).

## 4. Frontend: the part that actually makes this scale

### Routing and the "two apps" that are really one component

`/` renders `SatelliteTrackerPage`, `/orbital-intelligence` renders `OrbitalIntelligencePage` — but both are one-line wrappers around the same ~1,400-line `GlobeView` component, distinguished only by a `mode` prop. In orbital-intelligence mode, `GlobeView` additionally renders a right-side analytics panel, shrinks the globe and drops in a Three.js axes/grid helper, and reserves layout space for that panel (`ANALYTICS_PANEL_WIDTH_PX`).

### The core architectural decision: propagate on the client

This is the single most important design choice in the project, and the one most worth being able to explain clearly. The frontend does **not** poll the backend for each satellite's position on a timer. Instead:

1. It fetches each satellite's TLE **once** (paginated, 100 at a time) from `/api/satellites`.
2. It parses every TLE into a `satrec` locally, using `satellite.js`'s `twoline2satrec` — the same SGP4 algorithm family as the backend, just a JavaScript port running in the browser.
3. A local timer then re-propagates every loaded `satrec` to the current time using `satellite.propagate` + `eciToGeodetic`, purely in the browser, and pushes the new lat/lng/altitude into `globe.gl`. The backend is not contacted again for movement.

The timer interval scales with how many satellites are loaded (1 second up to a few hundred, stretching to 5 seconds past 6,000+), the *UI re-render* interval scales separately (so the globe's underlying Three.js objects can still update fast on the GPU even while React state updates less often), and propagation is skipped entirely while `isUserInteractingRef` is true — set on pointer/wheel/touch events with a 220 ms idle debounce — so real-time orbital math doesn't fight the user for CPU while they're dragging or zooming. This is what makes "track thousands of Starlink satellites live" tractable: it turns what would be thousands of requests per second into one bulk fetch plus client-side trigonometry.

`lib/api.ts` is the one place that talks to the backend, and it includes its own retry logic in `fetchSatellites` — up to 4 attempts, with backoff, retrying on network errors and 5xx responses but not on 4xx (a bad request retried is still a bad request).

### Rendering

`globe.gl` (a Three.js/`three-globe` wrapper with a chainable, imperative API) draws into a bare `<div>` (`GlobeCanvas`). Satellites are rendered via `objectsData` as actual small `THREE.Mesh` spheres (not the library's simpler flat "points" layer), which is what allows each one to be individually colored — by altitude band by default (six bands from Very-Low-Earth-Orbit up through Geostationary and beyond, each with its own color), or by cluster/anomaly label once clustering has been run. Day/night globe textures, atmosphere glow, graticule lines, country borders (loaded once from a `world-atlas` TopoJSON file and converted with `topojson-client`), and even the starfield and cloud layer are generated procedurally with 2D Canvas gradients rather than downloaded image assets, then applied to the globe imperatively inside `useEffect` hooks that watch the relevant React state — necessary because `globe.gl`'s API isn't itself a React component.

Clicking a rendered satellite selects it (capped at 10 simultaneously), and — again entirely client-side — computes a 90-minute orbit trail (180 points, 30-second steps) with the same `satellite.js` propagator, rendered as a dashed line via `globe.gl`'s `pathsData` layer.

### Orbital Intelligence panel and clustering — a detail worth knowing cold

When a clustering run is triggered, the frontend takes every currently loaded satellite's propagated lat/lng/altitude, converts it to ECI x/y/z kilometers, and sends it to `/api/analytics/cluster`. The code is explicit about a naming shortcut here (there's a comment saying exactly this): it reuses the API's existing field names — `altitudeKm`, `inclinationDeg`, `meanMotionRpd` — to actually carry x, y, and z position values, rather than real orbital elements. In practice, this means today's clustering groups satellites by **where they currently are in 3D space** (which naturally separates orbital shells and planes, and works well visually), not by their literal orbital elements — true inclination, eccentricity, or mean motion, all of which are actually encoded in the TLE's line 1/line 2 and could be parsed out directly if you wanted clustering by orbit *shape* rather than orbit *position*. That's a legitimate, working design choice, but it's different from what the README's illustrative code snippet suggests, so it's worth having a clear, honest answer ready if someone reads the code closely.

## 5. End-to-end example: what happens when the app loads

1. Browser loads `/`; `GlobeView` initializes the `globe.gl` instance and immediately calls `GET /api/satellites?group=popular` (rewritten by Next.js to Spring on :8080).
2. `SatelliteController` → `SatelliteService.getSatellites(..., group="popular", ...)` returns the 7 curated satellites, each enriched with a live TLE (CelesTrak first, TLE-API fallback, both cached).
3. The frontend parses each TLE into a `satrec` and starts a 1-second local timer; each tick runs `satellite.propagate` + `eciToGeodetic` in the browser and updates `globe.gl` — no further backend calls for movement.
4. Clicking a satellite computes a 90-minute trail locally. Switching to Orbital Intelligence and running K-means/DBSCAN/Isolation Forest POSTs the current XYZ snapshot to Spring, which forwards it via `WebClient` to FastAPI, which scales the features and runs scikit-learn, returning integer labels that get mapped back onto satellite colors on the globe.

## 6. Honest gaps, worth knowing before anyone asks

No database — every cache is in-memory and TTL-based; a backend restart just means the next request re-fetches from CelesTrak/TLE-API. No automated tests beyond the Spring Boot placeholder `contextLoads()` test. `LaunchService` and `TrajectoryService` are hardcoded stubs, not real integrations (a real version would likely use Launch Library 2 or NASA data, and simplified Hohmann-transfer or SPICE ephemeris math for trajectories — both are called out as such directly in code comments). CORS is set per-controller to `localhost:3000` rather than through one shared configuration, fine for a two-environment demo but not production-shaped. The README's Quick Start says the analytics service "Runs on http://localhost:8001," while the actual configured default (`application.properties`, `lune.analytics.base-url`) and FastAPI/Uvicorn's own default port are both 8000 — a small doc/config mismatch worth fixing or just being aware of.

## 7. If you get asked about this in an interview

The strongest, most defensible technical decisions to lead with: propagating satellite positions client-side instead of polling the backend, which is the difference between the app being able to track thousands of live objects versus a few dozen; the multi-tier fallback chain for satellite data (CelesTrak JSON → CelesTrak text → scraped catalog numbers → third-party TLE API), which is a real resilience pattern for depending on external, sometimes-flaky data sources; and the choice to run clustering/anomaly-detection as a separate Python microservice rather than trying to do machine learning in Java, called through a non-blocking reactive client so the main API thread pool isn't tied up waiting on it.

Fair follow-up questions to have answers ready for: why is satellite velocity approximated by finite difference instead of computed analytically (answer: it's good enough for a visualization refreshing every second or more, and predict4java's public API surface used here doesn't expose a velocity vector directly); why does the orbital-intelligence clustering use position rather than orbital elements (answer: simpler to compute from data already on hand client-side, and it produces visually sensible shell/plane groupings — real orbital-element clustering is a natural next iteration since the TLE lines already contain inclination, eccentricity, and mean motion); and what's actually implemented versus stubbed (satellite tracking and clustering are real and working end-to-end; launch/trajectory planning is a placeholder for future work).
