"""GeckoTerminal's public API (no key).

The free tier allows about 30 calls a minute, but a shared cloud IP often gets
less, so the pace adapts: it slows down on every 429 and creeps back up while
calls succeed.
"""

from __future__ import annotations

import asyncio
import time
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass, field
from typing import Any

import httpx

from wassily.utils.logging import get_logger

log = get_logger("gecko")

BATCH = 30  # the multi endpoints accept up to 30 addresses
MIN_PER_MINUTE = 4.0


class GeckoUnavailable(RuntimeError):
    """Unanswered is not the same as "no data": callers must retry later instead of drawing conclusions."""


@dataclass(frozen=True)
class GeckoPool:
    address: str  # as GeckoTerminal lists it: pair/pool address, or the v4 pool id
    dex: str
    created_at: str
    base_token: str
    quote_token: str
    name: str
    fdv_usd: float  # current fully diluted value of the base token


@dataclass(frozen=True)
class GeckoToken:
    address: str
    name: str
    symbol: str
    decimals: int
    supply: float  # normalized total supply
    image_url: str | None = None


@dataclass
class GeckoStats:
    calls: int = 0
    throttled: int = 0
    failed: int = 0
    per_minute: float = 0.0
    last_error: str | None = field(default=None)


def _strip_network(resource_id: str | None) -> str:
    rid = resource_id or ""
    return rid[rid.find("_") + 1 :].lower()


class GeckoClient:
    def __init__(
        self,
        network: str,
        *,
        api: str = "https://api.geckoterminal.com/api/v2",
        per_minute: float = 28,
        http: httpx.AsyncClient | None = None,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.network = network
        self.api = api.rstrip("/")
        self._http = http or httpx.AsyncClient(timeout=30.0, headers={"accept": "application/json"})
        self._owns_http = http is None
        self._sleep = sleep
        self._clock = clock
        self._ceiling = per_minute
        self._pace = per_minute
        self._next_at = 0.0
        self.stats = GeckoStats(per_minute=per_minute)

    async def aclose(self) -> None:
        if self._owns_http:
            await self._http.aclose()

    def backlog_seconds(self) -> float:
        """How long a call made now would wait for its turn."""
        return max(0.0, self._next_at - self._clock())

    async def _get(self, path: str) -> Any | None:
        url = f"{self.api}/networks/{self.network}{path}"
        for attempt in range(6):
            at = max(self._clock(), self._next_at)
            self._next_at = at + 60.0 / self._pace
            wait = at - self._clock()
            if wait > 0:
                await self._sleep(wait)
            self.stats.calls += 1
            try:
                res = await self._http.get(url)
                if res.status_code == 429:
                    self.stats.throttled += 1
                    self._pace = max(MIN_PER_MINUTE, self._pace * 0.7)
                    self._next_at = max(self._next_at, self._clock() + 10.0)
                    self.stats.per_minute = round(self._pace, 1)
                    continue
                self._pace = min(self._ceiling, self._pace + 0.2)
                self.stats.per_minute = round(self._pace, 1)
                if res.status_code == 404:
                    return None
                if res.status_code >= 400:
                    raise RuntimeError(f"HTTP {res.status_code}")
                return res.json()
            except (httpx.HTTPError, RuntimeError, ValueError) as err:
                self.stats.failed += 1
                self.stats.last_error = str(err)
                log.warning("geckoterminal %s: %s", path[:60], err)
                self._next_at = max(self._next_at, self._clock() + 5.0 * (attempt + 1))
        raise GeckoUnavailable(f"geckoterminal unavailable for {path[:60]}")

    async def pools(self, addresses: Sequence[str]) -> list[GeckoPool]:
        """The pools GeckoTerminal indexes among ``addresses``; pools it never saw are simply absent."""
        out: list[GeckoPool] = []
        for i in range(0, len(addresses), BATCH):
            body = await self._get(f"/pools/multi/{','.join(addresses[i : i + BATCH])}")
            for p in (body or {}).get("data") or []:
                a = p.get("attributes", {})
                rel = p.get("relationships") or {}
                out.append(
                    GeckoPool(
                        address=str(a.get("address", "")).lower(),
                        dex=((rel.get("dex") or {}).get("data") or {}).get("id", ""),
                        created_at=a.get("pool_created_at", ""),
                        base_token=_strip_network(((rel.get("base_token") or {}).get("data") or {}).get("id")),
                        quote_token=_strip_network(((rel.get("quote_token") or {}).get("data") or {}).get("id")),
                        name=a.get("name", ""),
                        fdv_usd=float(a.get("fdv_usd") or 0),
                    )
                )
        return out

    async def tokens(self, addresses: Sequence[str]) -> list[GeckoToken]:
        out: list[GeckoToken] = []
        for i in range(0, len(addresses), BATCH):
            body = await self._get(f"/tokens/multi/{','.join(addresses[i : i + BATCH])}")
            for t in (body or {}).get("data") or []:
                a = t.get("attributes", {})
                image = a.get("image_url")
                if not (isinstance(image, str) and image.startswith("https://") and "missing" not in image):
                    image = None
                out.append(
                    GeckoToken(
                        address=str(a.get("address", "")).lower(),
                        name=a.get("name", ""),
                        symbol=a.get("symbol", ""),
                        decimals=int(a.get("decimals") or 0),
                        supply=float(a.get("normalized_total_supply") or 0),
                        image_url=image,
                    )
                )
        return out

    async def _ohlcv(self, pool: str, token: str, before_sec: int, limit: int) -> list[list[float]]:
        body = await self._get(
            f"/pools/{pool}/ohlcv/hour?before_timestamp={before_sec}&limit={limit}&currency=usd&token={token}"
        )
        return ((((body or {}).get("data") or {}).get("attributes")) or {}).get("ohlcv_list") or []

    async def hourly_closes(self, pool: str, token: str, before_sec: int, limit: int = 1000) -> list[tuple[int, float]]:
        """Hourly USD closes of ``token`` in ``pool`` before ``before_sec``, as (unix seconds, close), newest first."""
        return [(int(c[0]), float(c[4])) for c in await self._ohlcv(pool, token, before_sec, limit)]

    async def top_pool(self, token: str) -> str | None:
        """The pool GeckoTerminal lists first for a token (its deepest market), or None."""
        body = await self._get(f"/tokens/{token}/pools?page=1")
        data = (body or {}).get("data") or []
        return str(data[0]["attributes"]["address"]).lower() if data else None

    async def peak_price(self, pool: str, token: str, from_sec: int, to_sec: int) -> float | None:
        """Highest hourly USD price of ``token`` in ``pool`` between two unix times, or None without trades."""
        hours = min(1000, -(-(to_sec - from_sec) // 3600) + 2)
        candles = [c for c in await self._ohlcv(pool, token, to_sec, hours) if from_sec - 3600 <= c[0] <= to_sec]
        if not candles:
            return None
        return max(float(c[2]) for c in candles)
