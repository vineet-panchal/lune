"""Lightweight analytics API for Lune (orbital clustering & anomaly detection)."""

from __future__ import annotations

import numpy as np
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field, field_validator
from sklearn.cluster import DBSCAN, HDBSCAN, KMeans
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
