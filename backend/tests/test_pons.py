import asyncio

import pytest
from conftest import TOKEN, word

from wassily.chain.abi import TOPICS, WETH
from wassily.chain.pons import PonsCurve, pons_peaks, trade_price
from wassily.chain.tokens import TokenInfo

CURVE = "0x" + "77" * 20
E18 = 10**18


def trade(block: int, quote_wei: int, token_wei: int, curve: str = CURVE) -> dict:
    return {"address": curve, "blockNumber": hex(block), "topics": [TOPICS.pons_trade],
            "data": "0x" + word(quote_wei) + word(token_wei) + word(0) + word(0)}


def test_trade_price():
    assert trade_price(trade(1, E18, 1_000_000 * E18)["data"], 18, 18) == pytest.approx(1e-6)
    assert trade_price(trade(1, E18, 0)["data"], 18, 18) is None
    assert trade_price("0x1234", 18, 18) is None


class FakeRpc:
    def __init__(self, logs):
        self.logs = logs

    async def get_logs(self, from_block, to_block, address=None, topics=None):
        return [x for x in self.logs if from_block <= int(x["blockNumber"], 16) <= to_block]


class FakePrices:
    async def usd_at(self, quote, seconds):
        return 3000.0


class FakeTokens:
    async def get(self, token):
        return TokenInfo(name="Bounded Coin", symbol="BND", decimals=18, supply=1e9)


def test_peak_is_the_highest_usd_trade_inside_the_window():
    logs = [
        trade(110, E18 // 100, 1_000_000 * E18),  # 1e-8 WETH
        trade(120, E18 // 50, 1_000_000 * E18),  # 2e-8 WETH: the peak
        trade(151, E18, 1_000_000 * E18),  # outside the 50-block window
    ]
    peaks = asyncio.run(pons_peaks(FakeRpc(logs), FakePrices(), FakeTokens(), [PonsCurve(TOKEN, CURVE, WETH, 100)],
                                   window_blocks=50, head=200, seconds_at=float))
    assert peaks[TOKEN].trades == 2
    assert peaks[TOKEN].peak_price == pytest.approx(2e-8 * 3000)
