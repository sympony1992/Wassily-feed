"""Event topics and ABI decoding for the pool launches this agent watches on Robinhood Chain."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

WETH = "0x0bd7d308f8e1639fab988df18a8011f41eacad73"
USDG = "0x5fc5360d0400a0fd4f2af552add042d716f1d168"  # dollar stablecoin
NATIVE = "0x0000000000000000000000000000000000000000"  # Uniswap v4 uses the zero address for ETH


class TOPICS:
    transfer = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"
    # Uniswap v2-style factories: PairCreated(address indexed token0, address indexed token1, address pair, uint256)
    v2_pair_created = "0x0d3648bd0f6ba80134a33ba9275ac585d9d315f0ad8355cddefde31afa28d0e9"
    # Uniswap v3-style factories: PoolCreated(token0 indexed, token1 indexed, uint24 indexed fee, int24, address pool)
    v3_pool_created = "0x783cca1c0412dd0d695e784568c96da2e9c22ff989357a2e8b1d9b2b4e6b7118"
    # Uniswap v4 PoolManager: Initialize(bytes32 indexed id, currency0 indexed, currency1 indexed, ...)
    v4_initialize = "0xdd466e674ea557f56295e2d0218a125ea4b4f0f6f3307b95f85e6110838d6438"
    # Pons launchpad factory: (token indexed, curve indexed, creator indexed; quote (zero = WETH), uint256, uint256)
    pons_created = "0x8d4aad4953d0ca700d468f3753aa14432d1b35b43ec6409f051fb6aa43a89607"
    # Pons curve trade, emitted by the curve: (uint256 quoteAmount, uint256 tokenAmount, uint256 fee, uint256 creatorFee)
    pons_trade = "0xec36bf571f136799e8dc0b0b8bea4b04d8bd3d43de838aab0d5fc21d4cbfc455"


LAUNCH_TOPICS = (TOPICS.v2_pair_created, TOPICS.v3_pool_created, TOPICS.v4_initialize, TOPICS.pons_created)

PoolKind = Literal["v2", "v3", "v4", "pons"]


@dataclass(frozen=True)
class PoolLaunch:
    kind: PoolKind
    pool: str  # pair or pool address; for v4 the 32-byte pool id
    token_a: str
    token_b: str  # for Pons launches: the quote asset
    block: int
    creator: str | None = None


def topic_address(topic: str) -> str:
    return f"0x{topic[26:]}".lower()


def word_address(data: str, index: int) -> str:
    """The address stored in ABI word ``index`` of ``data``."""
    start = 2 + index * 64
    return f"0x{data[start + 24 : start + 64]}".lower()


def decode_launch(log: dict[str, Any]) -> PoolLaunch | None:
    """Decode one launch log, or None if it is not one of LAUNCH_TOPICS."""
    topics: list[str] = log.get("topics") or []
    if not topics:
        return None
    block = int(log["blockNumber"], 16)
    data: str = log.get("data", "0x")
    topic = topics[0]
    t = topics + [""] * (4 - len(topics))

    if topic == TOPICS.v2_pair_created:
        return PoolLaunch("v2", word_address(data, 0), topic_address(t[1]), topic_address(t[2]), block)
    if topic == TOPICS.v3_pool_created:
        return PoolLaunch("v3", word_address(data, 1), topic_address(t[1]), topic_address(t[2]), block)
    if topic == TOPICS.v4_initialize:
        return PoolLaunch("v4", t[1].lower(), topic_address(t[2]), topic_address(t[3]), block)
    if topic == TOPICS.pons_created:
        quote = word_address(data, 0) if len(data) >= 66 else NATIVE
        return PoolLaunch("pons", topic_address(t[2]), topic_address(t[1]), WETH if quote == NATIVE else quote, block,
                          creator=topic_address(t[3]))
    return None


class SELECTORS:
    name = "0x06fdde03"
    symbol = "0x95d89b41"
    decimals = "0x313ce567"
    total_supply = "0x18160ddd"


def decode_string(data: str) -> str:
    """ABI ``string`` return data, or a right-padded bytes32 as older tokens use."""
    body = data[2:] if data.startswith("0x") else data
    if not body:
        return ""
    raw = bytes.fromhex(body)
    if len(raw) >= 96:
        offset = int.from_bytes(raw[0:32], "big")
        if offset == 32:
            length = int.from_bytes(raw[32:64], "big")
            if length <= len(raw) - 64:
                return raw[64 : 64 + length].decode("utf-8", errors="replace").replace("\0", "").strip()
    return raw[:32].decode("utf-8", errors="replace").replace("\0", "").strip()


def uint_word(data: str, index: int = 0) -> int:
    start = 2 + index * 64
    return int(data[start : start + 64] or "0", 16)
