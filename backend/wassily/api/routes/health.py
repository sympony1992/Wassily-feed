from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends

from wassily.api.deps import get_runtime
from wassily.runtime.runtime import Runtime

router = APIRouter(tags=["health"])


@router.get("/api/health")
def health(rt: Runtime = Depends(get_runtime)) -> dict[str, Any]:
    """Source, token count, warm-up and ingest stats."""
    return rt.health()
