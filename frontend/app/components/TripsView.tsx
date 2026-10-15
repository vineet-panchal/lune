"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MdInfoOutline, MdRocket, MdRocketLaunch, MdSchedule } from "react-icons/md";
import { createSimClock } from "../lib/simClock";
import { AU_KM, DAY_MS, eqjToEcl, helioEclipticAu, MU_SUN, PLANET_BY_ID, planet, type PlanetId } from "../lib/trips/bodies";
import type { EarthScene } from "../lib/trips/earthScene";
import { propagate } from "../lib/trips/kepler";
import { planFlight, type Flight } from "../lib/trips/launch";
import { fetchTripLaunches, PRECISE, siteFor, vehicleFor, type TripLaunch, type TripLaunchFeed } from "../lib/trips/launches";
import { LAUNCH_SITES, SITE_BY_ID } from "../lib/trips/launchSites";
import { fetchMissions, fetchTrajectory, trajectoryPolyline, trajectoryPosition, type TrajectoryFeed, type TripMission } from "../lib/trips/missions";
import { legPosition, localDeparture, moonLegAfterTransfer, moonLegLocal, planLunarFlight, sampleLeg, type MoonLeg, type MoonLegResult } from "../lib/trips/moonTrip";
import { isMoon, moon, moonError, subscribeMoons, type Destination } from "../lib/trips/moons";
import type { PlanetScene } from "../lib/trips/planetScene";
import { cellTimes, defaultGrid, type PorkchopGrid, type PorkchopRequest } from "../lib/trips/porkchop";
import type { PorkchopWorkerRequest, PorkchopWorkerResponse } from "../lib/trips/porkchop.worker";
import type { SolarPath, SolarScene } from "../lib/trips/solarSystemScene";
import { sampleTransfer, transfer, transferPosition, type ArrivalMode, type Transfer } from "../lib/trips/transfer";
import { scale, type Vec3 } from "../lib/trips/vec";
import { VEHICLE_BY_ID } from "../lib/trips/vehicles";
import { useLayoutMode } from "../lib/useLayoutMode";
import Navbar from "./layout/Navbar";
import PanelDock, { type DockPanel } from "./layout/PanelDock";
import MissionDetails from "./panels/trips/MissionDetails";
import PlanDetails, { defaultLaunch, type LaunchChoice } from "./panels/trips/PlanDetails";
import TripsPanel, { type TripsMode } from "./panels/trips/TripsPanel";
import TripTimeControls, { type SceneView, type TimeMark } from "./panels/trips/TripTimeControls";
import { formatDate, MISSION_COLOR, PLAN_COLOR } from "./panels/trips/ui";
import VehiclePanel from "./panels/trips/VehiclePanel";

const PHONE_TOP_BAR_PX = 48;
/** Ask again this often while JPL's path or Launch Library's list is still downloading. */
const LOADING_POLL_MS = 3000;
const DAY = 86_400;
const MOON_LEG_COLOR = "#80deea";

const startOfDay = (ms: number) => Math.floor(ms / DAY_MS) * DAY_MS;
const isDestination = (v: string | null): v is Destination => !!v && (PLANET_BY_ID.has(v as PlanetId) || isMoon(v));

/**
 * Trips: journeys across the solar system. Real missions play back on JPL's recorded paths; planned trips are
 * solved on the spot (transfer orbit, launch window, rocket and fuel, and the hop out to a moon) and can be
 * watched from the pad to arrival; upcoming real launches to planets and moons open as planned trips.
 * Share links: ?mission=voyager-2, or ?from=Earth&to=Mars&dep=2026-11-01&tof=210&arr=capture&lv=falcon-heavy&site=ksc-lc-39a&kg=4000
 * (to= can be a moon: to=Europa; from Earth to the Moon only dep= is needed).
 */
export default function TripsView() {
  const solarHostRef = useRef<HTMLDivElement | null>(null);
  const earthHostRef = useRef<HTMLDivElement | null>(null);
  const planetHostRef = useRef<HTMLDivElement | null>(null);
  const solarRef = useRef<SolarScene | null>(null);
  const earthRef = useRef<EarthScene | null>(null);
  const planetRef = useRef<PlanetScene | null>(null);
  const [scenesReady, setScenesReady] = useState(false);
  const [clock] = useState(createSimClock);
  const layout = useLayoutMode();
  const isPhone = layout.mode === "phone";
  const [sheet, setSheet] = useState<string | null>(null);
  const [bottomInset, setBottomInset] = useState(0);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const [mode, setMode] = useState<TripsMode>("missions");
  const [view, setView] = useState<SceneView>("solar");

  // ── Real missions ──
  const [missions, setMissions] = useState<TripMission[] | null>(null);
  const [missionsError, setMissionsError] = useState<string | null>(null);
  const [missionId, setMissionId] = useState<string | null>(null);
  const [loadedFeed, setLoadedFeed] = useState<{ id: string; feed: TrajectoryFeed } | null>(null);
  const feed = loadedFeed && loadedFeed.id === missionId ? loadedFeed.feed : null;

  // ── Upcoming launches ──
  const [launches, setLaunches] = useState<TripLaunchFeed | null>(null);
  const [launchesError, setLaunchesError] = useState<string | null>(null);
  /** The real launch the current plan was opened from; cleared when the route changes by hand. */
  const [plannedLaunch, setPlannedLaunch] = useState<TripLaunch | null>(null);

  // ── Planner ──
  const [origin, setOrigin] = useState<PlanetId>("Earth");
  const [destination, setDestination] = useState<Destination>("Mars");
  const [arrival, setArrival] = useState<ArrivalMode>("capture");
  const [gridStartMs, setGridStartMs] = useState<number | null>(null);
  const [grid, setGrid] = useState<PorkchopGrid | null>(null);
  /** The request the current grid answers; while it differs from gridRequest, a new grid is being solved. */
  const [solvedRequest, setSolvedRequest] = useState<PorkchopRequest | null>(null);
  const requestsRef = useRef(new Map<number, PorkchopRequest>());
  const [cell, setCell] = useState<{ col: number; row: number } | null>(null);
  const [launch, setLaunch] = useState<LaunchChoice>(defaultLaunch);
  /** Departure day for a trip to a moon of the planet it leaves from (no chart needed). */
  const [localDay, setLocalDay] = useState<number | null>(null);
  /** Bumped when another year of a moon's orbit arrives from JPL Horizons, to re-solve what waited for it. */
  const [moonVersion, setMoonVersion] = useState(0);
  const workerRef = useRef<Worker | null>(null);
  const requestIdRef = useRef(0);
  /** A trip to pick once its grid arrives (from a share link or a real launch); null tofDays: the cheapest that day. */
  const pendingTripRef = useRef<{ departMs: number; tofDays: number | null } | null>(null);
  const [pendingVersion, setPendingVersion] = useState(0);
  const urlReadRef = useRef(false);

  const targetMoon = isMoon(destination) ? moon(destination) : null;
  /** The planet the interplanetary part goes to. */
  const gridDestination: PlanetId = targetMoon ? targetMoon.planet : (destination as PlanetId);
  /** Earth to the Moon, Mars to Phobos…: no interplanetary transfer at all. */
  const localTrip = targetMoon !== null && targetMoon.planet === origin;

  // ── Scenes ──
  // three.js is loaded with the scenes, after the page has rendered.
  useEffect(() => {
    let cleanup: (() => void) | undefined;
    let unmounted = false;
    (async () => {
      const [{ createSolarScene }, { createEarthScene }, { createPlanetScene }] = await Promise.all([
        import("../lib/trips/solarSystemScene"),
        import("../lib/trips/earthScene"),
        import("../lib/trips/planetScene"),
      ]);
      const solarEl = solarHostRef.current;
      const earthEl = earthHostRef.current;
      const planetEl = planetHostRef.current;
      if (unmounted || !solarEl || !earthEl || !planetEl) return;
      const solar = createSolarScene(solarEl, () => clock.nowMs(), (id) => solarRef.current?.focus({ kind: "planet", id }, Math.max(0.02, (planet(id).radiusKm / AU_KM) * 80)));
      const earth = createEarthScene(earthEl, () => clock.nowMs());
      const around = createPlanetScene(planetEl, () => clock.nowMs());
      earth.setActive(false);
      around.setActive(false);
      solarRef.current = solar;
      earthRef.current = earth;
      planetRef.current = around;
      setScenesReady(true);
      cleanup = () => {
        solar.dispose();
        earth.dispose();
        around.dispose();
        solarRef.current = null;
        earthRef.current = null;
        planetRef.current = null;
      };
    })();
    return () => {
      unmounted = true;
      cleanup?.();
    };
  }, [clock]);

  useEffect(() => subscribeMoons(() => setMoonVersion((v) => v + 1)), []);

  /** Start the chart a few whole columns before a day, so that day is exactly a column, and pick a trip then. */
  const aimChartAt = useCallback((from: PlanetId, to: PlanetId, dayMs: number, tofDays: number | null) => {
    pendingTripRef.current = { departMs: dayMs, tofDays };
    setPendingVersion((v) => v + 1);
    const step = defaultGrid(from, to, dayMs, "capture", planet(from).lowOrbitAltKm).departStepDays;
    setGridStartMs(dayMs - 8 * step * DAY_MS);
  }, []);

  // ── Share links (read once after mount so server and client render the defaults first) ──
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const mission = q.get("mission");
    const from = q.get("from");
    const to = q.get("to");
    if (mission) {
      setMissionId(mission);
    } else if (from && PLANET_BY_ID.has(from as PlanetId) && isDestination(to) && from !== to) {
      const fromPlanet = from as PlanetId;
      setMode("plan");
      setOrigin(fromPlanet);
      setDestination(to);
      const arr = q.get("arr");
      if (arr === "flyby" || arr === "capture" || arr === "orbit") setArrival(arr);
      const lv = q.get("lv");
      const site = q.get("site");
      const kg = Number(q.get("kg"));
      if (lv && VEHICLE_BY_ID.has(lv)) setLaunch((l) => ({ ...l, vehicleId: lv, siteId: site && SITE_BY_ID.has(site) ? site : VEHICLE_BY_ID.get(lv)!.sites[0] }));
      if (kg > 0) setLaunch((l) => ({ ...l, payloadKg: kg }));
      const dep = Date.parse(q.get("dep") ?? "");
      const tof = Number(q.get("tof"));
      const toMoon = isMoon(to) ? moon(to) : null;
      if (toMoon && toMoon.planet === fromPlanet) {
        if (Number.isFinite(dep)) setLocalDay(startOfDay(dep));
      } else if (Number.isFinite(dep) && tof > 0) {
        aimChartAt(fromPlanet, toMoon ? toMoon.planet : (to as PlanetId), dep, tof);
      }
    }
    setGridStartMs((s) => s ?? Date.now());
    setLocalDay((d) => d ?? startOfDay(Date.now()) + DAY_MS);
    urlReadRef.current = true;
  }, [aimChartAt]);

  // ── Missions list and the selected mission's path ──
  useEffect(() => {
    fetchMissions()
      .then(setMissions)
      .catch((e) => setMissionsError(`Couldn't load missions: ${e instanceof Error ? e.message : String(e)}. Is the backend running?`));
  }, []);

  // Upcoming launches: ask again while Launch Library's list is still downloading.
  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    let polls = 0;
    const load = async () => {
      try {
        const f = await fetchTripLaunches();
        if (cancelled) return;
        setLaunches(f);
        setLaunchesError(null);
        if (f.loading && ++polls < 40) timer = window.setTimeout(load, LOADING_POLL_MS);
      } catch (e) {
        if (!cancelled) setLaunchesError(`Couldn't load upcoming launches: ${e instanceof Error ? e.message : String(e)}. Is the backend running?`);
      }
    };
    void load();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (!missionId) return;
    let cancelled = false;
    let timer = 0;
    const load = async () => {
      try {
        const f = await fetchTrajectory(missionId);
        if (cancelled) return;
        setLoadedFeed({ id: missionId, feed: f });
        if (f.loading) timer = window.setTimeout(load, LOADING_POLL_MS);
      } catch (e) {
        if (!cancelled) setLoadedFeed({ id: missionId, feed: { data: null, updatedAt: null, loading: false, error: e instanceof Error ? e.message : String(e) } });
      }
    };
    void load();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [missionId]);

  const mission = useMemo(() => missions?.find((m) => m.id === missionId) ?? null, [missions, missionId]);

  // On picking a mission: show it now if it's flying now, otherwise from launch; frame its whole path.
  const selectMission = useCallback(
    (id: string) => {
      setMissionId(id);
      setMode("missions");
      setView("solar");
      const m = missions?.find((x) => x.id === id);
      if (!m) return;
      const start = Date.parse(m.dataStart);
      const stop = Date.parse(m.dataStop);
      const now = Date.now();
      if (now >= start && now <= stop) clock.goLive();
      else {
        clock.setTime(start);
        clock.setRate(10 * DAY);
        clock.setPaused(false);
      }
    },
    [missions, clock]
  );

  const missionLine = useMemo(() => (feed?.data && feed.data.t.length > 1 ? trajectoryPolyline(feed.data) : null), [feed]);

  // ── Porkchop grid (in a worker) ──
  // Each request is posted once (switching tabs and back mustn't re-solve it and lose the picked trip).
  const postedRequestRef = useRef<PorkchopRequest | null>(null);
  useEffect(() => {
    const worker = new Worker(new URL("../lib/trips/porkchop.worker.ts", import.meta.url), { type: "module" });
    postedRequestRef.current = null;
    worker.onmessage = (e: MessageEvent<PorkchopWorkerResponse>) => {
      const request = requestsRef.current.get(e.data.requestId);
      requestsRef.current.delete(e.data.requestId);
      if (e.data.requestId !== requestIdRef.current || !request) return;
      setGrid(e.data.grid);
      setSolvedRequest(request);
    };
    workerRef.current = worker;
    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  // A moon trip is ranked by the trip to its planet, braking into orbit there.
  const gridArrival: ArrivalMode = targetMoon ? "capture" : arrival;
  const gridRequest: PorkchopRequest | null = useMemo(
    () => (gridStartMs === null || localTrip ? null : defaultGrid(origin, gridDestination, gridStartMs, gridArrival, planet(origin).lowOrbitAltKm)),
    [origin, gridDestination, gridStartMs, gridArrival, localTrip]
  );
  useEffect(() => {
    if (!gridRequest || mode !== "plan" || !workerRef.current || gridRequest === postedRequestRef.current) return;
    postedRequestRef.current = gridRequest;
    const requestId = ++requestIdRef.current;
    requestsRef.current.set(requestId, gridRequest);
    const msg: PorkchopWorkerRequest = { requestId, request: gridRequest };
    workerRef.current.postMessage(msg);
  }, [gridRequest, mode]);

  const computing = mode === "plan" && gridRequest !== null && gridRequest !== solvedRequest;

  // A grid for the current request: pick a waiting trip (share link, real launch), else the cheapest.
  useEffect(() => {
    if (!grid || solvedRequest !== gridRequest) return;
    const pending = pendingTripRef.current;
    if (pending) {
      pendingTripRef.current = null;
      const col = Math.round((pending.departMs - grid.departStartMs) / DAY_MS / grid.departStepDays);
      if (col >= 0 && col < grid.cols) {
        let row = pending.tofDays === null ? -1 : Math.round((pending.tofDays - grid.tofStartDays) / grid.tofStepDays);
        if (pending.tofDays === null) {
          // The cheapest flight time leaving that day.
          let best = Infinity;
          for (let r = 0; r < grid.rows; r++) {
            const v = grid.total[r * grid.cols + col];
            if (v < best) {
              best = v;
              row = r;
            }
          }
        }
        if (row >= 0 && row < grid.rows) {
          setCell({ col, row });
          return;
        }
      }
    }
    setCell(grid.best);
  }, [grid, solvedRequest, gridRequest, pendingVersion]);

  const cellTrip = useMemo(() => (!localTrip && grid && cell ? cellTimes(grid, cell.col, cell.row) : null), [grid, cell, localTrip]);
  // The transfer as picked (leaving at midnight), used to find the launch.
  const baseTransfer = useMemo(
    () => (cellTrip && grid ? transfer(grid.origin, grid.destination, cellTrip.departMs, cellTrip.arriveMs, { arrival: grid.arrival }) : null),
    [cellTrip, grid]
  );
  // A real launch's planned time, when Launch Library knows it to the hour or better: the launch window nearest
  // it is preferred over the day's most easterly one.
  const preferLaunchMs = useMemo(() => {
    const net = Date.parse(plannedLaunch?.launch.net ?? "");
    return plannedLaunch && PRECISE.has(plannedLaunch.launch.netPrecision ?? "") && Number.isFinite(net) ? net : null;
  }, [plannedLaunch]);
  const transferFlight = useMemo(() => {
    if (!baseTransfer || baseTransfer.origin !== "Earth") return null;
    const vehicle = VEHICLE_BY_ID.get(launch.vehicleId)!;
    const site = SITE_BY_ID.get(launch.siteId)!;
    const fly = (dayStartMs: number, spanMinutes?: number) => planFlight(vehicle, site, launch.payloadKg, baseTransfer.c3, baseTransfer.vInfDepart, dayStartMs, spanMinutes);
    const near = preferLaunchMs !== null && startOfDay(preferLaunchMs) === startOfDay(baseTransfer.departMs) ? fly(preferLaunchMs - 3 * 3_600_000, 6 * 60) : null;
    return near ?? fly(baseTransfer.departMs);
  }, [baseTransfer, launch, preferLaunchMs]);
  // Re-timed to leave at the real departure burn (hours after midnight), same arrival.
  const trip: Transfer | null = useMemo(() => {
    if (!baseTransfer) return null;
    if (!transferFlight) return baseTransfer;
    return transfer(baseTransfer.origin, baseTransfer.destination, transferFlight.departMs, baseTransfer.arriveMs, { arrival: baseTransfer.arrival }) ?? baseTransfer;
  }, [baseTransfer, transferFlight]);

  // ── The moon leg ──
  // From the moon's own planet: a launch (Earth) or a parking orbit, then straight out to the moon.
  const localPlan = useMemo((): (MoonLegResult & { flight: Flight | null; noWindow: boolean }) | null => {
    if (!localTrip || !targetMoon || localDay === null || mode !== "plan") return null;
    void moonVersion;
    if (origin === "Earth") {
      const vehicle = VEHICLE_BY_ID.get(launch.vehicleId)!;
      const site = SITE_BY_ID.get(launch.siteId)!;
      const f = planLunarFlight(vehicle, site, launch.payloadKg, localDay, preferLaunchMs !== null && startOfDay(preferLaunchMs) === localDay ? preferLaunchMs : null);
      if (f) return { ...moonLegLocal(targetMoon.id, f.departMs, f.perigeeR, f.perigeeV), flight: f, noWindow: false };
    }
    const dep = localDeparture(targetMoon.id, localDay);
    if (!dep) {
      const error = moonError(targetMoon.id, [localDay]);
      return { leg: null, loading: !error, error, flight: null, noWindow: origin === "Earth" };
    }
    return { ...moonLegLocal(targetMoon.id, dep.departMs, dep.rP, dep.vP), flight: null, noWindow: origin === "Earth" };
  }, [localTrip, targetMoon, localDay, mode, origin, launch, moonVersion, preferLaunchMs]);
  // After an interplanetary transfer: capture at the planet, then across its system.
  const transferLeg = useMemo((): MoonLegResult | null => {
    if (localTrip || !targetMoon || !trip || trip.destination !== targetMoon.planet) return null;
    void moonVersion;
    return moonLegAfterTransfer(targetMoon.id, trip.vInfArrive, trip.arriveMs);
  }, [localTrip, targetMoon, trip, moonVersion]);
  const legResult: MoonLegResult | null = localTrip ? localPlan : transferLeg;
  const leg: MoonLeg | null = legResult?.leg ?? null;

  const flight: Flight | null = localTrip ? (localPlan?.flight ?? null) : transferFlight;
  const site = SITE_BY_ID.get(launch.siteId);
  const flightError = localTrip
    ? localPlan?.noWindow
      ? `No launch from ${site?.name} on ${formatDate(localDay ?? 0)} can reach the plane of the Moon's path within the pad's allowed headings; shown from a parking orbit instead. Try another day or pad.`
      : null
    : baseTransfer?.origin === "Earth" && !transferFlight
      ? `No launch from ${site?.name} on ${formatDate(baseTransfer.departMs)} can head off in this direction within the pad's allowed headings. Try another pad, or tick "Any pad".`
      : null;

  /** First and last moments of the planned trip. */
  const planStartMs = flight ? flight.window.launchMs : (trip?.departMs ?? leg?.burns[0].ms ?? null);
  const planEndMs = leg?.arriveMs ?? trip?.arriveMs ?? null;
  const hasPlan = mode === "plan" && (localTrip ? !!leg : !!trip);

  // Picking a trip: stop at launch (or departure), framed to show the way there.
  const lastTripKey = useRef<string | null>(null);
  useEffect(() => {
    if (mode !== "plan" || !hasPlan || planStartMs === null) return;
    const key = localTrip ? `${origin}-${destination}-${localDay}` : `${trip!.origin}-${destination}-${cellTrip?.departMs}-${cellTrip?.tofDays}`;
    if (key === lastTripKey.current) return;
    lastTripKey.current = key;
    clock.setPaused(true);
    clock.setTime(planStartMs);
    if (localTrip && targetMoon) {
      clock.setRate(3600);
      solarRef.current?.focus({ kind: "planet", id: targetMoon.planet }, (targetMoon.smaKm * 4) / AU_KM);
    } else if (trip) {
      clock.setRate(DAY);
      const reach = Math.max(planet(trip.origin).smaAu, planet(trip.destination).smaAu);
      solarRef.current?.focus({ kind: "sun" }, Math.min(120, reach * 2.8));
    }
  }, [mode, hasPlan, planStartMs, localTrip, origin, destination, localDay, trip, cellTrip, targetMoon, clock]);

  // ── What the solar system scene shows ──
  useEffect(() => {
    const solar = solarRef.current;
    if (!solar) return;
    if (mode === "missions" && mission && feed?.data && missionLine) {
      const traj = feed.data;
      const t0 = traj.t[0];
      const t1 = traj.t[traj.t.length - 1];
      const path: SolarPath = {
        id: mission.id,
        label: mission.name,
        color: MISSION_COLOR,
        xyz: missionLine.xyz,
        times: missionLine.times,
        position: (ms) => (ms < t0 || ms > t1 ? null : trajectoryPosition(traj, ms)),
        showProgress: true,
      };
      solar.setPaths([path]);
      solar.setMarkers([]);
      return;
    }
    if (mode === "plan" && (trip || leg)) {
      const paths: SolarPath[] = [];
      const launchMs = flight?.window.launchMs ?? trip?.departMs ?? 0;
      if (trip && !localTrip) {
        const pts = sampleTransfer(trip, 300);
        const xyz = new Float32Array(pts.length * 3);
        const times = new Float64Array(pts.length);
        pts.forEach((p, i) => {
          xyz.set(p, i * 3);
          times[i] = trip.departMs + ((trip.arriveMs - trip.departMs) * i) / (pts.length - 1);
        });
        paths.push({
          id: "plan",
          label: `${trip.origin} → ${destination}`,
          color: PLAN_COLOR,
          xyz,
          times,
          position: (ms) => {
            if (ms < launchMs) return null;
            if (ms < trip.departMs) return helioEclipticAu(trip.origin, ms);
            if (ms <= trip.arriveMs) return eqjToEcl(scale(transferPosition(trip, ms), 1 / AU_KM));
            // From here a moon leg takes over, drawn around the planet.
            if (leg) return null;
            if (trip.arrival !== "flyby") return helioEclipticAu(trip.destination, ms);
            // A flyby carries on along the transfer orbit (the planet's pull on the way past isn't modelled).
            return eqjToEcl(scale(propagate(trip.r2, trip.v2, (ms - trip.arriveMs) / 1000, MU_SUN).r, 1 / AU_KM));
          },
          showProgress: true,
        });
      }
      if (leg) {
        const pieces = sampleLeg(leg, 120);
        const pts: Vec3[] = pieces.flatMap((p) => p.points);
        const legTimes = pieces.flatMap((p) => p.times);
        const xyz = new Float32Array(pts.length * 3);
        pts.forEach((p, i) => xyz.set(eqjToEcl(scale(p, 1 / AU_KM)), i * 3));
        // From another planet, the leg starts on arrival there (the approach arc only shows as a line).
        const from = leg.local ? (flight?.window.launchMs ?? leg.startMs) : trip!.arriveMs;
        paths.push({
          id: "moon-leg",
          label: leg.local ? `${origin} → ${leg.moon}` : `→ ${leg.moon}`,
          color: leg.local ? PLAN_COLOR : MOON_LEG_COLOR,
          xyz,
          times: new Float64Array(legTimes),
          position: (ms) => {
            if (ms < from) return null;
            const p = legPosition(leg, ms) ?? (leg.local ? leg.arcs[0].r : null);
            return p ? eqjToEcl(scale(p, 1 / AU_KM)) : null;
          },
          showProgress: true,
          anchor: leg.planet,
        });
      }
      solar.setPaths(paths);
      solar.setMarkers(
        trip && !localTrip
          ? [
              { id: "dep", label: `${trip.origin} at departure`, color: planet(trip.origin).color, position: eqjToEcl(scale(trip.r1, 1 / AU_KM)) },
              { id: "arr", label: `${trip.destination} at arrival`, color: planet(trip.destination).color, position: eqjToEcl(scale(trip.r2, 1 / AU_KM)) },
            ]
          : []
      );
      return;
    }
    solar.setPaths([]);
    solar.setMarkers([]);
  }, [mode, mission, feed, missionLine, trip, leg, localTrip, flight, origin, destination, scenesReady]);

  // Frame a mission's whole path once it arrives.
  const framedMission = useRef<string | null>(null);
  useEffect(() => {
    if (mode !== "missions" || !mission || !feed?.data || framedMission.current === mission.id) return;
    framedMission.current = mission.id;
    let far = 1.5;
    const p = feed.data.p;
    for (let i = 0; i < p.length; i += 3) far = Math.max(far, Math.hypot(p[i], p[i + 1], p[i + 2]));
    solarRef.current?.focus({ kind: "sun" }, Math.min(400, far * 2.4));
  }, [mode, mission, feed]);

  // ── Earth (launch) and planet (moon leg) scenes ──
  useEffect(() => {
    const earth = earthRef.current;
    if (!earth) return;
    const vehicle = VEHICLE_BY_ID.get(launch.vehicleId)!;
    const sites = LAUNCH_SITES.filter((s) => vehicle.sites.includes(s.id) || s.id === launch.siteId);
    earth.setFlight(mode === "plan" ? flight : null, sites);
  }, [flight, mode, launch, scenesReady]);

  useEffect(() => {
    planetRef.current?.setTrip(mode === "plan" && leg ? { planet: leg.planet, leg } : null);
  }, [leg, mode, scenesReady]);

  const earthViewAvailable = mode === "plan" && !!flight;
  const planetViewAvailable = mode === "plan" && !!leg;
  const shownView: SceneView = (view === "earth" && earthViewAvailable) || (view === "planet" && planetViewAvailable) ? view : "solar";
  useEffect(() => {
    solarRef.current?.setActive(shownView === "solar");
    earthRef.current?.setActive(shownView === "earth");
    planetRef.current?.setActive(shownView === "planet");
  }, [shownView, scenesReady]);

  const watchLaunch = useCallback(() => {
    if (!flight) return;
    setView("earth");
    clock.setTime(flight.window.launchMs - 20_000);
    clock.setRate(10);
    clock.setPaused(false);
  }, [flight, clock]);

  // ── Opening a real upcoming launch as a planned trip ──
  const planLaunch = useCallback(
    (t: TripLaunch) => {
      const net = Date.parse(t.launch.net ?? "");
      if (!Number.isFinite(net)) return;
      const day = startOfDay(net);
      const vehicle = vehicleFor(t.launch.rocket);
      const pad = siteFor(t.launch.padLatitude, t.launch.padLongitude);
      setLaunch((cur) => {
        const vehicleId = vehicle?.id ?? cur.vehicleId;
        const siteId = pad && pad.km < 300 ? pad.site.id : VEHICLE_BY_ID.get(vehicleId)!.sites[0];
        return { ...cur, vehicleId, siteId };
      });
      setPlannedLaunch(t);
      setMode("plan");
      setView("solar");
      setOrigin("Earth");
      setDestination(t.destination);
      const toMoon = isMoon(t.destination) ? moon(t.destination) : null;
      if (toMoon?.planet === "Earth") setLocalDay(day);
      else aimChartAt("Earth", toMoon ? toMoon.planet : (t.destination as PlanetId), day, null);
    },
    [aimChartAt]
  );

  // ── Share link ──
  useEffect(() => {
    if (!urlReadRef.current || pendingTripRef.current) return;
    const q = new URLSearchParams();
    if (mode === "missions" && missionId) q.set("mission", missionId);
    if (mode === "plan" && hasPlan) {
      q.set("from", origin);
      q.set("to", destination);
      if (localTrip && localDay !== null) q.set("dep", new Date(localDay).toISOString().slice(0, 10));
      if (!localTrip && trip && cellTrip) {
        q.set("dep", new Date(cellTrip.departMs).toISOString().slice(0, 10));
        q.set("tof", String(Math.round(cellTrip.tofDays)));
        if (!targetMoon) q.set("arr", trip.arrival);
      }
      if (origin === "Earth") {
        q.set("lv", launch.vehicleId);
        q.set("site", launch.siteId);
        q.set("kg", String(launch.payloadKg));
      }
    }
    const s = q.toString();
    const url = `${window.location.pathname}${s ? `?${s}` : ""}`;
    if (url !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(window.history.state, "", url);
  }, [mode, missionId, hasPlan, origin, destination, localTrip, localDay, trip, cellTrip, targetMoon, launch]);

  // ── Time slider range and jump points ──
  const { range, marks } = useMemo((): { range: { startMs: number; endMs: number } | null; marks: TimeMark[] } => {
    if (mode === "missions" && mission) {
      const marks: TimeMark[] = mission.events
        .filter((e) => e.kind !== "milestone" && e.kind !== "end" && Date.parse(e.time) <= Date.parse(mission.dataStop))
        .slice(0, 7)
        .map((e) => ({ ms: Math.max(Date.parse(mission.dataStart), Date.parse(e.time)), label: e.kind === "launch" ? "Launch" : e.body ?? e.label }));
      return { range: { startMs: Date.parse(mission.dataStart), endMs: Date.parse(mission.dataStop) }, marks };
    }
    if (hasPlan && planStartMs !== null && planEndMs !== null) {
      const marks: TimeMark[] = [];
      if (flight) marks.push({ ms: flight.window.launchMs - 10_000, label: "Launch" });
      if (trip && !localTrip) marks.push({ ms: trip.departMs - 120_000, label: "Departure burn" });
      if (trip && !localTrip && !leg) marks.push({ ms: trip.arriveMs, label: `Arrive ${trip.destination}` });
      for (const [i, b] of (leg?.burns ?? []).entries()) {
        if (leg!.local && i === 0 && flight) continue;
        marks.push({ ms: b.ms - (leg!.local ? 600_000 : 3_600_000), label: b.label });
      }
      const start = flight ? flight.window.launchMs - 60_000 : planStartMs;
      return { range: { startMs: start, endMs: planEndMs + (leg ? 2 : 30) * DAY_MS }, marks };
    }
    return { range: null, marks: [] };
  }, [mode, mission, hasPlan, planStartMs, planEndMs, flight, trip, localTrip, leg]);

  const changeMode = useCallback((next: TripsMode) => {
    setMode(next);
    setView("solar");
    if (next === "plan") setGridStartMs((s) => s ?? Date.now());
  }, []);

  const toggleCollapsed = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const detailsLabel = mode === "missions" ? "Mission" : "Trip";
  const allPanels: DockPanel[] = [
    {
      id: "trips",
      label: "Trips",
      icon: MdRocketLaunch,
      zone: "left-top",
      content: (
        <TripsPanel
          mode={mode}
          onModeChange={changeMode}
          missions={missions}
          missionsError={missionsError}
          selectedMission={missionId}
          onSelectMission={selectMission}
          origin={origin}
          destination={destination}
          onRouteChange={(o, d) => {
            setOrigin(o);
            setDestination(d);
            setGrid(null);
            setCell(null);
            setPlannedLaunch(null);
          }}
          localDay={localDay}
          onLocalDayChange={(d) => {
            setLocalDay(startOfDay(d));
            setPlannedLaunch(null);
          }}
          moonLeg={leg}
          arrival={arrival}
          onArrivalChange={setArrival}
          grid={grid}
          computing={computing}
          selectedCell={cell}
          onSelectCell={(col, row) => setCell({ col, row })}
          onShiftWindow={(dir) => {
            if (!gridRequest) return;
            const span = gridRequest.cols * gridRequest.departStepDays;
            setGridStartMs(gridRequest.departStartMs + dir * span * 0.8 * DAY_MS);
          }}
          transfer={trip}
          launches={launches}
          launchesError={launchesError}
          onPlanLaunch={planLaunch}
        />
      ),
    },
    {
      id: "details",
      label: detailsLabel,
      icon: MdInfoOutline,
      zone: "right",
      empty: mode === "missions" ? !mission : !hasPlan && !legResult?.loading && !legResult?.error,
      emptyText: mode === "missions" ? "Pick a mission." : mode === "upcoming" ? "Pick a launch to plan its trip." : "Pick a trip on the chart.",
      content:
        mode === "missions" ? (
          mission && <MissionDetails mission={mission} feed={feed} clock={clock} />
        ) : mode === "plan" ? (
          <PlanDetails
            origin={origin}
            destination={destination}
            transfer={localTrip ? null : trip}
            leg={leg}
            legLoading={!!legResult?.loading}
            legError={legResult?.error ?? null}
            flight={flight}
            flightError={flightError}
            plannedLaunch={plannedLaunch}
            launch={launch}
            onLaunchChange={setLaunch}
            onWatchLaunch={watchLaunch}
            clock={clock}
          />
        ) : null,
    },
    {
      id: "rocket",
      label: "Rocket",
      icon: MdRocket,
      zone: "right",
      pinBottom: true,
      empty: !(mode === "plan" && flight),
      emptyText: "Plan a trip from Earth to see its rocket.",
      content: mode === "plan" && flight ? <VehiclePanel flight={flight} clock={clock} /> : null,
    },
    {
      id: "time",
      label: "Time",
      icon: MdSchedule,
      zone: "left-bottom",
      content: (
        <TripTimeControls
          clock={clock}
          range={range}
          marks={marks}
          view={shownView}
          onViewChange={setView}
          earthViewAvailable={earthViewAvailable}
          moonLegPlanet={planetViewAvailable ? leg!.planet : null}
        />
      ),
    },
  ];

  // The rocket only exists for a planned trip from Earth.
  const panels = mode === "plan" ? allPanels : allPanels.filter((p) => p.id !== "rocket");

  const sceneArea = isPhone
    ? { position: "absolute" as const, zIndex: 1, left: 0, right: 0, top: PHONE_TOP_BAR_PX, bottom: bottomInset }
    : { position: "absolute" as const, zIndex: 1, inset: 0 };

  const phoneStatus = mode === "missions" ? (mission?.name ?? "Real missions") : mode === "upcoming" ? "Upcoming launches" : "Plan a trip";
  return (
    <div style={{ position: "relative", width: "100vw", height: "100vh", overflow: "hidden", background: "#000003" }}>
      <div style={sceneArea}>
        <div ref={solarHostRef} style={{ position: "absolute", inset: 0, display: shownView === "solar" ? "block" : "none" }} />
        <div ref={earthHostRef} style={{ position: "absolute", inset: 0, display: shownView === "earth" ? "block" : "none" }} />
        <div ref={planetHostRef} style={{ position: "absolute", inset: 0, display: shownView === "planet" ? "block" : "none" }} />
      </div>

      <Navbar current="trips" compact={layout.compactNav} status={isPhone ? <span>{phoneStatus}</span> : undefined} />

      <PanelDock
        mode={layout.mode}
        panels={panels}
        collapsed={collapsed}
        onToggleCollapsed={toggleCollapsed}
        sheet={sheet}
        onSheetChange={setSheet}
        onBottomInsetChange={setBottomInset}
        topInset={isPhone ? 0 : 52}
      />
    </div>
  );
}
