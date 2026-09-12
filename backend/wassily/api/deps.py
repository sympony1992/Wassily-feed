"""Request dependencies."""

from __future__ import annotations

from fastapi import HTTPException, Request

from wassily.runtime.runtime import Runtime


def get_runtime(request: Request) -> Runtime:
    runtime = getattr(request.app.state, "runtime", None)
    if runtime is None:
        raise HTTPException(status_code=503, detail="Connecting…")
    return runtime
