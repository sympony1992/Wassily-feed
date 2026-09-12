import asyncio

import pytest

from wassily.chain.abi import USDG, WETH
from wassily.chain.prices import HOUR_S, NoUsdPrice, QuotePrices

BASE = 1_789_000_000 // HOUR_S * HOUR_S


class FakeGecko:
    def __init__(self, closes):
        self.closes = closes
        self.calls = 0

    async def hourly_closes(self, pool, token, before_sec, limit=1000):
        self.calls += 1
        return self.closes

    async def top_pool(self, token):
        return "0xpool"


def test_stablecoins_are_one_dollar():
    prices = QuotePrices(FakeGecko([]), lambda: BASE)
    assert asyncio.run(prices.usd_at(USDG, BASE)) == 1.0


def test_nearest_hourly_close_is_used_and_cached():
    gecko = FakeGecko([(BASE, 2500.0), (BASE - 3 * HOUR_S, 2400.0)])
    prices = QuotePrices(gecko, lambda: BASE + 10 * HOUR_S)

    async def scenario():
        first = await prices.usd_at(WETH, BASE + 1200)
        earlier = await prices.usd_at(WETH, BASE - 3 * HOUR_S + 60)
        return first, earlier

    assert asyncio.run(scenario()) == (2500.0, 2400.0)
    assert gecko.calls == 1


def test_no_honest_price_far_from_any_candle():
    prices = QuotePrices(FakeGecko([(BASE - 100 * HOUR_S, 2000.0)]), lambda: BASE + HOUR_S)
    with pytest.raises(NoUsdPrice):
        asyncio.run(prices.usd_at(WETH, BASE))
