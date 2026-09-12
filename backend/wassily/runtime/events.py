"""In-process publish/subscribe for the Server-Sent Events stream.

Each subscriber gets a bounded queue. A subscriber that stops reading is
dropped rather than allowed to hold memory for the whole service.
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Any

from wassily.utils.logging import get_logger

log = get_logger("events")


@dataclass(frozen=True)
class Event:
    kind: str  # token | model | cycle | exclusion
    data: dict[str, Any]


class EventBus:
    def __init__(self, max_queue: int = 256) -> None:
        self._max_queue = max_queue
        self._subscribers: set[asyncio.Queue[Event]] = set()

    def __len__(self) -> int:
        return len(self._subscribers)

    def publish(self, kind: str, data: dict[str, Any]) -> None:
        event = Event(kind, data)
        for queue in list(self._subscribers):
            try:
                queue.put_nowait(event)
            except asyncio.QueueFull:
                self._subscribers.discard(queue)
                log.info("dropped a slow stream subscriber (%d left)", len(self._subscribers))

    @asynccontextmanager
    async def subscribe(self) -> AsyncIterator[asyncio.Queue[Event]]:
        queue: asyncio.Queue[Event] = asyncio.Queue(maxsize=self._max_queue)
        self._subscribers.add(queue)
        try:
            yield queue
        finally:
            self._subscribers.discard(queue)
