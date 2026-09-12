import math

import pytest
from conftest import NOW_MS

from wassily.engine.simulator import Market, to_training_row
from wassily.engine.trainer import TrainOptions, train_run


@pytest.fixture(scope="module")
def rows():
    return [to_training_row(t) for t in Market(11).history(300, NOW_MS)]


def test_too_few_rows_is_a_coin_flip(rows):
    run = train_run(rows[:10], 1)
    assert run.auc == 0.5 and run.fold_aucs == [] and run.boot_lower == 0.5
    assert run.n == 10


def test_single_class_is_a_coin_flip(rows):
    stalled = [r for r in rows if not r.passed][:40]
    run = train_run(stalled, 1)
    assert run.auc == 0.5 and run.n_positive == 0


def test_full_run_on_a_simulated_market(rows):
    run = train_run(rows, 438, TrainOptions(resamples=40))
    assert run.n == 300 and 0 < run.n_positive < 300
    assert len(run.fold_aucs) == 5
    assert 0.45 < run.auc < 0.95
    assert run.boot_lower < run.auc + 0.05
    assert run.time_split_gap >= 0
    assert math.isclose(sum(run.feature_importance.values()), 1.0)
    assert sum(run.hour_counts) == 300 and len(run.hour_rates) == 24


def test_training_is_reproducible(rows):
    a = train_run(rows, 438, TrainOptions(resamples=30))
    b = train_run(rows, 438, TrainOptions(resamples=30))
    assert a.fold_aucs == b.fold_aucs and a.boot_lower == b.boot_lower


def test_quick_mode_fits_without_validation(rows):
    run = train_run(rows, 438, TrainOptions(quick=True))
    assert run.fold_aucs == [] and run.auc == 0.5
    assert run.feature_importance
