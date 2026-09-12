"""One retrain: fit on everything, then check the fit three ways.

1. k-fold stratified cross-validation, so every token is scored by a model that never saw it;
2. a train-on-past, test-on-future split, as a leakage check;
3. Efron's bootstrap over the out-of-fold predictions.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass

from wassily.engine.features import D, FEATURE_NAMES, featurize
from wassily.engine.model import fit_logistic, predict_proba, stratified_folds
from wassily.engine.types import ModelRun, ScoringModel, TrainingRow
from wassily.maths.auc import bootstrap_auc_percentile, roc_auc
from wassily.maths.stats import mean, median, rng_from_seed, std

DEFAULT_SEED = 20_260_911
MIN_ROWS = 20


@dataclass(frozen=True)
class TrainOptions:
    folds: int = 5
    resamples: int = 500
    seed: int = DEFAULT_SEED
    quick: bool = False  # fit only: used to replay older cycles at boot


def train_run(rows: Sequence[TrainingRow], run_id: int, opt: TrainOptions | None = None) -> ModelRun:
    opt = opt or TrainOptions()
    n = len(rows)
    X = [featurize(r) for r in rows]
    y = [int(r.passed) for r in rows]
    n_positive = sum(y)

    hour_counts = [0] * 24
    hour_wins = [0] * 24
    for r in rows:
        hour_counts[r.hour] += 1
        hour_wins[r.hour] += int(r.passed)

    base = dict(
        run_id=run_id,
        n=n,
        n_positive=n_positive,
        d=D,
        hour_counts=hour_counts,
        hour_rates=[hour_wins[h] / c if c else 0.0 for h, c in enumerate(hour_counts)],
        median_holders=median([r.holders for r in rows]),
    )
    all_rows = list(range(n))

    if n < MIN_ROWS or n_positive == 0 or n_positive == n:
        model = fit_logistic(X, y, all_rows, 1.0, 1) if n else _empty_model()
        return ModelRun(**base, auc=0.5, auc_std=0.0, fold_aucs=[], time_split_gap=0.0, boot_lower=0.5,
                        feature_importance={}, model=model)

    model = fit_logistic(X, y, all_rows)
    feature_importance = importance(model.weights)
    if opt.quick:
        return ModelRun(**base, auc=0.5, auc_std=0.0, fold_aucs=[], time_split_gap=0.0, boot_lower=0.5,
                        feature_importance=feature_importance, model=model)

    rng = rng_from_seed(opt.seed ^ run_id)
    k = min(opt.folds, max(2, n // 10))
    fold = stratified_folds(y, k, rng)
    oof = [0.0] * n
    fold_aucs: list[float] = []
    for f in range(k):
        train = [i for i in all_rows if fold[i] != f]
        test = [i for i in all_rows if fold[i] == f]
        m = fit_logistic(X, y, train)
        scores: list[float] = []
        for i in test:
            oof[i] = predict_proba(m, X[i])
            scores.append(oof[i])
        fold_aucs.append(roc_auc([y[i] for i in test], scores))
    auc = mean(fold_aucs)

    # Leakage sanity check: train on the oldest 70%, test on the newest 30%.
    by_time = sorted(all_rows, key=lambda i: rows[i].launched_at)
    cut = int(n * 0.7)
    tm = fit_logistic(X, y, by_time[:cut])
    future = by_time[cut:]
    time_auc = roc_auc([y[i] for i in future], [predict_proba(tm, X[i]) for i in future])
    time_split_gap = 0.0 if math.isnan(time_auc) else abs(auc - time_auc)

    # Efron: resample out-of-fold predictions, keep the 2.5th percentile.
    boot_lower = bootstrap_auc_percentile(y, oof, rng, opt.resamples, 2.5)

    return ModelRun(**base, auc=auc, auc_std=std(fold_aucs), fold_aucs=fold_aucs, time_split_gap=time_split_gap,
                    boot_lower=boot_lower, feature_importance=feature_importance, model=model)


def importance(weights: Sequence[float]) -> dict[str, float]:
    magnitudes = [abs(w) for w in weights]
    total = sum(magnitudes) or 1.0
    return {name: magnitudes[j] / total for j, name in enumerate(FEATURE_NAMES)}


def _empty_model() -> ScoringModel:
    return ScoringModel(weights=[0.0] * D, bias=0.0, mu=[0.0] * D, sigma=[1.0] * D)
