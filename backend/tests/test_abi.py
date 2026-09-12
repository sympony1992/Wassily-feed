from conftest import CREATOR, PAIR, TOKEN, word

from wassily.chain.abi import NATIVE, TOPICS, USDG, WETH, decode_launch, decode_string, topic_address, uint_word


def abi_string(s: str) -> str:
    raw = s.encode()
    return "0x" + word(32) + word(len(raw)) + raw.ljust(32, b"\0").hex()


def test_topic_address():
    assert topic_address("0x" + word(TOKEN)) == TOKEN


def test_v2_pair_created():
    log = {"topics": [TOPICS.v2_pair_created, "0x" + word(TOKEN), "0x" + word(WETH)],
           "data": "0x" + word(PAIR) + word(1), "blockNumber": "0x10"}
    launch = decode_launch(log)
    assert (launch.kind, launch.pool, launch.token_a, launch.token_b, launch.block) == ("v2", PAIR, TOKEN, WETH, 16)


def test_v3_pool_is_the_second_data_word():
    log = {"topics": [TOPICS.v3_pool_created, "0x" + word(USDG), "0x" + word(TOKEN), "0x" + word(3000)],
           "data": "0x" + word(60) + word(PAIR), "blockNumber": "0x1"}
    launch = decode_launch(log)
    assert (launch.kind, launch.pool, launch.token_a, launch.token_b) == ("v3", PAIR, USDG, TOKEN)


def test_v4_uses_the_pool_id():
    pool_id = "0x" + "12" * 32
    log = {"topics": [TOPICS.v4_initialize, pool_id, "0x" + word(NATIVE), "0x" + word(TOKEN)],
           "data": "0x" + word(3000), "blockNumber": "0x2"}
    launch = decode_launch(log)
    assert (launch.kind, launch.pool, launch.token_a, launch.token_b) == ("v4", pool_id, NATIVE, TOKEN)


def test_pons_zero_quote_means_weth():
    curve = "0x" + "77" * 20
    log = {"topics": [TOPICS.pons_created, "0x" + word(TOKEN), "0x" + word(curve), "0x" + word(CREATOR)],
           "data": "0x" + word(NATIVE) + word(0) + word(0), "blockNumber": "0x3"}
    launch = decode_launch(log)
    assert (launch.kind, launch.pool, launch.token_a, launch.token_b, launch.creator) == (
        "pons", curve, TOKEN, WETH, CREATOR)


def test_unknown_topics_are_ignored():
    assert decode_launch({"topics": [TOPICS.transfer], "data": "0x", "blockNumber": "0x1"}) is None
    assert decode_launch({"topics": [], "data": "0x", "blockNumber": "0x1"}) is None


def test_decode_abi_string_and_bytes32():
    assert decode_string(abi_string("Wassily")) == "Wassily"
    assert decode_string("0x" + b"MKR".ljust(32, b"\0").hex()) == "MKR"
    assert decode_string("0x") == ""


def test_uint_word():
    assert uint_word("0x" + word(18) + word(7), 1) == 7
