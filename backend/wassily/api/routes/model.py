from __future__ import annotations

import time
from typing import Any

from fastapi import APIRouter, Depends, Query

from wassily.api.deps import get_runtime
from wassily.api.serialize import model_json
from wassily.runtime.runtime import Runtime
from wassily.utils.timeutil import DAY_MS, iso_to_ms

router = APIRouter(tags=["model"])


@router.get("/api/model/history")
def model_history(days: float = Query(30, gt=0, le=365), rt: Runtime = Depends(get_runtime)) -> dict[str, Any]:
    """Model runs over the last ``days`` days, oldest first."""
    since = time.time() * 1000 - days * DAY_MS
    runs = [r for r in rt.agent.runs if r.ran_at and iso_to_ms(r.ran_at) >= since]
    bound = rt.agent.bound
    return {"bound": bound.id, "days": days, "runs": [model_json(r, bound) for r in runs]}
