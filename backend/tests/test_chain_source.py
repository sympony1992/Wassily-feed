import asyncio
import time

import pytest
from conftest import CREATOR, PAIR, TOKEN, word

pytest.importorskip("httpx")

from wassily.chain.abi import NATIVE, SELECTORS, TOPICS, USDG, WETH, PoolLaunch  # noqa: E402
from wassily.chain.gecko import GeckoStats  # noqa: E402
from wassily.config.settings import load_config  # noqa: E402
from wassily.runtime.agent import Agent  # noqa: E402
from wassily.sources.chain import ChainSource, in_sample, launched_token  # noqa: E402

E18 = 10**18
CURVE = "0x" + "77" * 20
DEX_TOKEN = "0x" + "99" * 20
HOLDER_A, HOLDER_B = "0x" + "a1" * 20, "0x" + "b2" * 20
HEAD = 1_000_000
LAUNCH_BLOCK = HEAD - 200_000  # one block a second: about 55 hours ago


def abi_string(s: str) -> str:
    raw = s.encode()
    return "0x" + word(32) + word(len(raw)) + raw.ljust(32, b"\0").hex()


def test_backfill_sample_is_uniform_and_stable():
    addresses = [f"0x{i:040x}" for i in range(4000)]
    share = sum(in_sample(a, 0.5) for a in addresses) / len(addresses)
    assert 0.45 < share < 0.55
    assert [in_sample(a, 0.5) for a in addresses[:50]] == [in_sample(a, 0.5) for a in addresses[:50]]
    assert in_sample(TOKEN, 1) and not in_sample(TOKEN, 0)


def test_which_side_of_a_pool_is_the_launched_token():
    assert launched_token(PoolLaunch("v2", PAIR, WETH, TOKEN, 1)) == (TOKEN, WETH)
    assert launched_token(PoolLaunch("v3", PAIR, TOKEN, USDG, 1)) == (TOKEN, USDG)
    assert launched_token(PoolLaunch("v4", PAIR, NATIVE, TOKEN, 1)) == (TOKEN, WETH)
    assert launched_token(PoolLaunch("v2", PAIR, WETH, USDG, 1)) is None
    assert launched_token(PoolLaunch("v2", PAIR, TOKEN, DEX_TOKEN, 1)) is None
    assert launched_token(PoolLaunch("pons", CURVE, TOKEN, USDG, 1)) == (TOKEN, USDG)


class FakeRpc:
    def __init__(self):
        self.now = int(time.time())
        self.launch_logs = [
            {"topics": [TOPICS.pons_created, "0x" + word(TOKEN), "0x" + word(CURVE), "0x" + word(CREATOR)],
             "data": "0x" + word(NATIVE) + word(0) + word(0), "blockNumber": hex(LAUNCH_BLOCK), "address": "0xf"},
            {"topics": [TOPICS.v2_pair_created, "0x" + word(DEX_TOKEN), "0x" + word(WETH)],
             "data": "0x" + word(PAIR) + word(1), "blockNumber": hex(LAUNCH_BLOCK + 10), "address": "0xf"},
        ]
        self.trades = [
            {"address": CURVE, "blockNumber": hex(LAUNCH_BLOCK + 5), "topics": [TOPICS.pons_trade],
             "data": "0x" + word(E18 // 50) + word(1_000_000 * E18) + word(0) + word(0)},
        ]
        self.transfers = [
            {"topics": [TOPICS.transfer, "0x" + word(NATIVE), "0x" + word(HOLDER_A)], "data": "0x" + word(10 * E18)},
            {"topics": [TOPICS.transfer, "0x" + word(HOLDER_A), "0x" + word(HOLDER_B)], "data": "0x" + word(E18)},
        ]

    async def block_number(self):
        return HEAD

    async def timestamp(self, block):
        return self.now - (HEAD - block)

    async def block_at(self, seconds, head=None):
        return HEAD - (self.now - seconds)

    async def get_logs(self, from_block, to_block, address=None, topics=None):
        if topics and isinstance(topics[0], list):
            return [x for x in self.launch_logs if from_block <= int(x["blockNumber"], 16) <= to_block]
        if topics == [TOPICS.pons_trade]:
            return [x for x in self.trades if from_block <= int(x["blockNumber"], 16) <= to_block]
        return self.transfers if address == TOKEN else []

    async def eth_call(self, to, data, block="latest"):
        return {
            SELECTORS.name: abi_string("Bounded Coin" if to == TOKEN else "Paper Yak"),
            SELECTORS.symbol: abi_string("BND" if to == TOKEN else "PYAK"),
            SELECTORS.decimals: "0x" + word(18),
            SELECTORS.total_supply: "0x" + word(10**9 * E18),
        }[data]

    async def aclose(self):
        pass


class FakeGecko:
    stats = GeckoStats()

    def backlog_seconds(self):
        return 0.0

    async def hourly_closes(self, pool, token, before_sec, limit=1000):
        top = before_sec // 3600 * 3600
        return [(top - k * 3600, 3000.0) for k in range(limit)]

    async def top_pool(self, token):
        return None

    async def peak_price(self, pool, token, from_sec, to_sec):
        return 1e-6  # $1K cap on a billion tokens: below the $10K entry

    async def aclose(self):
        pass


def test_launches_are_discovered_measured_and_labelled():
    config = load_config({"DATA_SOURCE": "chain", "BACKFILL_DAYS": "0"})
    agent = Agent(source="chain")
    source = ChainSource(agent, config, None, rpc=FakeRpc(), gecko=FakeGecko())

    async def scenario():
        await source.init()
        source.cursor = LAUNCH_BLOCK - 1
        await source.live_tick()
        assert set(source.pending) == {TOKEN, DEX_TOKEN}
        await source.label_due()

    asyncio.run(scenario())

    token = agent.tokens[TOKEN]
    assert token.status == "passed" and token.peak_mc == 60_000
    assert token.name == "Bounded Coin" and token.holders == 2 and token.deployer == CREATOR
    assert DEX_TOKEN not in agent.tokens
    assert source.stats["below_entry"] == 1 and source.stats["labelled"] == 1
    assert not source.pending
    assert source.health()["ready"] and source.backfill() is None
