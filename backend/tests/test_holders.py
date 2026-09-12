import asyncio

from conftest import TOKEN, word

from wassily.chain.abi import NATIVE, TOPICS
from wassily.chain.holders import holders_at

A, B, C = ("0x" + c * 40 for c in "abc")


def transfer(sender: str, receiver: str, value: int) -> dict:
    return {"topics": [TOPICS.transfer, "0x" + word(sender), "0x" + word(receiver)], "data": "0x" + word(value)}


class FakeRpc:
    def __init__(self, logs):
        self.logs = logs
        self.calls = []

    async def get_logs(self, from_block, to_block, address=None, topics=None):
        self.calls.append((from_block, to_block, address, topics))
        return self.logs


def test_holders_are_replayed_from_transfers():
    logs = [
        transfer(NATIVE, A, 100),  # mint
        transfer(A, B, 40),
        transfer(A, C, 60),  # A is empty now
        transfer(B, NATIVE, 40),  # burn: B is empty too
        {"topics": [TOPICS.transfer, "0x" + word(A), "0x" + word(B), "0x" + word(1)], "data": "0x"},  # ERC-721
    ]
    rpc = FakeRpc(logs)
    assert asyncio.run(holders_at(rpc, TOKEN, 10, 20)) == 1
    assert rpc.calls == [(10, 20, TOKEN, [TOPICS.transfer])]
