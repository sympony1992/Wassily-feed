from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator
from typing import Any

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse

from wassily.api.deps import get_runtime
from wassily.api.serialize import model_json, token_json
from wassily.runtime.events import Event
from wassily.runtime.runtime import Runtime

router = APIRouter(tags=["stream"])

HEARTBEAT_SECONDS = 15.0


def format_event(event: Event, rt: Runtime) -> dict[str, Any] | None:
    """``{token, counters}`` per token and ``{model, counters}`` per retrain. Other events stay internal."""
    if event.kind == "token":
        return {"token": token_json(event.data["token"], rt.config.chain), "counters": event.data["counters"]}
    if event.kind == "model":
        return {"model": model_json(event.data["run"], rt.agent.bound), "counters": event.data["counters"]}
    return None


@router.get("/api/stream")
async def stream(request: Request, rt: Runtime = Depends(get_runtime)) -> StreamingResponse:
    async def events() -> AsyncIterator[str]:
        yield "retry: 5000\n\n"
        async with rt.events.subscribe() as queue:
            while not await request.is_disconnected():
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=HEARTBEAT_SECONDS)
                except asyncio.TimeoutError:
                    yield ": ping\n\n"
                    continue
                payload = format_event(event, rt)
                if payload is not None:
                    yield f"data: {json.dumps(payload, separators=(',', ':'), ensure_ascii=False)}\n\n"

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"cache-control": "no-cache, no-transform", "x-accel-buffering": "no", "connection": "keep-alive"},
    )
