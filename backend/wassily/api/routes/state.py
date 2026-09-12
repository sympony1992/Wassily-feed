from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends

from wassily.api.deps import get_runtime
from wassily.api.serialize import state_json
from wassily.runtime.runtime import Runtime

router = APIRouter(tags=["state"])


@router.get("/api/state")
def state(rt: Runtime = Depends(get_runtime)) -> dict[str, Any]:
    """Counters, warm-up, backfill progress, findings, the latest model and the 400 newest tokens."""
    return state_json(rt)
