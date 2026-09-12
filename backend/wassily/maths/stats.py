"""Numerical building blocks shared by the bounds, the trainer and the simulator.

Ported from ``src/math/stats.ts``. The seeded generator is bit-exact with the
TypeScript one, so an idea cycle replayed here yields the same names, hours and
commitments the site published.
"""

from __future__ import annotations

import math
from collections.abc import Callable, Sequence
from typing import TypeVar

Rng = Callable[[], float]
T = TypeVar("T")

_U32 = 0xFFFFFFFF


def clamp(x: float, lo: float, hi: float) -> float:
    return min(hi, max(lo, x))


def mean(xs: Sequence[float]) -> float:
    return sum(xs) / len(xs) if len(xs) else 0.0


def std(xs: Sequence[float]) -> float:
    """Population standard deviation (ddof = 0), matching numpy's default."""
    if not len(xs):
        return 0.0
    m = mean(xs)
    return math.sqrt(sum((x - m) ** 2 for x in xs) / len(xs))


def percentile_sorted(sorted_xs: Sequence[float], q: float) -> float:
    """Linear-interpolated percentile on an ascending-sorted sequence (numpy "linear")."""
    if not len(sorted_xs):
        return math.nan
    pos = (q / 100) * (len(sorted_xs) - 1)
    lo = math.floor(pos)
    hi = math.ceil(pos)
    return sorted_xs[lo] + (sorted_xs[hi] - sorted_xs[lo]) * (pos - lo)


def median(xs: Sequence[float]) -> float:
    """Upper median, as the dashboard reports it: the middle pair is not averaged."""
    if not len(xs):
        return 0
    s = sorted(xs)
    return s[len(s) >> 1]


# ---------------------------------------------------------------------------
# Normal distribution


def normal_cdf(x: float) -> float:
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))


_ACKLAM_A = (-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239)
_ACKLAM_B = (-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572, 1.0)
_ACKLAM_C = (-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783)
_ACKLAM_D = (0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416, 1.0)


def _horner(coeffs: Sequence[float], x: float) -> float:
    acc = 0.0
    for c in coeffs:
        acc = acc * x + c
    return acc


def normal_inv(p: float) -> float:
    """Inverse standard normal CDF (Acklam's rational approximation)."""
    if p <= 0:
        return -math.inf
    if p >= 1:
        return math.inf
    tail = 0.02425
    if p < tail:
        q = math.sqrt(-2 * math.log(p))
        return _horner(_ACKLAM_C, q) / _horner(_ACKLAM_D, q)
    if p > 1 - tail:
        q = math.sqrt(-2 * math.log(1 - p))
        return -_horner(_ACKLAM_C, q) / _horner(_ACKLAM_D, q)
    q = p - 0.5
    r = q * q
    return _horner(_ACKLAM_A, r) * q / _horner(_ACKLAM_B, r)


# ---------------------------------------------------------------------------
# Beta distribution


def _beta_continued_fraction(x: float, a: float, b: float) -> float:
    """Continued fraction for the incomplete beta function (modified Lentz)."""
    tiny = 1e-300
    qab = a + b
    qap = a + 1
    qam = a - 1
    c = 1.0
    d = 1 - qab * x / qap
    if abs(d) < tiny:
        d = tiny
    d = 1 / d
    h = d
    for m in range(1, 1001):
        m2 = 2 * m
        aa = m * (b - m) * x / ((qam + m2) * (a + m2))
        d = 1 + aa * d
        if abs(d) < tiny:
            d = tiny
        c = 1 + aa / c
        if abs(c) < tiny:
            c = tiny
        d = 1 / d
        h *= d * c
        aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2))
        d = 1 + aa * d
        if abs(d) < tiny:
            d = tiny
        c = 1 + aa / c
        if abs(c) < tiny:
            c = tiny
        d = 1 / d
        delta = d * c
        h *= delta
        if abs(delta - 1) < 1e-12:
            break
    return h


def beta_cdf(x: float, a: float, b: float) -> float:
    """Regularized incomplete beta I_x(a, b)."""
    if x <= 0:
        return 0.0
    if x >= 1:
        return 1.0
    ln_front = math.lgamma(a + b) - math.lgamma(a) - math.lgamma(b) + a * math.log(x) + b * math.log1p(-x)
    front = math.exp(ln_front)
    if x < (a + 1) / (a + b + 2):
        return front * _beta_continued_fraction(x, a, b) / a
    return 1 - front * _beta_continued_fraction(1 - x, b, a) / b


def beta_inv(p: float, a: float, b: float) -> float:
    """Quantile of Beta(a, b) by bisection: monotone and exact enough for a floor."""
    lo, hi = 0.0, 1.0
    for _ in range(80):
        mid = (lo + hi) / 2
        if beta_cdf(mid, a, b) < p:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


# ---------------------------------------------------------------------------
# Seeded randomness


def sfc32(a: int, b: int, c: int, d: int) -> Rng:
    """sfc32: small, fast, 128-bit state. Returns floats in [0, 1), bit-exact with the site."""
    state = [a & _U32, b & _U32, c & _U32, d & _U32]

    def rng() -> float:
        a, b, c, d = state
        t = (a + b + d) & _U32
        d = (d + 1) & _U32
        a = b ^ (b >> 9)
        b = (c + (c << 3)) & _U32
        c = ((c << 21) | (c >> 11)) & _U32
        c = (c + t) & _U32
        state[0], state[1], state[2], state[3] = a, b, c, d
        return t / 4294967296

    return rng


def rng_from_hex(digest: str) -> Rng:
    """Seed an sfc32 from the first 32 hex chars of a digest."""
    parts = [int(digest[i * 8 : i * 8 + 8], 16) for i in range(4)]
    rng = sfc32(*parts)
    for _ in range(15):  # warm up
        rng()
    return rng


def rng_from_seed(seed: int) -> Rng:
    rng = sfc32(0x9E3779B9, 0x243F6A88, 0xB7E15162, seed & _U32)
    for _ in range(15):
        rng()
    return rng


def gaussian(rng: Rng) -> float:
    u = 0.0
    while u == 0.0:
        u = rng()
    return math.sqrt(-2 * math.log(u)) * math.cos(2 * math.pi * rng())


def pick(rng: Rng, xs: Sequence[T]) -> T:
    return xs[int(rng() * len(xs))]


def hex_string(rng: Rng, length: int) -> str:
    return "".join(format(int(rng() * 16), "x") for _ in range(length))
