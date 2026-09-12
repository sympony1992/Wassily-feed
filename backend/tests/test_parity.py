"""Reference vectors produced by the TypeScript engine (src/math/stats.ts, src/engine/features.ts, src/math/sha256.ts).

If one of these fails, an idea cycle replayed in Python would no longer match what the site published.
Regenerate with ``node --experimental-strip-types`` against those files, never by copying Python output.
"""

import pytest

from wassily.engine.features import IdeaFeatures, featurize, fnv1a
from wassily.maths.commit import sha256_fields, sha256_hex
from wassily.maths.stats import rng_from_hex, rng_from_seed

TS_SEED_SEQUENCE = [0.006317789666354656, 0.7122717488091439, 0.6265160401817411, 0.5070839328691363,
                    0.4686517643276602]
TS_RUN_438_SEED = "18d37c950a3e810d9b9a84c72c230ca16b7cec19f7fb55c625e5441790d448ef"
TS_HEX_SEQUENCE = [0.657629732042551, 0.01921642431989312, 0.8047863775864244, 0.569986711954698,
                   0.32468353887088597]
TS_FEATURES = [
    -0.4999999999999997, -0.8660254037844388, 0, 0, 0, 0, 1, 0, 0, 5.666426688112432, 10, 0, 2,
    0.2886751345948129, 0, 0, -0.2886751345948129, 0, -0.2886751345948129, 0, 0.2886751345948129,
    -0.2886751345948129, 0.2886751345948129, -0.5773502691896258, 0, 0, -0.2886751345948129, 0.2886751345948129,
]


def test_sfc32_from_seed_is_bit_exact():
    rng = rng_from_seed(20_260_911 ^ 438)
    assert [rng() for _ in range(5)] == TS_SEED_SEQUENCE


def test_cycle_seed_and_sequence_are_bit_exact():
    assert sha256_hex("438") == TS_RUN_438_SEED
    rng = rng_from_hex(TS_RUN_438_SEED)
    assert [rng() for _ in range(5)] == TS_HEX_SEQUENCE


def test_fnv1a_matches_char_code_hashing():
    assert fnv1a("moon") == 4052004416
    assert fnv1a("patient") == 2163104094
    assert fnv1a("café") == 856211068


def test_feature_vector_matches():
    x = featurize(IdeaFeatures(name="Quiet Otter", lore="The quiet otter keeps a diary. Every entry says hold.",
                               hour=14, dow=4, holders=288))
    assert x == pytest.approx(TS_FEATURES, rel=1e-12, abs=1e-15)


def test_commitment_encoding_matches():
    assert sha256_fields(["Honest Mean", "No claims, only concentration.", "14", "438"]) == (
        "302f03a0251769cab17f79d34bc674486e3c0af07bef0029e3f490e4c94d3c33"
    )
    assert sha256_hex("x") == "2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881"
