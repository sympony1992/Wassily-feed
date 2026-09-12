"""Minimal JSON-RPC client for Robinhood Chain.

Bounded concurrency, retries with backoff for rate limits and transient
failures, and log queries that split their block range only when the node says
the result is too large.
"""

from __future__ import annotations

import asyncio
from collections.abc import Callable, Sequence
from typing import Any

import httpx

from wassily.utils.logging import get_logger

log = get_logger("rpc")

Topics = Sequence[str | Sequence[str] | None]


class RpcError(Exception):
    def __init__(self, message: str, retryable: bool, timed_out: bool = False) -> None:
        super().__init__(message)
        self.retryable = retryable
        self.timed_out = timed_out


def _hex(n: int) -> str:
    return hex(n)


class RpcClient:
    def __init__(
        self,
        url: str,
        *,
        http: httpx.AsyncClient | None = None,
        concurrency: int = 3,
        retries: int = 6,
        timeout_s: float = 90.0,
        min_span: int = 50,
        on_split: Callable[[str], None] | None = None,
    ) -> None:
        self.url = url
        self._http = http or httpx.AsyncClient(headers={"content-type": "application/json"})
        self._owns_http = http is None
        self._slots = asyncio.Semaphore(concurrency)
        self._retries = retries
        self._timeout_s = timeout_s
        self._min_span = min_span
        self._on_split = on_split or log.info
        self._next_id = 0
        self._timestamps: dict[int, int] = {}

    async def aclose(self) -> None:
        if self._owns_http:
            await self._http.aclose()

    async def call(self, method: str, params: list[Any]) -> Any:
        attempt = 0
        while True:
            try:
                async with self._slots:
                    return await self._send(method, params)
            except RpcError as err:
                if not err.retryable or attempt >= self._retries:
                    raise
                await asyncio.sleep(min(30.0, 2.0**attempt))
                attempt += 1

    async def block_number(self) -> int:
        return int(await self.call("eth_blockNumber", []), 16)

    async def timestamp(self, block: int) -> int:
        """Block timestamp in seconds, cached: blocks never change once final."""
        cached = self._timestamps.get(block)
        if cached is not None:
            return cached
        b = await self.call("eth_getBlockByNumber", [_hex(block), False])
        if not b:
            raise RpcError(f"block {block} not found", retryable=False)
        ts = int(b["timestamp"], 16)
        self._timestamps[block] = ts
        return ts

    async def block_at(self, seconds: int, head: int | None = None) -> int:
        """The first block at or after ``seconds``, by binary search over timestamps."""
        lo = 1
        hi = head if head is not None else await self.block_number()
        if await self.timestamp(hi) < seconds:
            return hi
        while lo < hi:
            mid = (lo + hi) // 2
            if await self.timestamp(mid) < seconds:
                lo = mid + 1
            else:
                hi = mid
        return lo

    async def eth_call(self, to: str, data: str, block: int | str = "latest") -> str:
        tag = block if isinstance(block, str) else _hex(block)
        return await self.call("eth_call", [{"to": to, "data": data}, tag])

    async def get_logs(
        self,
        from_block: int,
        to_block: int,
        address: str | Sequence[str] | None = None,
        topics: Topics | None = None,
    ) -> list[dict[str, Any]]:
        flt: dict[str, Any] = {"fromBlock": _hex(from_block), "toBlock": _hex(to_block)}
        if address is not None:
            flt["address"] = address if isinstance(address, str) else list(address)
        if topics is not None:
            flt["topics"] = [t if t is None or isinstance(t, str) else list(t) for t in topics]
        try:
            return await self.call("eth_getLogs", [flt]) or []
        except RpcError as err:
            # Rate limits were already retried; a refusal ("exceeds limit") or a timeout means the range is too big.
            too_big = not err.retryable or err.timed_out
            if not too_big or to_block - from_block < self._min_span:
                raise
            mid = (from_block + to_block) // 2
            self._on_split(f"getLogs {from_block}-{to_block}: {str(err)[:100]}; splitting")
            left = await self.get_logs(from_block, mid, address, topics)
            right = await self.get_logs(mid + 1, to_block, address, topics)
            return left + right

    async def _send(self, method: str, params: list[Any]) -> Any:
        self._next_id += 1
        payload = {"jsonrpc": "2.0", "id": self._next_id, "method": method, "params": params}
        try:
            res = await self._http.post(self.url, json=payload, timeout=self._timeout_s)
        except httpx.TimeoutException as err:
            # A slow log query is split instead of retried.
            raise RpcError(f"{method}: timed out", retryable=method != "eth_getLogs", timed_out=True) from err
        except httpx.HTTPError as err:
            raise RpcError(f"{method}: {err}", retryable=True) from err

        if res.status_code == 429 or res.status_code >= 500:
            raise RpcError(f"{method} -> HTTP {res.status_code}", retryable=True)
        if res.status_code >= 400:
            raise RpcError(f"{method} -> HTTP {res.status_code}", retryable=False)
        body = res.json()
        if body.get("error"):
            raise RpcError(f"{method}: {body['error'].get('message', 'unknown error')}", retryable=False)
        return body.get("result")
