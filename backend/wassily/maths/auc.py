"""ROC-AUC as a U-statistic, with Efron's percentile bootstrap."""

from __future__ import annotations

import math
from collections.abc import Sequence

from wassily.maths.stats import Rng, gaussian, normal_inv, percentile_sorted


def sorted_order(scores: Sequence[float]) -> list[int]:
    return sorted(range(len(scores)), key=scores.__getitem__)


def _weighted_auc_from_order(
    order: Sequence[int],
    labels: Sequence[int],
    scores: Sequence[float],
    weights: Sequence[int] | None,
) -> float:
    """One linear pass over pre-sorted scores.

    ``weights`` are resample multiplicities (None = every row once), which lets
    a bootstrap skip re-sorting.
    """
    neg_below = 0.0
    pairs_won = 0.0
    total_pos = 0.0
    i = 0
    n = len(order)
    while i < n:
        j = i
        tie_pos = 0.0
        tie_neg = 0.0
        s = scores[order[i]]
        while j < n and scores[order[j]] == s:
            k = order[j]
            w = weights[k] if weights is not None else 1
            if labels[k] == 1:
                tie_pos += w
            else:
                tie_neg += w
            j += 1
        pairs_won += tie_pos * (neg_below + 0.5 * tie_neg)
        neg_below += tie_neg
        total_pos += tie_pos
        i = j
    pairs = total_pos * neg_below
    return pairs_won / pairs if pairs > 0 else math.nan


def roc_auc(labels: Sequence[int], scores: Sequence[float]) -> float:
    """Probability that a random positive scores above a random negative, ties counting one half."""
    return _weighted_auc_from_order(sorted_order(scores), labels, scores, None)


def bootstrap_auc_percentile(
    labels: Sequence[int],
    scores: Sequence[float],
    rng: Rng,
    resamples: int = 500,
    q: float = 2.5,
) -> float:
    """Resample rows with replacement ``resamples`` times and return the q-th percentile AUC."""
    n = len(labels)
    if n < 10:
        return 0.5
    order = sorted_order(scores)
    aucs: list[float] = []
    for _ in range(resamples):
        weights = [0] * n
        for _ in range(n):
            weights[int(rng() * n)] += 1
        a = _weighted_auc_from_order(order, labels, scores, weights)
        if not math.isnan(a):
            aucs.append(a)
    if not aucs:
        return 0.5
    aucs.sort()
    return percentile_sorted(aucs, q)


def binormal_sample(n_pos: int, n_neg: int, auc: float, rng: Rng) -> tuple[list[int], list[float]]:
    """Synthetic sample with a chosen true AUC: negatives ~ N(0,1), positives ~ N(d', 1), AUC = Phi(d'/sqrt 2)."""
    d_prime = math.sqrt(2) * normal_inv(min(0.9999, max(0.0001, auc)))
    labels: list[int] = []
    scores: list[float] = []
    for i in range(n_pos + n_neg):
        positive = i < n_pos
        labels.append(1 if positive else 0)
        scores.append(gaussian(rng) + (d_prime if positive else 0.0))
    return labels, scores
