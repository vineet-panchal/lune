"use client";

import { useEffect, useMemo, useState } from "react";
import {
  fetchAnalyticsHealth,
  type CloseApproach,
  type CloseApproachesResponse,
  type KDistanceResponse,
  type KSweepResponse,
  type ProjectionResponse,
} from "../../lib/api";
import { ALGORITHM_LABELS, type ClusterAlgorithm } from "../../lib/clusterLabels";
import type { ClusterRun } from "../../lib/clusterExport";
import {
  DEFAULT_ELEMENTS,
  featureNames,
  ORBITAL_ELEMENTS,
  STALE_AFTER_MS,
  type FeatureSelection,
  type FeatureSet,
  type OrbitalElement,
  type OrbitPoint,
} from "../../lib/clusterFeatures";
import type { SkyView } from "../../lib/coverage";
import type { Observer } from "../../lib/passes";
import { loadSavedRuns, saveRun, type SavedRun } from "../../lib/savedRuns";
import type { ReadableStore } from "../../lib/store";
import CloseApproaches from "./analytics/CloseApproaches";
import ClusterInspector from "./analytics/ClusterInspector";
import ConstellationHealthView from "./analytics/ConstellationHealthView";
import MySky from "./analytics/MySky";
import OrbitChanges, { type ChangeKind } from "./analytics/OrbitChanges";
import OrbitScatter, { type ModelProjection } from "./analytics/OrbitScatter";
import SavedRuns from "./analytics/SavedRuns";
import { KDistanceChart, KSweepChart } from "./analytics/SweepChart";
import { buttonStyle, chipStyle, errorStyle, hintStyle, sectionStyle, sectionTitleStyle } from "./analytics/ui";

export type { ClusterAlgorithm };

export type ClusterSummary = {
  algorithm: ClusterAlgorithm;
  nClusters: number;
  inertia: number | null;
  sizes: Record<number, number>;
  noiseCount: number | null;
  paramsLine: string;
  /** What the satellites were compared by, and a readable list of it. */
  featureSet: FeatureSet;
  featuresLine: string;
  /** The (simulated) moment whose positions were clustered. */
  computedAtMs: number;
  /** Every satellite sent to the model, its label and features (inspector, scatter colours, CSV). */
  run: ClusterRun;
};

/** How often to ask whether the Python service is reachable. */
const HEALTH_POLL_MS = 15_000;
const NOW_REFRESH_MS = 1000;

type Health = "checking" | "online" | "offline";

export type ClusterRunPayload = (
  | { algorithm: "kmeans" | "gmm"; k: number }
  | { algorithm: "dbscan"; eps: number; minSamples: number }
  | { algorithm: "hdbscan"; minClusterSize: number }
  | { algorithm: "isolation_forest"; contamination: number }
) & { features: FeatureSelection };

/** A settings suggestion: score k = 2..12, or DBSCAN's k-distance curve. */
export type SweepPanelRequest =
  | { kind: "kmeans" | "gmm"; features: FeatureSelection }
  | { kind: "kdistance"; features: FeatureSelection; minSamples: number };

type OrbitalAnalyticsPanelProps = {
  satelliteSampleCount: number;
  satelliteTotalCount: number;
  loadingCatalog: boolean;
  clusteringBusy: boolean;
  clusterError: string | null;
  clusterSummary: ClusterSummary | null;
  onRunClustering: (payload: ClusterRunPayload) => void;
  onClearClustering: () => void;
  onSweep: (request: SweepPanelRequest) => Promise<KSweepResponse | KDistanceResponse>;
  /** Downloads the last run as CSV. */
  onExportCsv: () => void;
  /** The globe's current (possibly simulated) time, to tell when a run's positions are out of date. */
  getNow: () => Date;
  /** Orbit values of every satellite drawn on the globe. */
  orbitPoints: OrbitPoint[];
  /** Keep these satellites bright on the globe and dim the rest (null: all normal). */
  onFocusSatellites: (ids: number[] | null) => void;
  /** Select a satellite on this globe and follow it. */
  onShowSatellite: (id: number) => void;
  /** Light a satellite up on the globe while the pointer is over it in the panel (null to stop). */
  onHoverSatellite: (id: number | null) => void;
  /** Satellite under the pointer on the globe. */
  globeHover: ReadableStore<number | null>;
  /** A Satellite Tracker link with (up to 10 of) these satellites selected. */
  trackerUrl: (ids: number[]) => string;
  /** The satellite filter in use, e.g. "Internet / Starlink" (saved with runs). */
  filterLabel: string;
  /** PCA of the chosen features for the loaded satellites (ids in the same order as coords). */
  onProject: (features: FeatureSelection) => Promise<ProjectionResponse & { ids: number[] }>;
  onFindApproaches: (hours: number, thresholdKm: number) => Promise<CloseApproachesResponse>;
  onShowApproach: (approach: CloseApproach) => void;
  onGoLive: () => void;
  observer: Observer | null;
  onObserverChange: (observer: Observer | null) => void;
  getSkyView: (observer: Observer) => SkyView | null;
  coverageMinElevation: number | null;
  onCoverageChange: (minElevationDeg: number | null) => void;
  coverageMax: number;
  /**
   * "sidebar": fills the dock's right-hand column (desktop / tablet); "sheet": inside the phone
   * bottom sheet. Omitted: positions itself as a full-height sidebar.
   */
  variant?: "sidebar" | "sheet";
};

const ALGO_OPTIONS: { id: ClusterAlgorithm; description: string }[] = [
  { id: "kmeans", description: "K-means splits the satellites into k groups around k centres." },
  {
    id: "gmm",
    description:
      "A Gaussian mixture fits k overlapping groups of any shape and says how sure it is of each satellite's group.",
  },
  { id: "dbscan", description: "DBSCAN finds dense groups and marks satellites in sparse areas as noise." },
  {
    id: "hdbscan",
    description: "HDBSCAN finds dense groups of different densities on its own: no radius to tune, only a minimum size.",
  },
  {
    id: "isolation_forest",
    description: "Isolation forest flags satellites that look unlike the bulk of the fleet (anomalies).",
  },
];

const FEATURE_SET_OPTIONS: { id: FeatureSet; label: string; description: string }[] = [
  {
    id: "elements",
    label: "Orbital elements",
    description:
      "Compares the orbits themselves, from each TLE. Finds shells and orbital planes; the groups stay valid for hours.",
  },
  {
    id: "position",
    label: "Position now",
    description:
      "Compares where satellites are right now (x, y, z in km from Earth's centre). Finds groups by place; they drift apart within minutes.",
  },
];

/**
 * What stays bright on the globe and in the scatter plot: one cluster of the current run, or any other set of
 * satellites (a kind of orbit change, a shell or plane, close approaches, satellites that changed group), by key.
 */
type Focus = { kind: "cluster"; label: number; run: ClusterRun } | { kind: "ids"; key: string; ids: number[] } | null;

type Tab = "models" | "explore" | "fleet" | "events" | "sky";
const TABS: { id: Tab; label: string }[] = [
  { id: "models", label: "Models" },
  { id: "explore", label: "Explore" },
  { id: "fleet", label: "Fleet" },
  { id: "events", label: "Events" },
  { id: "sky", label: "My sky" },
];

/** Readable names for feature columns, to say what drives each PCA axis. */
const FEATURE_LABELS: Record<string, string> = {
  mean_altitude_km: "altitude",
  inclination_deg: "inclination",
  raan_sin: "orbital plane",
  raan_cos: "orbital plane",
  eccentricity: "eccentricity",
  x_km: "x",
  y_km: "y",
  z_km: "z",
};

export default function OrbitalAnalyticsPanel({
  satelliteSampleCount,
  satelliteTotalCount,
  loadingCatalog,
  clusteringBusy,
  clusterError,
  clusterSummary,
  onRunClustering,
  onClearClustering,
  onSweep,
  onExportCsv,
  getNow,
  orbitPoints,
  onFocusSatellites,
  onShowSatellite,
  onHoverSatellite,
  globeHover,
  trackerUrl,
  filterLabel,
  onProject,
  onFindApproaches,
  onShowApproach,
  onGoLive,
  observer,
  onObserverChange,
  getSkyView,
  coverageMinElevation,
  onCoverageChange,
  coverageMax,
  variant,
}: OrbitalAnalyticsPanelProps) {
  const [tab, setTab] = useState<Tab>("models");
  const [polledHealth, setHealth] = useState<Health>("checking");
  useEffect(() => {
    let cancelled = false;
    const check = () =>
      fetchAnalyticsHealth().then((ok) => {
        if (!cancelled) setHealth(ok ? "online" : "offline");
      });
    void check();
    const timer = window.setInterval(check, HEALTH_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);
  // A run that just failed to reach the service is fresher news than the last poll.
  const health: Health = clusterError?.startsWith("Cannot reach analytics service") ? "offline" : polledHealth;

  // Only tick while there's a result whose age matters.
  const [nowMs, setNowMs] = useState<number | null>(null);
  useEffect(() => {
    if (!clusterSummary) return;
    const update = () => setNowMs(getNow().getTime());
    update();
    const timer = window.setInterval(update, NOW_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [clusterSummary, getNow]);
  const stale =
    clusterSummary !== null &&
    nowMs !== null &&
    Math.abs(nowMs - clusterSummary.computedAtMs) > STALE_AFTER_MS[clusterSummary.featureSet];

  const [featureSet, setFeatureSet] = useState<FeatureSet>("elements");
  const [elements, setElements] = useState<OrbitalElement[]>(DEFAULT_ELEMENTS);
  const toggleElement = (id: OrbitalElement) =>
    setElements((prev) => (prev.includes(id) ? prev.filter((e) => e !== id) : [...prev, id]));
  const features: FeatureSelection = featureSet === "position" ? { set: "position" } : { set: "elements", elements };
  const featuresReady = featureSet === "position" || elements.length > 0;

  const [algorithm, setAlgorithm] = useState<ClusterAlgorithm>("kmeans");
  const [k, setK] = useState(5);
  const [dbscanEps, setDbscanEps] = useState(0.4);
  const [dbscanMinSamples, setDbscanMinSamples] = useState(5);
  const [hdbscanMinClusterSize, setHdbscanMinClusterSize] = useState(30);
  const [isolationContamination, setIsolationContamination] = useState(0.06);

  const maxK = Math.max(2, Math.min(12, satelliteSampleCount || 2));
  const kEffective = Math.min(k, maxK);
  const minSamplesEffective = Math.min(dbscanMinSamples, satelliteSampleCount || 2);

  const canRun =
    featuresReady &&
    !loadingCatalog &&
    !clusteringBusy &&
    satelliteSampleCount >= 2 &&
    ((algorithm !== "kmeans" && algorithm !== "gmm") || (kEffective >= 2 && kEffective <= satelliteSampleCount));

  const run = () => {
    if (!canRun) return;
    switch (algorithm) {
      case "kmeans":
      case "gmm":
        return onRunClustering({ algorithm, k: kEffective, features });
      case "dbscan":
        return onRunClustering({ algorithm, eps: dbscanEps, minSamples: minSamplesEffective, features });
      case "hdbscan":
        return onRunClustering({ algorithm, minClusterSize: hdbscanMinClusterSize, features });
      case "isolation_forest":
        return onRunClustering({ algorithm, contamination: isolationContamination, features });
    }
  };

  // Settings suggestions: only shown while they still match the model, features (and DBSCAN's min points).
  const sweepKind = algorithm === "kmeans" || algorithm === "gmm" ? algorithm : algorithm === "dbscan" ? "kdistance" : null;
  const sweepKey = JSON.stringify({ sweepKind, features, minSamples: sweepKind === "kdistance" ? minSamplesEffective : null });
  const [sweep, setSweep] = useState<{ key: string; data: KSweepResponse | KDistanceResponse } | null>(null);
  const [sweepBusy, setSweepBusy] = useState(false);
  const [sweepError, setSweepError] = useState<{ key: string; message: string } | null>(null);
  const suggest = async () => {
    if (!sweepKind || !featuresReady) return;
    const key = sweepKey;
    setSweepBusy(true);
    setSweepError(null);
    try {
      const data = await onSweep(
        sweepKind === "kdistance" ? { kind: "kdistance", features, minSamples: minSamplesEffective } : { kind: sweepKind, features }
      );
      setSweep({ key, data });
      if (data.kind === "kdistance") setDbscanEps(data.suggestedEps);
      else setK(data.suggestedK);
    } catch (e) {
      setSweepError({ key, message: e instanceof Error ? e.message : "Suggestion failed" });
    } finally {
      setSweepBusy(false);
    }
  };
  const sweepShown = sweep?.key === sweepKey ? sweep.data : null;

  // Focus: one cluster or one kind of orbit change stays bright on the globe and in the scatter plot.
  const [focusState, setFocus] = useState<Focus>(null);
  const focus = focusState?.kind === "cluster" && focusState.run !== clusterSummary?.run ? null : focusState;
  const focusIds = useMemo(() => {
    if (!focus) return null;
    if (focus.kind === "ids") return new Set(focus.ids);
    return new Set(focus.run.rows.filter((r) => r.label === focus.label).map((r) => r.satelliteId));
  }, [focus]);
  useEffect(() => {
    onFocusSatellites(focusIds ? [...focusIds] : null);
  }, [focusIds, onFocusSatellites]);

  const orbitById = useMemo(() => new Map(orbitPoints.map((p) => [p.satelliteId, p])), [orbitPoints]);
  const labelById = useMemo(
    () => (clusterSummary ? new Map(clusterSummary.run.rows.map((r) => [r.satelliteId, r.label])) : null),
    [clusterSummary]
  );
  const loadedIds = useMemo(() => orbitPoints.map((p) => p.satelliteId), [orbitPoints]);
  const focusedKey = focus?.kind === "ids" ? focus.key : null;
  const focusIdsFor = (key: string | null, ids: number[]) => setFocus(key === null ? null : { kind: "ids", key, ids });

  // Model view (PCA) for the scatter plot, kept until the feature choice changes.
  const featuresKey = JSON.stringify(features);
  const [projection, setProjection] = useState<{ key: string; data: ModelProjection } | null>(null);
  const [projectionBusy, setProjectionBusy] = useState(false);
  const [projectionError, setProjectionError] = useState<string | null>(null);
  const requestProjection = async () => {
    if (!featuresReady) {
      setProjectionError("Pick at least one orbital element on the Models tab first.");
      return;
    }
    const key = featuresKey;
    setProjectionBusy(true);
    setProjectionError(null);
    try {
      const res = await onProject(features);
      const names = featureNames(features);
      setProjection({
        key,
        data: {
          coords: new Map(res.ids.map((id, i) => [id, res.coords[i]])),
          explained: res.explainedVariance,
          drivers: res.loadings.map((row) => topDrivers(row, names)),
          featuresLine:
            features.set === "position"
              ? "position (x, y, z)"
              : ORBITAL_ELEMENTS.filter((e) => elements.includes(e.id)).map((e) => e.label.toLowerCase()).join(", "),
        },
      });
    } catch (e) {
      setProjectionError(e instanceof Error ? e.message : "Projection failed");
    } finally {
      setProjectionBusy(false);
    }
  };

  // Saved runs live in this browser (localStorage), read after mount so server and client render alike.
  const [savedRuns, setSavedRuns] = useState<SavedRun[]>([]);
  useEffect(() => {
    try {
      setSavedRuns(loadSavedRuns());
    } catch {
      /* storage unavailable: start with none */
    }
  }, []);
  const [savedFor, setSavedFor] = useState<number | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const saveCurrentRun = () => {
    if (!clusterSummary) return;
    try {
      setSavedRuns(
        saveRun({
          filter: filterLabel,
          algorithm: clusterSummary.algorithm,
          paramsLine: clusterSummary.paramsLine,
          featuresLine: clusterSummary.featuresLine,
          computedAtMs: clusterSummary.computedAtMs,
          ids: clusterSummary.run.rows.map((r) => r.satelliteId),
          labels: clusterSummary.run.rows.map((r) => r.label),
        })
      );
      setSavedFor(clusterSummary.computedAtMs);
      setSaveError(null);
    } catch {
      setSaveError("Couldn't save: this browser's storage is full or blocked.");
    }
  };

  const slider = (label: string, value: number, display: string, min: number, max: number, step: number, onChange: (v: number) => void) => (
    <>
      <label style={{ display: "block", fontSize: 11, color: "rgba(200,210,230,0.65)", marginBottom: 6 }}>{label}</label>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          disabled={satelliteSampleCount < 2}
          style={{ flex: "1 1 140px", minWidth: 120 }}
        />
        <span style={{ minWidth: 40, textAlign: "right", color: "rgba(200,210,230,0.85)" }}>{display}</span>
      </div>
    </>
  );

  return (
    <aside
      style={{
        ...(variant
          ? { position: "relative" as const, width: "100%", height: variant === "sidebar" ? "100%" : undefined }
          : { position: "absolute" as const, top: 0, right: 0, bottom: 0, width: 392 }),
        boxSizing: "border-box",
        padding: variant === "sheet" ? "12px 14px" : "72px 18px 20px",
        background: "linear-gradient(180deg, rgba(6,8,14,0.92) 0%, rgba(4,6,12,0.96) 100%)",
        borderLeft: "1px solid rgba(255,255,255,0.10)",
        color: "#e8ecf4",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        fontSize: 12,
        zIndex: 8,
        overflowY: "auto",
        backdropFilter: "blur(10px)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
        <span style={{ fontWeight: 700, fontSize: 13, letterSpacing: 0.6 }}>Orbital analytics</span>
        <HealthBadge health={health} />
      </div>
      <p style={{ margin: "0 0 16px", color: "rgba(220,228,240,0.72)", lineHeight: 1.5 }}>
        Group the loaded satellites with machine learning. Models run in the Python analytics service
        (scikit-learn) via Spring Boot; the globe colours update from the returned labels.
      </p>

      <div role="tablist" aria-label="Analytics sections" style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 14 }}>
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)} style={{ ...chipStyle(tab === t.id), padding: "5px 9px" }}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "models" && (
      <>
      <section style={sectionStyle}>
        <div style={sectionTitleStyle}>Compare satellites by</div>
        <div role="tablist" aria-label="Features" style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
          {FEATURE_SET_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              role="tab"
              aria-selected={featureSet === opt.id}
              onClick={() => setFeatureSet(opt.id)}
              disabled={clusteringBusy}
              style={chipStyle(featureSet === opt.id, clusteringBusy)}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <p style={{ ...hintStyle, marginBottom: featureSet === "elements" ? 10 : 0 }}>
          {FEATURE_SET_OPTIONS.find((o) => o.id === featureSet)?.description}
        </p>
        {featureSet === "elements" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {ORBITAL_ELEMENTS.map((el) => (
              <label key={el.id} style={{ display: "flex", alignItems: "baseline", gap: 8, cursor: "pointer", fontSize: 11 }}>
                <input
                  type="checkbox"
                  checked={elements.includes(el.id)}
                  onChange={() => toggleElement(el.id)}
                  disabled={clusteringBusy}
                  style={{ accentColor: "#7ba4e8", margin: 0, transform: "translateY(1px)" }}
                />
                <span style={{ color: "rgba(220,228,240,0.9)" }}>{el.label}</span>
                <span style={{ color: "rgba(170,182,200,0.6)", fontSize: 10 }}>{el.detail}</span>
              </label>
            ))}
            {!featuresReady && (
              <div style={{ fontSize: 10, color: "#ffb4a8" }}>Pick at least one element to compare by.</div>
            )}
          </div>
        )}
      </section>

      <section style={sectionStyle}>
        <div style={sectionTitleStyle}>Model</div>
        <div role="tablist" aria-label="Clustering model" style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
          {ALGO_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              role="tab"
              aria-selected={algorithm === opt.id}
              onClick={() => setAlgorithm(opt.id)}
              disabled={clusteringBusy}
              style={chipStyle(algorithm === opt.id, clusteringBusy)}
            >
              {ALGORITHM_LABELS[opt.id]}
            </button>
          ))}
        </div>

        <p style={{ ...hintStyle, marginBottom: 12 }}>{ALGO_OPTIONS.find((o) => o.id === algorithm)?.description}</p>

        {(algorithm === "kmeans" || algorithm === "gmm") &&
          slider("Clusters (k)", kEffective, String(kEffective), 2, maxK, 1, (v) => setK(v))}
        {algorithm === "dbscan" && (
          <>
            {slider("Neighbourhood radius (eps, in standardised units)", dbscanEps, dbscanEps.toFixed(2), 0.05, 3, 0.01, setDbscanEps)}
            {slider("Min. points to form a cluster", minSamplesEffective, String(minSamplesEffective), 2, Math.max(2, Math.min(50, satelliteSampleCount || 2)), 1, setDbscanMinSamples)}
          </>
        )}
        {algorithm === "hdbscan" &&
          slider("Smallest group worth calling a cluster", hdbscanMinClusterSize, String(hdbscanMinClusterSize), 5, 300, 5, setHdbscanMinClusterSize)}
        {algorithm === "isolation_forest" &&
          slider("Expected fraction of outliers (contamination)", isolationContamination, `${(100 * isolationContamination).toFixed(0)}%`, 0.02, 0.18, 0.01, setIsolationContamination)}

        {sweepKind && (
          <div style={{ marginBottom: 10 }}>
            <button
              type="button"
              onClick={() => void suggest()}
              disabled={sweepBusy || clusteringBusy || !featuresReady || satelliteSampleCount < 3}
              style={buttonStyle(!sweepBusy && !clusteringBusy && featuresReady && satelliteSampleCount >= 3)}
              title={sweepKind === "kdistance" ? "Measure how close satellites are to their neighbours" : "Try k = 2 to 12 and score each"}
            >
              {sweepBusy ? "Working…" : sweepKind === "kdistance" ? "Suggest eps" : "Suggest k"}
            </button>
            {sweepError?.key === sweepKey && <div style={{ ...errorStyle, marginTop: 8 }}>{sweepError.message}</div>}
            {sweepShown && (
              <div style={{ marginTop: 8 }}>
                {sweepShown.kind === "kdistance" ? (
                  <KDistanceChart result={sweepShown} eps={dbscanEps} onPick={setDbscanEps} />
                ) : (
                  <KSweepChart result={sweepShown} k={kEffective} onPick={setK} />
                )}
              </div>
            )}
          </div>
        )}

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            disabled={!canRun}
            onClick={run}
            style={{
              padding: "8px 14px",
              borderRadius: 8,
              border: "1px solid rgba(123, 164, 232, 0.45)",
              background: canRun ? "rgba(86, 132, 214, 0.28)" : "rgba(80,80,90,0.25)",
              color: canRun ? "#e8f0ff" : "rgba(255,255,255,0.35)",
              cursor: canRun ? "pointer" : "not-allowed",
              fontFamily: "inherit",
              fontSize: 11,
              fontWeight: 600,
            }}
          >
            {clusteringBusy ? "Running…" : "Run model"}
          </button>
          <button
            type="button"
            disabled={clusteringBusy || !clusterSummary}
            onClick={onClearClustering}
            style={{ ...buttonStyle(Boolean(clusterSummary) && !clusteringBusy), padding: "8px 14px" }}
          >
            Clear coloring
          </button>
        </div>
        <div style={{ marginTop: 10, fontSize: 10, color: "rgba(180,190,210,0.55)" }}>
          Loaded for analysis: {satelliteSampleCount.toLocaleString()} / {satelliteTotalCount.toLocaleString()}{" "}
          satellites
        </div>
      </section>

      {clusterError && <div style={{ ...errorStyle, fontSize: 11, marginBottom: 12 }}>{clusterError}</div>}

      {clusterSummary && (
        <section style={{ ...sectionStyle, background: "rgba(255,255,255,0.03)" }}>
          <div style={{ fontWeight: 600, marginBottom: 8, color: "#c5d5f1" }}>Last run</div>
          <div style={{ color: "rgba(210,220,235,0.8)", marginBottom: 4 }}>
            {ALGORITHM_LABELS[clusterSummary.algorithm]}
            <span style={{ color: "rgba(180,190,210,0.65)" }}> · {clusterSummary.paramsLine}</span>
            {clusterSummary.inertia != null && (
              <span style={{ color: "rgba(180,190,210,0.65)" }}>
                {" "}
                · inertia ≈ {clusterSummary.inertia.toFixed(1)}
              </span>
            )}
          </div>
          <div style={{ fontSize: 10, color: "rgba(170,182,200,0.65)", marginBottom: 8, lineHeight: 1.5 }}>
            <div>By {clusterSummary.featuresLine}</div>
            <div>
              {clusterSummary.featureSet === "position" ? "Positions" : "Orbits"} at{" "}
              {formatRunTime(clusterSummary.computedAtMs)}
            </div>
          </div>
          {stale && (
            <div
              style={{
                padding: "8px 10px",
                borderRadius: 8,
                background: "rgba(255, 183, 77, 0.12)",
                border: "1px solid rgba(255, 183, 77, 0.35)",
                color: "#ffd8a8",
                fontSize: 10,
                lineHeight: 1.45,
                marginBottom: 8,
              }}
            >
              Out of date: the globe is {formatGap(Math.abs((nowMs ?? 0) - clusterSummary.computedAtMs))} away from this
              run, and the satellites{clusterSummary.featureSet === "position" ? " have moved" : "' orbital planes have turned"}{" "}
              since. Run the model again for current groupings.
            </div>
          )}
          {(clusterSummary.algorithm === "dbscan" || clusterSummary.algorithm === "hdbscan") && (
            <div style={{ fontSize: 10, color: "rgba(170,182,200,0.65)", marginBottom: 8 }}>
              Density clusters found: {clusterSummary.nClusters}
              {clusterSummary.noiseCount != null ? ` · noise points: ${clusterSummary.noiseCount}` : ""}
            </div>
          )}
          {clusterSummary.algorithm === "isolation_forest" && clusterSummary.noiseCount != null && (
            <div style={{ fontSize: 10, color: "rgba(170,182,200,0.65)", marginBottom: 8 }}>
              Flagged as anomalous: {clusterSummary.noiseCount} satellites
            </div>
          )}
          <ClusterInspector
            summary={clusterSummary}
            orbitById={orbitById}
            focusedLabel={focus?.kind === "cluster" ? focus.label : null}
            onFocusLabel={(label) => setFocus(label === null ? null : { kind: "cluster", label, run: clusterSummary.run })}
            onShow={onShowSatellite}
            onHover={onHoverSatellite}
            trackerUrl={trackerUrl}
          />
          <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={onExportCsv}
              title="Download every satellite with its label and the features the model saw"
              style={buttonStyle()}
            >
              Export CSV
            </button>
            <button
              type="button"
              onClick={saveCurrentRun}
              disabled={savedFor === clusterSummary.computedAtMs}
              title="Keep this run in this browser to compare later runs against it"
              style={buttonStyle(savedFor !== clusterSummary.computedAtMs)}
            >
              {savedFor === clusterSummary.computedAtMs ? "Saved ✓" : "Save run"}
            </button>
          </div>
          {saveError && <div style={{ ...errorStyle, marginTop: 8 }}>{saveError}</div>}
        </section>
      )}

      <section style={sectionStyle}>
        <div style={sectionTitleStyle}>Saved runs</div>
        <SavedRuns
          runs={savedRuns}
          onRunsChange={setSavedRuns}
          current={clusterSummary}
          focusedRunId={focusedKey?.startsWith("run:") ? focusedKey.slice(4) : null}
          onFocusChanged={(runId, ids) => focusIdsFor(runId === null ? null : `run:${runId}`, ids)}
          onShow={onShowSatellite}
          onHover={onHoverSatellite}
        />
      </section>
      </>
      )}

      {tab === "explore" && (
        <section style={sectionStyle}>
          <div style={sectionTitleStyle}>Explore orbits</div>
          <OrbitScatter
            points={orbitPoints}
            labelById={labelById}
            algorithm={clusterSummary?.algorithm ?? null}
            focusIds={focusIds}
            globeHover={globeHover}
            onHover={onHoverSatellite}
            onPick={onShowSatellite}
            projection={projection?.data ?? null}
            projectionCurrent={projection?.key === featuresKey}
            projectionBusy={projectionBusy}
            projectionError={projectionError}
            onRequestProjection={() => void requestProjection()}
          />
        </section>
      )}

      {tab === "fleet" && (
        <section style={sectionStyle}>
          <div style={sectionTitleStyle}>Constellation health</div>
          <ConstellationHealthView points={orbitPoints} focusedKey={focusedKey} onFocus={focusIdsFor} />
        </section>
      )}

      {tab === "events" && (
        <>
          <section style={sectionStyle}>
            <div style={sectionTitleStyle}>Close approaches</div>
            <CloseApproaches
              loadedCount={orbitPoints.length}
              onFind={onFindApproaches}
              onShowApproach={(a) => {
                focusIdsFor(`approach:${a.a.satelliteId}-${a.b.satelliteId}`, [a.a.satelliteId, a.b.satelliteId]);
                onShowApproach(a);
              }}
              onGoLive={onGoLive}
              getNow={getNow}
              focusedKey={focusedKey}
              onFocus={focusIdsFor}
            />
          </section>
          <section style={sectionStyle}>
            <div style={sectionTitleStyle}>Orbit changes</div>
            <OrbitChanges
              loadedIds={loadedIds}
              focusedKind={focusedKey?.startsWith("changes:") ? (focusedKey.slice(8) as ChangeKind) : null}
              onFocusKind={(change, ids) => focusIdsFor(change === null ? null : `changes:${change}`, ids)}
              onShow={onShowSatellite}
              onHover={onHoverSatellite}
            />
          </section>
        </>
      )}

      {tab === "sky" && (
        <section style={sectionStyle}>
          <MySky
            observer={observer}
            onObserverChange={onObserverChange}
            getSkyView={getSkyView}
            coverageMinElevation={coverageMinElevation}
            onCoverageChange={onCoverageChange}
            coverageMax={coverageMax}
            onShow={onShowSatellite}
            onHover={onHoverSatellite}
          />
        </section>
      )}

      {health === "offline" && (
        <section style={{ marginTop: 16, color: "rgba(170,182,204,0.7)", fontSize: 10, lineHeight: 1.55 }}>
          Start the Python analytics service: run{" "}
          <span style={{ color: "rgba(200,210,230,0.85)" }}>uvicorn main:app --port 8000</span> in analytics-service,
          or point Spring at a running one with <span style={{ color: "rgba(200,210,230,0.85)" }}>lune.analytics.base-url</span>.
        </section>
      )}
    </aside>
  );
}

const HEALTH_STYLE: Record<Health, { label: string; color: string; title: string }> = {
  checking: { label: "Checking…", color: "rgba(200,210,230,0.55)", title: "Checking whether the analytics service is reachable" },
  online: { label: "Online", color: "#66bb6a", title: "The Python analytics service is reachable" },
  offline: { label: "Offline", color: "#ff8a80", title: "The Python analytics service can't be reached; models won't run" },
};

function HealthBadge({ health }: { health: Health }) {
  const style = HEALTH_STYLE[health];
  return (
    <span title={style.title} style={{ fontSize: 10, color: style.color, whiteSpace: "nowrap" }}>
      ● {style.label}
    </span>
  );
}

function formatRunTime(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatGap(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} h` : `${Math.round(hours / 24)} days`;
}

/** The one or two features that make up most of a PCA axis, e.g. "inclination, altitude". */
function topDrivers(loadings: number[], names: string[]): string {
  const byLabel = new Map<string, number>();
  loadings.forEach((w, i) => {
    const label = FEATURE_LABELS[names[i]] ?? names[i];
    byLabel.set(label, (byLabel.get(label) ?? 0) + w * w);
  });
  const ranked = [...byLabel].sort((a, b) => b[1] - a[1]);
  const total = ranked.reduce((sum, [, v]) => sum + v, 0) || 1;
  return ranked
    .filter(([, v], i) => i === 0 || v / total > 0.25)
    .slice(0, 2)
    .map(([label]) => label)
    .join(", ");
}
