"""Hourly USD prices of the quote assets tokens launch against: WETH, USDG and tokenized stocks."""

from __future__ import annotations

import time
from collections.abc import Callable
from typing import Protocol

from wassily.chain.abi import USDG, WETH
from wassily.utils.timeutil import iso

HOUR_S = 3600
NEAR_S = 6 * HOUR_S  # thin quote markets skip hours; a candle this close is used as is
FAR_S = 48 * HOUR_S  # beyond this there is no honest price for that hour

# The deepest USDG/WETH pool on the chain prices WETH.
REFERENCE_POOLS = {WETH: "0x52e65b17fb6e5ba00ed806f37afcd2daa50271ca"}
STABLES = frozenset({USDG})


class CandleSource(Protocol):
    async def hourly_closes(self, pool: str, token: str, before_sec: int, limit: int = 1000) -> list[tuple[int, float]]:
        ...

    async def top_pool(self, token: str) -> str | None:
        ...


class NoUsdPrice(LookupError):
    pass


def _nearest(series: dict[int, float], hour: int, within: int) -> float | None:
    for d in range(0, within + 1, HOUR_S):
        price = series.get(hour - d)
        if price is None:
            price = series.get(hour + d)
        if price is not None:
            return price
    return None


class QuotePrices:
    def __init__(self, gecko: CandleSource, now_seconds: Callable[[], float] = time.time) -> None:
        self._gecko = gecko
        self._now = now_seconds
        self._closes: dict[str, dict[int, float]] = {}
        self._covered: dict[str, list[tuple[int, int]]] = {}
        self._pools: dict[str, str | None] = {}

    async def usd_at(self, quote: str, seconds: float) -> float:
        q = quote.lower()
        if q in STABLES:
            return 1.0
        hour = int(seconds // HOUR_S) * HOUR_S
        series = self._closes.setdefault(q, {})

        price = _nearest(series, hour, NEAR_S)
        covered = self._covered.setdefault(q, [])
        if price is None and not any(lo <= hour <= hi for lo, hi in covered):
            pool = await self._pool_for(q)
            if not pool:
                raise NoUsdPrice(f"no USD market for quote {q}")
            until = int(min(self._now(), hour + 500 * HOUR_S))
            for t, close in await self._gecko.hourly_closes(pool, q, until, 1000):
                if close > 0:
                    series[t] = close
            covered.append((until - 999 * HOUR_S, until - HOUR_S))  # the newest hour is still open
            price = _nearest(series, hour, NEAR_S)
        if price is None:
            price = _nearest(series, hour, FAR_S)
        if price is None:
            raise NoUsdPrice(f"no USD price for {q} near {iso(hour * 1000)}")
        return price

    async def _pool_for(self, quote: str) -> str | None:
        if quote in self._pools:
            return self._pools[quote]
        pool = REFERENCE_POOLS.get(quote) or await self._gecko.top_pool(quote)
        self._pools[quote] = pool  # a failed lookup raises before this line and is retried next time
        return pool
