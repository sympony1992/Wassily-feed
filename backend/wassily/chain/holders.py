"""Holder count replayed from ERC-20 Transfer events."""

from __future__ import annotations

from typing import Any, Protocol

from wassily.chain.abi import NATIVE, TOPICS, topic_address


class LogReader(Protocol):
    async def get_logs(self, from_block: int, to_block: int, address: Any = None, topics: Any = None) -> list[dict]:
        ...


def replay_balances(logs: list[dict[str, Any]]) -> dict[str, int]:
    balances: dict[str, int] = {}
    for entry in logs:
        topics = entry.get("topics") or []
        data = entry.get("data", "0x")
        if len(topics) != 3 or len(data) < 66:
            continue  # ERC-721 transfers index the id instead
        value = int(data[2:66], 16)
        sender = topic_address(topics[1])
        receiver = topic_address(topics[2])
        if sender != NATIVE:
            balances[sender] = balances.get(sender, 0) - value
        if receiver != NATIVE:
            balances[receiver] = balances.get(receiver, 0) + value
    return balances


async def holders_at(rpc: LogReader, token: str, from_block: int, to_block: int) -> int:
    """Addresses with a positive balance at ``to_block``. Pools and contracts count, as on a block explorer."""
    logs = await rpc.get_logs(from_block, to_block, token, [TOPICS.transfer])
    return sum(1 for balance in replay_balances(logs).values() if balance > 0)
