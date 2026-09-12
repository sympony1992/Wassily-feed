"""Wires configuration, persistence, the agent and a data source into one process."""

from __future__ import annotations

import time
from typing import Any

from wassily.config.settings import ServerConfig
from wassily.runtime.agent import Agent
from wassily.runtime.events import EventBus
from wassily.sources.base import Source
from wassily.store.persistence import Persistence
from wassily.utils.logging import get_logger
from wassily.utils.timeutil import iso

log = get_logger("runtime")


class Runtime:
    def __init__(self, config: ServerConfig, source: Source | None = None) -> None:
        self.config = config
        self.started_monotonic = time.monotonic()
        self.started_at = iso(time.time() * 1000)
        self.events = EventBus()
        self.persistence = Persistence(config.data_dir) if config.persist else None
        self.agent = Agent(
            config.persona,
            config.bound,
            config.cycle_seconds,
            events=self.events,
            persistence=self.persistence,
            source=config.source,
        )
        self.source = source or self._make_source()

    def _make_source(self) -> Source:
        if self.config.live:
            from wassily.sources.chain import ChainSource

            return ChainSource(self.agent, self.config, self.persistence)
        from wassily.sources.simulated import SimulatedSource

        return SimulatedSource(self.agent, self.config)

    async def start(self) -> None:
        snapshot = self.persistence.load() if self.persistence else None
        if snapshot:
            self.agent.restore(snapshot)
            log.info("restored %d tokens and %d runs from %s", len(self.agent.tokens), len(self.agent.runs),
                     self.persistence.state_file if self.persistence else "-")
        await self.source.start()
        self.agent.start()
        log.info("started: source=%s persona=%s bound=%s cycle=%ss", self.config.source, self.config.persona,
                 self.agent.bound.id, self.config.cycle_seconds)

    async def stop(self) -> None:
        await self.source.stop()
        await self.agent.stop()
        log.info("stopped")

    def uptime_seconds(self) -> int:
        return int(time.monotonic() - self.started_monotonic)

    def backfill(self) -> dict[str, Any] | None:
        return self.source.backfill()

    def health(self) -> dict[str, Any]:
        return {
            "ok": True,
            "source": self.config.source,
            "chain": self.config.chain,
            "started_at": self.started_at,
            "uptime_seconds": self.uptime_seconds(),
            "tokens": len(self.agent.tokens),
            "warmup": self.agent.warmup(),
            "ingest": self.source.health(),
            "subscribers": len(self.events),
        }
