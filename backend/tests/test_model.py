import pytest

from wassily.engine import model as model_module
from wassily.engine.model import fit_logistic, predict_proba, stratified_folds
from wassily.maths.auc import roc_auc
from wassily.maths.stats import gaussian, rng_from_seed


def signal_dataset(n=300, d=5, seed=4):
    rng = rng_from_seed(seed)
    X, y = [], []
    for _ in range(n):
        label = 1 if rng() < 0.3 else 0
        row = [gaussian(rng) for _ in range(d)]
        row[0] += 1.5 * label  # only column 0 carries signal
        X.append(row)
        y.append(label)
    return X, y


def test_fit_finds_the_signal_column():
    X, y = signal_dataset()
    m = fit_logistic(X, y)
    assert abs(m.weights[0]) == max(abs(w) for w in m.weights)
    assert m.weights[0] > 0
    assert roc_auc(y, [predict_proba(m, x) for x in X]) > 0.8


def test_rows_subset_is_respected():
    X, y = signal_dataset()
    full = fit_logistic(X, y)
    half = fit_logistic(X, y, rows=range(150))
    assert full.weights != half.weights


def test_pure_python_matches_numpy():
    if model_module._np is None:
        pytest.skip("numpy not installed")
    X, y = signal_dataset(n=200)
    rows = list(range(len(y)))
    fast = model_module._fit_numpy(X, y, rows, 5, 1.0, 12)
    slow = model_module._fit_python(X, y, rows, 5, 1.0, 12)
    assert fast.bias == pytest.approx(slow.bias, abs=1e-6)
    assert fast.weights == pytest.approx(slow.weights, abs=1e-6)
    assert fast.sigma == pytest.approx(slow.sigma, abs=1e-9)


def test_predict_proba_does_not_overflow():
    X, y = signal_dataset(n=60)
    m = fit_logistic(X, y)
    assert 0 <= predict_proba(m, [1e6] * 5) <= 1
    assert 0 <= predict_proba(m, [-1e6] * 5) <= 1


def test_empty_rows_give_a_neutral_model():
    m = fit_logistic([[1.0, 2.0]], [1], rows=[])
    assert m.weights == [0.0, 0.0] and m.sigma == [1.0, 1.0]


def test_stratified_folds_balance_each_class():
    y = [1] * 30 + [0] * 70
    fold = stratified_folds(y, 5, rng_from_seed(2))
    for f in range(5):
        members = [i for i in range(100) if fold[i] == f]
        assert sum(y[i] for i in members) == 6
        assert len(members) == 20
