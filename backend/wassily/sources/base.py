"""The interface every token source implements."""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any


class Source(ABC):
    kind: str = "unknown"

    @abstractmethod
    async def start(self) -> None:
        """Begin feeding tokens into the agent. Must return promptly; long work runs in a task."""

    @abstractmethod
    async def stop(self) -> None:
        """Cancel background work and release clients."""

    def backfill(self) -> dict[str, Any] | None:
        """How far a history backfill has reached, or None when the source has no backfill."""
        return None

    def health(self) -> dict[str, Any]:
        return {"kind": self.kind}
