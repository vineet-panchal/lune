"""Lightweight analytics API for Lune (orbital clustering & anomaly detection)."""

from __future__ import annotations

import numpy as np
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field, field_validator
from sklearn.cluster import DBSCAN, KMeans
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler

app = FastAPI(title="Lune Analytics", version="0.1.0")


class ClusterPoint(BaseModel):
    satellite_id: int = Field(alias="satelliteId")
    name: str
    altitude_km: float = Field(alias="altitudeKm")
    inclination_deg: float = Field(alias="inclinationDeg")
    mean_motion_rpd: float = Field(alias="meanMotionRpd")

    model_config = {"populate_by_name": True}


class ClusterRequest(BaseModel):
    algorithm: str = "kmeans"
    k: int | None = None
    # Spring/Jackson often sends explicit null for unused DTO fields.
    dbscan_eps: float | None = Field(default=None, alias="dbscanEps")
    dbscan_min_samples: int | None = Field(default=None, alias="dbscanMinSamples")
    isolation_contamination: float | None = Field(default=None, alias="isolationContamination")
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
        return a


def _feature_matrix(points: list[ClusterPoint]) -> np.ndarray:
    return np.asarray(
        [
            [p.altitude_km, p.inclination_deg, p.mean_motion_rpd]
            for p in points
        ],
        dtype=float,
    )


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/cluster")
def cluster(req: ClusterRequest) -> dict:
    algo = req.algorithm
    if algo not in ("kmeans", "dbscan", "isolation_forest"):
        raise HTTPException(
            status_code=400,
            detail="algorithm must be one of: kmeans, dbscan, isolation_forest",
        )

    n = len(req.points)
    if n < 2:
        raise HTTPException(status_code=400, detail="Need at least two points")

    x = _feature_matrix(req.points)
    scaler = StandardScaler()
    x_scaled = scaler.fit_transform(x)

    if algo == "kmeans":
        k = req.k if req.k is not None else 5
        if k < 2:
            raise HTTPException(status_code=400, detail="k must be at least 2")
        if n < k:
            raise HTTPException(
                status_code=400,
                detail="Need at least as many points as clusters (k)",
            )
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
