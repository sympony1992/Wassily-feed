"""Class-balanced, L2-regularised logistic regression fitted by Newton's method (IRLS).

Survivors are the minority, so each class carries equal total weight. numpy is
used when it is installed; the pure-Python path computes the same fit and is
what ``WASSILY_PURE_PYTHON=1`` forces for parity checks.
"""

from __future__ import annotations

import math
import os
from collections.abc import Sequence

from wassily.engine.types import ScoringModel
from wassily.maths.stats import Rng

try:  # pragma: no cover - exercised implicitly by whichever backend is present
    import numpy as _np
except ImportError:  # pragma: no cover
    _np = None

USE_NUMPY = _np is not None and os.environ.get("WASSILY_PURE_PYTHON") != "1"


def _sigmoid(s: float) -> float:
    if s >= 0:
        return 1 / (1 + math.exp(-s))
    e = math.exp(s)
    return e / (1 + e)


def fit_logistic(
    X: Sequence[Sequence[float]],
    y: Sequence[int],
    rows: Sequence[int] | None = None,
    l2: float = 1.0,
    iterations: int = 12,
) -> ScoringModel:
    rows = list(range(len(y))) if rows is None else list(rows)
    d = len(X[0]) if len(X) else 0
    if not rows or d == 0:
        return ScoringModel(weights=[0.0] * d, bias=0.0, mu=[0.0] * d, sigma=[1.0] * d)
    if USE_NUMPY:
        return _fit_numpy(X, y, rows, d, l2, iterations)
    return _fit_python(X, y, rows, d, l2, iterations)


def _fit_numpy(X, y, rows: list[int], d: int, l2: float, iterations: int) -> ScoringModel:
    np = _np
    Xs = np.asarray(X, dtype=float)[rows]
    ys = np.asarray(y, dtype=float)[rows]
    n = len(rows)

    mu = Xs.mean(axis=0)
    sigma = Xs.std(axis=0)
    sigma[sigma <= 1e-9] = 1.0
    Z = np.hstack([np.ones((n, 1)), (Xs - mu) / sigma])

    n_pos = float(ys.sum())
    n_neg = n - n_pos
    w_pos = n / (2 * n_pos) if n_pos else 0.0
    w_neg = n / (2 * n_neg) if n_neg else 0.0
    c = np.where(ys == 1, w_pos, w_neg)

    D = d + 1
    reg = np.full(D, l2)
    reg[0] = 0.0
    theta = np.zeros(D)
    for _ in range(iterations):
        p = 1 / (1 + np.exp(-np.clip(Z @ theta, -500, 500)))
        grad = Z.T @ (c * (p - ys)) + reg * theta
        H = (Z * (c * p * (1 - p))[:, None]).T @ Z
        H[np.diag_indices(D)] += reg
        H[0, 0] += 1e-6
        step = _cholesky_solve_np(H, grad)
        theta -= step
        if float(np.abs(step).max()) < 1e-7:
            break

    return ScoringModel(weights=theta[1:].tolist(), bias=float(theta[0]), mu=mu.tolist(), sigma=sigma.tolist())


def _cholesky_solve_np(H, b):
    np = _np
    try:
        L = np.linalg.cholesky(H)
    except np.linalg.LinAlgError:
        return np.linalg.lstsq(H, b, rcond=None)[0]
    return np.linalg.solve(L.T, np.linalg.solve(L, b))


def _fit_python(X, y, rows: list[int], d: int, l2: float, iterations: int) -> ScoringModel:
    n = len(rows)
    mu = [0.0] * d
    sigma = [0.0] * d
    for i in rows:
        xi = X[i]
        for j in range(d):
            mu[j] += xi[j]
    mu = [m / max(1, n) for m in mu]
    for i in rows:
        xi = X[i]
        for j in range(d):
            sigma[j] += (xi[j] - mu[j]) ** 2
    sigma = [s if s > 1e-9 else 1.0 for s in (math.sqrt(v / max(1, n)) for v in sigma)]

    n_pos = sum(y[i] for i in rows)
    n_neg = n - n_pos
    w_pos = n / (2 * n_pos) if n_pos else 0.0
    w_neg = n / (2 * n_neg) if n_neg else 0.0

    D = d + 1
    theta = [0.0] * D
    Zrows = [[1.0] + [(X[i][j] - mu[j]) / sigma[j] for j in range(d)] for i in rows]
    labels = [y[i] for i in rows]

    for _ in range(iterations):
        grad = [0.0] * D
        H = [[0.0] * D for _ in range(D)]
        for z, label in zip(Zrows, labels):
            p = _sigmoid(sum(t * zj for t, zj in zip(theta, z)))
            c = w_pos if label else w_neg
            g = c * (p - label)
            h = c * p * (1 - p)
            for a in range(D):
                grad[a] += g * z[a]
                hz = h * z[a]
                row = H[a]
                for b in range(a, D):
                    row[b] += hz * z[b]
        for a in range(D):
            for b in range(a):
                H[a][b] = H[b][a]
        for j in range(1, D):
            grad[j] += l2 * theta[j]
            H[j][j] += l2
        H[0][0] += 1e-6
        step = _cholesky_solve(H, grad)
        moved = 0.0
        for j in range(D):
            theta[j] -= step[j]
            moved = max(moved, abs(step[j]))
        if moved < 1e-7:
            break

    return ScoringModel(weights=theta[1:], bias=theta[0], mu=mu, sigma=sigma)


def _cholesky_solve(A: list[list[float]], b: list[float]) -> list[float]:
    n = len(b)
    L = [[0.0] * n for _ in range(n)]
    for i in range(n):
        for j in range(i + 1):
            s = A[i][j] - sum(L[i][k] * L[j][k] for k in range(j))
            L[i][j] = math.sqrt(max(s, 1e-12)) if i == j else s / L[j][j]
    yv = [0.0] * n
    for i in range(n):
        yv[i] = (b[i] - sum(L[i][k] * yv[k] for k in range(i))) / L[i][i]
    x = [0.0] * n
    for i in range(n - 1, -1, -1):
        x[i] = (yv[i] - sum(L[k][i] * x[k] for k in range(i + 1, n))) / L[i][i]
    return x


def predict_proba(m: ScoringModel, x: Sequence[float]) -> float:
    s = m.bias
    for w, xj, mu, sd in zip(m.weights, x, m.mu, m.sigma):
        s += w * (xj - mu) / sd
    return _sigmoid(s)


def stratified_folds(y: Sequence[int], k: int, rng: Rng) -> list[int]:
    """Shuffle each class separately and deal rows round-robin into k folds."""
    fold = [0] * len(y)
    for cls in (0, 1):
        idx = [i for i, label in enumerate(y) if label == cls]
        for i in range(len(idx) - 1, 0, -1):
            j = int(rng() * (i + 1))
            idx[i], idx[j] = idx[j], idx[i]
        for pos, row in enumerate(idx):
            fold[row] = pos % k
    return fold
