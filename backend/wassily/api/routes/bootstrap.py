from __future__ import annotations

from functools import lru_cache
from typing import Any

from fastapi import APIRouter, Query

from wassily.config.site import SITE
from wassily.maths.auc import binormal_sample, bootstrap_auc_percentile
from wassily.maths.stats import rng_from_seed

router = APIRouter(tags=["proof panel"])

RESAMPLES = 200


@lru_cache(maxsize=512)
def bootstrap_floor(n: int, n_pos: int, auc: float) -> float:
    """2.5th percentile of bootstrap AUCs on a binormal sample with the requested evidence."""
    rng = rng_from_seed(n * 31 + n_pos * 7 + int(auc * 1000))
    labels, scores = binormal_sample(n_pos, n - n_pos, auc, rng)
    return bootstrap_auc_percentile(labels, scores, rng, RESAMPLES, 2.5)


@router.get("/api/bootstrap")
def bootstrap(
    n: int = Query(2000, ge=SITE.cv_folds * 4, le=24_000),
    npos: int = Query(200, ge=1),
    auc: float = Query(0.6, ge=0.5, le=0.99),
) -> dict[str, Any]:
    """Bootstrap floor for the proof-panel sliders. Values are rounded so the cache stays warm."""
    n_pos = max(1, min(npos, n - 1))
    auc = round(auc, 3)
    lower = bootstrap_floor(n, n_pos, auc)
    return {"n": n, "n_positive": n_pos, "auc": auc, "resamples": RESAMPLES, "boot_lower": round(lower, 4)}
