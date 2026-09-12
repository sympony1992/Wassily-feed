"""Simulated market, labelled SIMULATED everywhere it is shown."""

from __future__ import annotations

import asyncio
import contextlib
from datetime import timezone
from typing import TYPE_CHECKING, Any

from wassily.engine.simulator import Market
from wassily.sources.base import Source
from wassily.utils.logging import get_logger
from wassily.utils.timeutil import now_ms, utc_from_ms

if TYPE_CHECKING:
    from wassily.config.settings import ServerConfig
    from wassily.runtime.agent import Agent

log = get_logger("simulated")

# Now and then a copycat deploys one of the current top ideas, so the theft record has something to show.
COPYCAT_CHANCE = 0.04
COPYCAT_TOP = 10


class SimulatedSource(Source):
    kind = "simulated"

    def __init__(self, agent: Agent, config: ServerConfig, market: Market | None = None) -> None:
        self.agent = agent
        self.config = config
        self.market = market or Market()
        self.arrivals = 0
        self.copycats = 0
        self._task: asyncio.Task[None] | None = None

    async def start(self) -> None:
        if not self.agent.tokens:
            await self._seed()
        self._task = asyncio.create_task(self._arrival_loop(), name="simulated-arrivals")

    async def _seed(self) -> None:
        now = now_ms()
        for token in self.market.history(self.config.seed_tokens, now):
            self.agent.upsert(token, announce=False)
        # Replay a few earlier cycles so the Brain page opens with history; only the last one is fully validated.
        prior = max(1, self.config.prior_cycles)
        for i in range(prior):
            at = utc_from_ms(now - (prior - 1 - i) * self.config.cycle_seconds * 1000).astimezone(timezone.utc)
            await self.agent.retrain(at=at, quick=i < prior - 1)
        log.info("seeded %d simulated tokens and %d cycles", len(self.agent.tokens), prior)

    async def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task
            self._task = None

    async def _arrival_loop(self) -> None:
        lo, hi = self.config.arrival_ms
        while True:
            await asyncio.sleep((lo + self.market.rng() * (hi - lo)) / 1000)
            name = None
            current = self.agent.ledger().current
            if current and current.candidates and self.market.chance(COPYCAT_CHANCE):
                top = current.candidates[: min(COPYCAT_TOP, len(current.candidates))]
                name = top[int(self.market.rng() * len(top))].name
                self.copycats += 1
            self.agent.upsert(self.market.arrival(now_ms(), name))
            self.arrivals += 1

    def health(self) -> dict[str, Any]:
        return {"kind": self.kind, "arrivals": self.arrivals, "copycats": self.copycats}
