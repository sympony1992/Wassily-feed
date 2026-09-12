import math

from wassily.maths.auc import binormal_sample, bootstrap_auc_percentile, roc_auc
from wassily.maths.stats import rng_from_seed


def brute_force_auc(labels, scores):
    pos = [s for s, y in zip(scores, labels) if y == 1]
    neg = [s for s, y in zip(scores, labels) if y == 0]
    won = sum(1.0 if p > n else 0.5 if p == n else 0.0 for p in pos for n in neg)
    return won / (len(pos) * len(neg))


def test_perfect_and_inverted_rankings():
    assert roc_auc([0, 0, 1, 1], [0.1, 0.2, 0.8, 0.9]) == 1.0
    assert roc_auc([1, 1, 0, 0], [0.1, 0.2, 0.8, 0.9]) == 0.0


def test_ties_count_one_half():
    assert roc_auc([0, 1], [0.5, 0.5]) == 0.5
    assert roc_auc([0, 1, 1], [0.3, 0.3, 0.9]) == 0.75


def test_matches_brute_force_with_ties():
    rng = rng_from_seed(11)
    labels = [1 if rng() < 0.3 else 0 for _ in range(80)]
    scores = [round(rng(), 1) for _ in range(80)]  # rounding forces many ties
    assert math.isclose(roc_auc(labels, scores), brute_force_auc(labels, scores), rel_tol=1e-12)


def test_single_class_is_undefined():
    assert math.isnan(roc_auc([1, 1, 1], [0.1, 0.2, 0.3]))


def test_binormal_sample_hits_target_auc():
    labels, scores = binormal_sample(2000, 2000, 0.7, rng_from_seed(3))
    assert sum(labels) == 2000
    assert abs(roc_auc(labels, scores) - 0.7) < 0.02


def test_bootstrap_lower_sits_below_the_point_estimate():
    rng = rng_from_seed(5)
    labels, scores = binormal_sample(300, 700, 0.65, rng)
    point = roc_auc(labels, scores)
    lower = bootstrap_auc_percentile(labels, scores, rng, 200, 2.5)
    assert 0.55 < lower < point


def test_bootstrap_needs_ten_rows():
    assert bootstrap_auc_percentile([0, 1], [0.2, 0.8], rng_from_seed(1)) == 0.5
