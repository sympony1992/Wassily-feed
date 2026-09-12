"""ERC-20 metadata read from the chain, cached per token."""

from __future__ import annotations

import asyncio
import re
from dataclasses import dataclass
from typing import Protocol

from wassily.chain.abi import SELECTORS, decode_string

_REVERTED = re.compile(r"revert|execution", re.IGNORECASE)


class EthCaller(Protocol):
    async def eth_call(self, to: str, data: str, block: int | str = "latest") -> str:
        ...


@dataclass(frozen=True)
class TokenInfo:
    name: str
    symbol: str
    decimals: int
    supply: float  # total supply in whole tokens


class TokenInfoCache:
    """None when the contract does not answer like a token. A failed read is retried, never cached."""

    def __init__(self, rpc: EthCaller) -> None:
        self._rpc = rpc
        self._cache: dict[str, asyncio.Task[TokenInfo | None]] = {}

    async def get(self, token: str) -> TokenInfo | None:
        key = token.lower()
        task = self._cache.get(key)
        if task is None:
            task = asyncio.ensure_future(self._read(key))
            self._cache[key] = task
            task.add_done_callback(lambda t, k=key: self._evict_failed(k, t))
        return await asyncio.shield(task)

    def _evict_failed(self, key: str, task: asyncio.Task[TokenInfo | None]) -> None:
        if task.cancelled() or task.exception() is not None:
            self._cache.pop(key, None)

    async def _call(self, token: str, data: str) -> str:
        try:
            return await self._rpc.eth_call(token, data)
        except Exception as err:
            if _REVERTED.search(str(err)):
                return "0x"
            raise

    async def _read(self, token: str) -> TokenInfo | None:
        name, symbol, decimals, supply = await asyncio.gather(
            self._call(token, SELECTORS.name),
            self._call(token, SELECTORS.symbol),
            self._call(token, SELECTORS.decimals),
            self._call(token, SELECTORS.total_supply),
        )
        if not supply or len(supply) < 66 or not decimals or len(decimals) < 66:
            return None
        places = int(decimals[:66], 16)
        if places > 36:
            return None
        return TokenInfo(
            name=decode_string(name),
            symbol=decode_string(symbol),
            decimals=places,
            supply=int(supply[:66], 16) / 10**places,
        )
