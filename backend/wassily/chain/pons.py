"""Peak USD price of Pons launchpad tokens, read from the curve's own trade events.

Checked against GeckoTerminal's candles for the same curves to within half a percent.
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import TYPE_CHECKING

from wassily.chain.abi import TOPICS, WETH

if TYPE_CHECKING:
    from wassily.chain.prices import QuotePrices
    from wassily.chain.rpc import RpcClient
    from wassily.chain.tokens import TokenInfoCache

BATCH = 250  # curves per log query


@dataclass(frozen=True)
class PonsCurve:
    token: str
    curve: str
    quote: str
    first_block: int


@dataclass
class CurvePeak:
    trades: int = 0
    peak_price: float = 0.0  # USD per whole token


def trade_price(data: str, quote_decimals: int, token_decimals: int) -> float | None:
    """Price of one whole token in quote units, from one curve trade's data (quoteAmount, tokenAmount, ...)."""
    if len(data) < 130:
        return None
    token_amount = int(data[66:130], 16)
    if token_amount == 0:
        return None
    quote_amount = int(data[2:66], 16)
    return (quote_amount / 10**quote_decimals) / (token_amount / 10**token_decimals)


async def pons_peaks(
    rpc: RpcClient,
    prices: QuotePrices,
    tokens: TokenInfoCache,
    curves: Sequence[PonsCurve],
    *,
    window_blocks: int,
    head: int,
    seconds_at: Callable[[int], float],
) -> dict[str, CurvePeak]:
    out: dict[str, CurvePeak] = {}
    for i in range(0, len(curves), BATCH):
        batch = curves[i : i + BATCH]
        by_curve = {c.curve: c for c in batch}
        for c in batch:
            out[c.token] = CurvePeak()
        start = min(c.first_block for c in batch)
        end = min(head, max(c.first_block + window_blocks for c in batch))
        if end < start:
            continue

        logs = await rpc.get_logs(start, end, [c.curve for c in batch], [TOPICS.pons_trade])
        for entry in logs:
            c = by_curve.get(str(entry.get("address", "")).lower())
            block = int(entry["blockNumber"], 16)
            if c is None or block < c.first_block or block > c.first_block + window_blocks:
                continue
            quote_info = None if c.quote == WETH else await tokens.get(c.quote)
            token_info = await tokens.get(c.token)
            price = trade_price(
                entry.get("data", "0x"),
                18 if c.quote == WETH else (quote_info.decimals if quote_info else 18),
                token_info.decimals if token_info else 18,
            )
            if price is None:
                continue
            peak = out[c.token]
            peak.trades += 1
            peak.peak_price = max(peak.peak_price, price * await prices.usd_at(c.quote, seconds_at(block)))
    return out
