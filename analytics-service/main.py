"""Lightweight analytics API for Lune (orbital clustering & anomaly detection)."""

from __future__ import annotations

import numpy as np
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field, field_validator
from scipy.spatial import cKDTree
from sgp4.api import Satrec, SatrecArray
from sklearn.cluster import DBSCAN, HDBSCAN, KMeans
from sklearn.decomposition import PCA
from sklearn.ensemble import IsolationForest
from sklearn.metrics import silhouette_score
from sklearn.mixture import GaussianMixture
from sklearn.neighbors import NearestNeighbors
from sklearn.preprocessing import StandardScaler

app = FastAPI(title="Lune Analytics", version="0.1.0")


class ClusterPoint(BaseModel):
    satellite_id: int = Field(alias="satelliteId")
    name: str
    # Whatever the client compares satellites by (position x/y/z, orbital elements, ...), same order for every point.
    features: list[float] = Field(min_length=1)

    model_config = {"populate_by_name": True}


class ClusterRequest(BaseModel):
    algorithm: str = "kmeans"
    k: int | None = None
    # Spring/Jackson often sends explicit null for unused DTO fields.
    dbscan_eps: float | None = Field(default=None, alias="dbscanEps")
    dbscan_min_samples: int | None = Field(default=None, alias="dbscanMinSamples")
    isolation_contamination: float | None = Field(default=None, alias="isolationContamination")
    hdbscan_min_cluster_size: int | None = Field(default=None, alias="hdbscanMinClusterSize")
    points: list[ClusterPoint]

    model_config = {"populate_by_name": True}

    @field_validator("algorithm", mode="before")
    @classmethod
    def normalize_algorithm(cls, v) -> str:
        if v is None or (isinstance(v, str) and not v.strip()):
            return "kmeans"
        a = str(v).lower().strip().replace("-", "_")
        if a == "isolationforest":
            return "isolation_forest"
        if a in ("gaussian_mixture", "gaussianmixture"):
            return "gmm"
        return a


ALGORITHMS = ("kmeans", "dbscan", "hdbscan", "gmm", "isolation_forest")


def _scaled(points: list[ClusterPoint]) -> np.ndarray:
    """Standardise every feature (mean 0, std 1) so km and degrees weigh the same."""
    return StandardScaler().fit_transform(_feature_matrix(points))


def _feature_matrix(points: list[ClusterPoint]) -> np.ndarray:
    width = len(points[0].features)
    if any(len(p.features) != width for p in points):
        raise HTTPException(status_code=400, detail="Every point must have the same number of features")
    x = np.asarray([p.features for p in points], dtype=float)
    if not np.isfinite(x).all():
        raise HTTPException(status_code=400, detail="Features must be finite numbers")
    return x


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/cluster")
def cluster(req: ClusterRequest) -> dict:
    algo = req.algorithm
    if algo not in ALGORITHMS:
        raise HTTPException(
            status_code=400,
            detail=f"algorithm must be one of: {', '.join(ALGORITHMS)}",
        )

    n = len(req.points)
    if n < 2:
        raise HTTPException(status_code=400, detail="Need at least two points")

    x_scaled = _scaled(req.points)

    if algo in ("kmeans", "gmm"):
        k = req.k if req.k is not None else 5
        if k < 2:
            raise HTTPException(status_code=400, detail="k must be at least 2")
        if n < k:
            raise HTTPException(
                status_code=400,
                detail="Need at least as many points as clusters (k)",
            )

    if algo == "gmm":
        gmm = GaussianMixture(n_components=k, covariance_type="full", random_state=42)
        gmm.fit(x_scaled)
        proba = gmm.predict_proba(x_scaled)
        labels = [int(i) for i in proba.argmax(axis=1)]
        return {
            "labels": labels,
            "nClusters": k,
            "inertia": None,
            "algorithm": "gmm",
            "noiseCount": None,
            # How sure the model is of each satellite's group (highest membership probability).
            "confidence": [round(float(p), 3) for p in proba.max(axis=1)],
        }

    if algo == "hdbscan":
        size = 15 if req.hdbscan_min_cluster_size is None else int(req.hdbscan_min_cluster_size)
        size = min(max(2, size), n)
        labels_arr = HDBSCAN(min_cluster_size=size).fit_predict(x_scaled)
        labels = [int(i) for i in labels_arr]
        return {
            "labels": labels,
            "nClusters": len({i for i in labels if i != -1}),
            "inertia": None,
            "algorithm": "hdbscan",
            "noiseCount": sum(1 for i in labels if i == -1),
        }

    if algo == "kmeans":
        km = KMeans(n_clusters=k, random_state=42, n_init=10)
        labels_arr = km.fit_predict(x_scaled)
        labels = [int(i) for i in labels_arr]
        return {
            "labels": labels,
            "nClusters": k,
            "inertia": float(km.inertia_),
            "algorithm": "kmeans",
            "noiseCount": None,
        }

    if algo == "dbscan":
        eps = 0.4 if req.dbscan_eps is None else float(req.dbscan_eps)
        if not (0.05 <= eps <= 5.0):
            raise HTTPException(status_code=400, detail="dbscanEps must be between 0.05 and 5.0")
        ms_default = 5 if req.dbscan_min_samples is None else int(req.dbscan_min_samples)
        ms = min(max(1, ms_default), n, 10_000)
        db = DBSCAN(eps=eps, min_samples=ms)
        labels_arr = db.fit_predict(x_scaled)
        labels = [int(i) for i in labels_arr]
        noise = sum(1 for i in labels if i == -1)
        n_clusters = len({i for i in labels if i != -1})
        return {
            "labels": labels,
            "nClusters": n_clusters,
            "inertia": None,
            "algorithm": "dbscan",
            "noiseCount": noise,
        }

    # isolation_forest
    contamination = (
        0.06 if req.isolation_contamination is None else float(req.isolation_contamination)
    )
    if not (0.001 <= contamination <= 0.5):
        raise HTTPException(
            status_code=400,
            detail="isolationContamination must be between 0.001 and 0.5",
        )
    # sklearn expects enough expected outliers; nudge floor so tiny fleets still run
    eff_contamination = min(0.45, max(1.0 / n, contamination))
    iso = IsolationForest(
        n_estimators=200,
        contamination=eff_contamination,
        random_state=42,
    )
    labels_arr = iso.fit_predict(x_scaled)
    labels = [int(i) for i in labels_arr]
    noise = sum(1 for i in labels if i == -1)
    return {
        "labels": labels,
        "nClusters": 2,
        "inertia": None,
        "algorithm": "isolation_forest",
        "noiseCount": noise,
    }


class SweepRequest(BaseModel):
    """
    Helps choose a model's settings:
      kmeans / gmm: fit k = kMin..kMax and score each (silhouette; inertia for k-means, BIC for GMM)
      kdistance:    each point's distance to its minSamples-th neighbour, sorted, for picking DBSCAN's eps
    """

    kind: str
    points: list[ClusterPoint]
    k_min: int = Field(default=2, alias="kMin")
    k_max: int = Field(default=12, alias="kMax")
    min_samples: int = Field(default=5, alias="minSamples")

    model_config = {"populate_by_name": True}


# Silhouette compares every pair of points; scoring a sample keeps a 12k-satellite sweep to seconds.
SILHOUETTE_SAMPLE = 3000
KDISTANCE_CURVE_POINTS = 200


@app.post("/sweep")
def sweep(req: SweepRequest) -> dict:
    n = len(req.points)
    if n < 3:
        raise HTTPException(status_code=400, detail="Need at least three points")
    x_scaled = _scaled(req.points)

    if req.kind == "kdistance":
        return _kdistance(x_scaled, min(max(2, req.min_samples), n))

    if req.kind not in ("kmeans", "gmm"):
        raise HTTPException(status_code=400, detail="kind must be one of: kmeans, gmm, kdistance")
    k_min = max(2, req.k_min)
    k_max = min(req.k_max, n - 1, 20)
    if k_max < k_min:
        raise HTTPException(status_code=400, detail="Not enough points for that range of k")

    rows = []
    for k in range(k_min, k_max + 1):
        if req.kind == "kmeans":
            model = KMeans(n_clusters=k, random_state=42, n_init=3)
            labels = model.fit_predict(x_scaled)
            row = {"k": k, "inertia": float(model.inertia_)}
        else:
            model = GaussianMixture(n_components=k, covariance_type="full", random_state=42)
            labels = model.fit(x_scaled).predict(x_scaled)
            row = {"k": k, "bic": float(model.bic(x_scaled))}
        row["silhouette"] = _silhouette(x_scaled, labels)
        rows.append(row)

    scored = [r for r in rows if r["silhouette"] is not None]
    if req.kind == "gmm":
        suggested = min(rows, key=lambda r: r["bic"])["k"]
    else:
        suggested = max(scored, key=lambda r: r["silhouette"])["k"] if scored else k_min
    return {"kind": req.kind, "results": rows, "suggestedK": suggested}


def _silhouette(x: np.ndarray, labels: np.ndarray) -> float | None:
    if len(set(labels.tolist())) < 2:
        return None
    sample = min(len(x), SILHOUETTE_SAMPLE)
    return float(silhouette_score(x, labels, sample_size=sample, random_state=42))


def _kdistance(x: np.ndarray, min_samples: int) -> dict:
    # DBSCAN counts a point as its own neighbour, so the min_samples-th neighbour (self included) is what decides
    # whether a point is a core point.
    distances, _ = NearestNeighbors(n_neighbors=min_samples).fit(x).kneighbors(x)
    kth = np.sort(distances[:, -1])
    idx = np.unique(np.linspace(0, len(kth) - 1, min(KDISTANCE_CURVE_POINTS, len(kth))).astype(int))
    curve = kth[idx]
    return {
        "kind": "kdistance",
        "minSamples": min_samples,
        # Fraction of points (0..1) at or below each distance, for the x axis.
        "fractions": [round(float(i / (len(kth) - 1)), 4) for i in idx],
        "distances": [round(float(d), 4) for d in curve],
        "suggestedEps": round(float(_knee(curve)), 3),
    }


def _knee(curve: np.ndarray) -> float:
    """The bend of a rising curve: the point farthest from the straight line joining its ends."""
    if len(curve) < 3 or curve[-1] == curve[0]:
        return float(curve[len(curve) // 2])
    t = np.linspace(0, 1, len(curve))
    y = (curve - curve[0]) / (curve[-1] - curve[0])
    return float(curve[int(np.argmax(t - y))])


class ProjectRequest(BaseModel):
    points: list[ClusterPoint]


@app.post("/project")
def project(req: ProjectRequest) -> dict:
    """
    The model's view in two dimensions: standardise the features exactly as clustering does, then PCA.
    coords[i] is [pc1, pc2] for points[i]; loadings[c][f] is how much feature f makes up component c.
    """
    if len(req.points) < 3:
        raise HTTPException(status_code=400, detail="Need at least three points")
    x_scaled = _scaled(req.points)
    components = min(2, x_scaled.shape[1])
    pca = PCA(n_components=components, random_state=42)
    coords = pca.fit_transform(x_scaled)
    if components == 1:
        coords = np.column_stack([coords[:, 0], np.zeros(len(coords))])
    return {
        "coords": np.round(coords, 3).tolist(),
        "explainedVariance": [round(float(v), 4) for v in pca.explained_variance_ratio_],
        "loadings": np.round(pca.components_, 3).tolist(),
    }


class ConjunctionTle(BaseModel):
    satellite_id: int = Field(alias="satelliteId")
    name: str
    line1: str
    line2: str

    model_config = {"populate_by_name": True}


class ConjunctionRequest(BaseModel):
    """Close approaches between these satellites from startMs (UTC millis) over the next `hours`."""

    satellites: list[ConjunctionTle]
    start_ms: float = Field(alias="startMs")
    hours: float = 3.0
    threshold_km: float = Field(default=5.0, alias="thresholdKm")
    max_results: int = Field(default=50, alias="maxResults")

    model_config = {"populate_by_name": True}


# Positions every STEP_S seconds; a pair is a candidate if it's within threshold + the distance two satellites can
# close in half a step (relative speeds in low orbit reach ~15.5 km/s), then its closest moment is solved between steps.
STEP_S = 20.0
MAX_RELATIVE_SPEED_KM_S = 15.5
# Satellites flying in formation (a fresh launch's train, docked vehicles) stay close for hours: not an approach.
FORMATION_SPEED_KM_S = 0.5
CHUNK_STEPS = 30
# Candidates are kept a little beyond the threshold so the list isn't empty when nothing comes that close.
REPORT_MIN_KM = 25.0


@app.post("/conjunctions")
def conjunctions(req: ConjunctionRequest) -> dict:
    if not (0.25 <= req.hours <= 24):
        raise HTTPException(status_code=400, detail="hours must be between 0.25 and 24")
    if not (0.1 <= req.threshold_km <= 100):
        raise HTTPException(status_code=400, detail="thresholdKm must be between 0.1 and 100")
    sats = []
    for s in req.satellites:
        try:
            sats.append((s, Satrec.twoline2rv(s.line1, s.line2)))
        except Exception:  # malformed TLE: leave it out
            continue
    if len(sats) < 2:
        raise HTTPException(status_code=400, detail="Need at least two valid TLEs")

    array = SatrecArray([rec for _, rec in sats])
    n_steps = int(req.hours * 3600 / STEP_S) + 1
    screen_km = req.threshold_km + MAX_RELATIVE_SPEED_KM_S * STEP_S / 2
    keep_km = max(req.threshold_km * 4, REPORT_MIN_KM)

    # Best (closest) approach per pair across all steps.
    best: dict[tuple[int, int], tuple[float, float, float]] = {}
    formation_pairs: set[tuple[int, int]] = set()
    for chunk_start in range(0, n_steps, CHUNK_STEPS):
        steps = np.arange(chunk_start, min(n_steps, chunk_start + CHUNK_STEPS))
        jd, fr = _julian(req.start_ms + steps * STEP_S * 1000)
        err, r, v = array.sgp4(jd, fr)  # (sats, steps, 3) km and km/s, TEME
        for k, step in enumerate(steps):
            ok = (err[:, k] == 0) & np.isfinite(r[:, k]).all(axis=1)
            idx = np.flatnonzero(ok)
            if len(idx) < 2:
                continue
            pos = r[idx, k]
            pairs = cKDTree(pos).query_pairs(screen_km, output_type="ndarray")
            if len(pairs) == 0:
                continue
            i, j = idx[pairs[:, 0]], idx[pairs[:, 1]]
            dr = r[j, k] - r[i, k]
            dv = v[j, k] - v[i, k]
            speed2 = np.einsum("ij,ij->i", dv, dv)
            # Closest moment assuming straight-line relative motion, within half a step either side.
            t = np.clip(-np.einsum("ij,ij->i", dr, dv) / np.maximum(speed2, 1e-12), -STEP_S / 2, STEP_S / 2)
            dmin = np.linalg.norm(dr + dv * t[:, None], axis=1)
            speed = np.sqrt(speed2)
            slow = speed < FORMATION_SPEED_KM_S
            formation_pairs.update(zip(i[slow].tolist(), j[slow].tolist()))
            close = ~slow & (dmin <= keep_km)
            for a, b, d, tt, sp in zip(i[close].tolist(), j[close].tolist(), dmin[close], t[close], speed[close]):
                prev = best.get((a, b))
                if prev is None or d < prev[0]:
                    best[(a, b)] = (float(d), float(step * STEP_S + tt), float(sp))

    # Before the refinement below; straight-line estimates are within ~0.5 km of the refined distances.
    total_within = sum(1 for d, _, _ in best.values() if d <= req.threshold_km)
    ranked = sorted(best.items(), key=lambda kv: kv[1][0])[: max(1, min(req.max_results, 200))]
    results = []
    for (a, b), (d, t_s, speed) in ranked:
        d, t_s = _refine(sats[a][1], sats[b][1], req.start_ms, t_s, d)
        results.append(
            {
                "a": {"satelliteId": sats[a][0].satellite_id, "name": sats[a][0].name},
                "b": {"satelliteId": sats[b][0].satellite_id, "name": sats[b][0].name},
                "missKm": round(d, 3),
                "tcaMs": round(req.start_ms + t_s * 1000),
                "relativeSpeedKmS": round(speed, 3),
                "withinThreshold": d <= req.threshold_km,
            }
        )
    results.sort(key=lambda c: c["missKm"])
    return {
        "screened": len(sats),
        "hours": req.hours,
        "thresholdKm": req.threshold_km,
        "formationPairsSkipped": len(formation_pairs),
        "totalWithinThreshold": total_within,
        "approaches": results,
    }


def _julian(ms: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Unix millis → (whole Julian day, fraction), as sgp4 wants for precision."""
    jd = ms / 86_400_000.0 + 2440587.5
    whole = np.floor(jd)
    return whole, jd - whole


def _refine(a: Satrec, b: Satrec, start_ms: float, t_s: float, d: float) -> tuple[float, float]:
    """Re-propagate both satellites around the estimate (±STEP_S at 0.25 s) for the true closest moment."""
    offsets = np.arange(-STEP_S, STEP_S + 0.25, 0.25)
    jd, fr = _julian(start_ms + (t_s + offsets) * 1000)
    ea, ra, _ = a.sgp4_array(jd, fr)
    eb, rb, _ = b.sgp4_array(jd, fr)
    ok = (ea == 0) & (eb == 0)
    if not ok.any():
        return d, t_s
    dist = np.where(ok, np.linalg.norm(ra - rb, axis=1), np.inf)
    i = int(np.argmin(dist))
    return float(dist[i]), float(t_s + offsets[i])
