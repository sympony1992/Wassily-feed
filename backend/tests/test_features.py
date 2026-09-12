import math

from wassily.engine.features import (
    D,
    FEATURE_GROUPS,
    FEATURE_NAMES,
    IdeaFeatures,
    featurize,
    fnv1a,
    grouped_importance,
)


def test_width_is_28():
    assert D == len(FEATURE_NAMES) == 28
    assert FEATURE_NAMES[9] == "holders_log" and FEATURE_NAMES[-1] == "lore_hash_15"


def test_hour_weekday_and_shape_columns():
    x = featurize(IdeaFeatures(name="Honest  Mean", lore="", hour=6, dow=3, holders=0))
    assert math.isclose(x[0], 1.0) and abs(x[1]) < 1e-12  # 06:00 is a quarter of the way round
    assert x[2:9] == [0, 0, 0, 1, 0, 0, 0]
    assert x[9] == 0 and x[10] == 0 and x[11] == 0
    assert x[12] == 2
    assert x[13:] == [0.0] * 15


def test_lore_words_hash_to_a_unit_vector():
    x = featurize(IdeaFeatures(name="Tail Guard", lore="The tail gets thinner the longer you wait.", hour=0, dow=0,
                               holders=288))
    assert x[10] == 8
    assert math.isclose(math.sqrt(sum(v * v for v in x[13:])), 1.0)
    assert math.isclose(x[9], math.log1p(288))


def test_fnv1a_reference_vectors():
    assert fnv1a("") == 0x811C9DC5
    assert fnv1a("a") == 0xE40C292C
    assert fnv1a("foobar") == 0xBF9CF968


def test_grouped_importance_keeps_the_total():
    importance = {name: 1 / D for name in FEATURE_NAMES}
    grouped = grouped_importance(importance)
    assert set(grouped) == {key for key, _ in FEATURE_GROUPS}
    assert math.isclose(sum(grouped.values()), 1.0)
    assert math.isclose(grouped["dow"], 7 / D)
