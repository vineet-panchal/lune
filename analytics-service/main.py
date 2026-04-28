"""Lightweight analytics API for Lune (k-means on orbital features)."""

from __future__ import annotations

import numpy as np
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from sklearn.cluster import KMeans
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
    k: int
    points: list[ClusterPoint]

    model_config = {"populate_by_name": True}


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/cluster")
def cluster(req: ClusterRequest) -> dict:
    if req.k < 2:
        raise HTTPException(status_code=400, detail="k must be at least 2")
    if len(req.points) < req.k:
        raise HTTPException(
            status_code=400,
            detail="Need at least as many points as clusters",
        )

    x = np.asarray(
        [
            [p.altitude_km, p.inclination_deg, p.mean_motion_rpd]
            for p in req.points
        ],
        dtype=float,
    )
    scaler = StandardScaler()
    x_scaled = scaler.fit_transform(x)

    km = KMeans(n_clusters=req.k, random_state=42, n_init=10)
    labels = km.fit_predict(x_scaled)
    return {
        "labels": [int(i) for i in labels],
        "nClusters": req.k,
        "inertia": float(km.inertia_),
    }
