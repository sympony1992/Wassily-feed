"""Concentration bounds that turn a measured AUC into a proven floor.

Every bound answers the same question: given a measured AUC, how far below it
could the true AUC sit, with confidence 1 - delta? The jar fills with the floor
(AUC - epsilon), never with the raw score.
"""

from __future__ import annotations

import math
from collections.abc import Callable
from dataclasses import dataclass
from typing import Literal

from wassily.maths.stats import beta_inv, clamp, normal_inv

BoundId = Literal["vc", "vc-bootstrap", "bootstrap", "hoeffding", "bernstein", "dkw", "wilcoxon", "cantelli", "bayes"]
ConfidenceLabel = Literal["none", "weak", "provisional", "qualified"]


@dataclass(frozen=True)
class BoundInput:
    n: int  # labelled tokens
    n_pos: int  # tokens that reached the target
    auc: float  # measured (cross-validated) ROC-AUC
    auc_std: float  # std of AUC across CV folds
    d: int  # model capacity
    delta: float  # 1 - confidence
    boot_lower: float | None = None  # Efron percentile lower bound, when available

    @property
    def n_neg(self) -> int:
        return max(0, self.n - self.n_pos)


@dataclass(frozen=True)
class BoundResult:
    epsilon: float  # >= 1 means "the penalty takes everything"
    floor: float  # AUC - epsilon, unclamped
    pending: bool = False  # needs a bootstrap that has not finished


@dataclass(frozen=True)
class BoundDef:
    id: str
    name: str
    short: str
    credit: str
    year: str
    formula: str
    uses: tuple[str, ...]
    summary: str
    compute: Callable[[BoundInput], BoundResult]

    @property
    def needs_bootstrap(self) -> bool:
        return "bootstrap" in self.uses


def hanley_mcneil_se(auc: float, n_pos: int, n_neg: int) -> float:
    """Hanley & McNeil (1982) standard error of an AUC."""
    if n_pos < 1 or n_neg < 1:
        return math.inf
    a = clamp(auc, 1e-6, 1 - 1e-6)
    q1 = a / (2 - a)
    q2 = 2 * a * a / (1 + a)
    v = (a * (1 - a) + (n_pos - 1) * (q1 - a * a) + (n_neg - 1) * (q2 - a * a)) / (n_pos * n_neg)
    return math.sqrt(max(v, 1e-12))


def vc_epsilon(n: int, d: int, delta: float) -> float:
    if n <= d or n <= 0:
        return 1.0
    v = (d * (math.log(2 * n / d) + 1) + math.log(4 / delta)) / n
    return math.sqrt(v) if v > 0 else 0.0


def hoeffding_epsilon(n_pos: int, n_neg: int, delta: float) -> float:
    m = min(n_pos, n_neg)
    if m < 1:
        return 1.0
    return math.sqrt(math.log(1 / delta) / (2 * m))


def bernstein_epsilon(auc: float, n_pos: int, n_neg: int, delta: float) -> float:
    m = min(n_pos, n_neg)
    if m < 1:
        return 1.0
    a = clamp(auc, 0, 1)
    variance = a * (1 - a)
    log_term = math.log(1 / delta)
    return math.sqrt(2 * variance * log_term / m) + 2 * log_term / (3 * m)


def dkw_epsilon(n_pos: int, n_neg: int, delta: float) -> float:
    if n_pos < 1 or n_neg < 1:
        return 1.0
    log_term = math.log(4 / delta)
    return math.sqrt(log_term / (2 * n_pos)) + math.sqrt(log_term / (2 * n_neg))


def _vc(x: BoundInput) -> BoundResult:
    e = vc_epsilon(x.n, x.d, x.delta)
    return BoundResult(e, x.auc - e)


def _vc_bootstrap(x: BoundInput) -> BoundResult:
    vc_floor = x.auc - vc_epsilon(x.n, x.d, x.delta)
    if x.boot_lower is None:
        return BoundResult(x.auc - vc_floor, vc_floor, pending=True)
    floor = min(vc_floor, x.boot_lower)
    return BoundResult(x.auc - floor, floor)


def _bootstrap(x: BoundInput) -> BoundResult:
    if x.boot_lower is None:
        return BoundResult(1.0, x.auc - 1, pending=True)
    return BoundResult(x.auc - x.boot_lower, x.boot_lower)


def _hoeffding(x: BoundInput) -> BoundResult:
    e = hoeffding_epsilon(x.n_pos, x.n_neg, x.delta)
    return BoundResult(e, x.auc - e)


def _bernstein(x: BoundInput) -> BoundResult:
    e = bernstein_epsilon(x.auc, x.n_pos, x.n_neg, x.delta)
    return BoundResult(e, x.auc - e)


def _dkw(x: BoundInput) -> BoundResult:
    e = dkw_epsilon(x.n_pos, x.n_neg, x.delta)
    return BoundResult(e, x.auc - e)


def _wilcoxon(x: BoundInput) -> BoundResult:
    e = normal_inv(1 - x.delta) * hanley_mcneil_se(x.auc, x.n_pos, x.n_neg)
    return BoundResult(min(1.0, e), x.auc - e)


def _cantelli(x: BoundInput) -> BoundResult:
    e = hanley_mcneil_se(x.auc, x.n_pos, x.n_neg) * math.sqrt((1 - x.delta) / x.delta)
    return BoundResult(min(1.0, e), x.auc - e)


def _bayes(x: BoundInput) -> BoundResult:
    a = clamp(x.auc, 1e-6, 1 - 1e-6)
    se = hanley_mcneil_se(a, x.n_pos, x.n_neg)
    if not math.isfinite(se):
        return BoundResult(1.0, x.auc - 1)
    k = max(0.0, a * (1 - a) / (se * se) - 1)
    floor = beta_inv(x.delta, k * a + 1, k * (1 - a) + 1)
    return BoundResult(x.auc - floor, floor)


BOUNDS: tuple[BoundDef, ...] = (
    BoundDef(
        id="vc",
        name="Vapnik-Chervonenkis capacity bound",
        short="VC bound",
        credit="Vladimir Vapnik & Alexey Chervonenkis",
        year="1971",
        formula="eps = sqrt((d(ln(2n/d)+1) + ln(4/delta)) / n)",
        uses=("n", "d", "auc"),
        summary="Uniform convergence for a model class of capacity d. Distribution-free and very conservative.",
        compute=_vc,
    ),
    BoundDef(
        id="vc-bootstrap",
        name="min(VC floor, bootstrap floor)",
        short="VC ∧ bootstrap",
        credit="Vapnik-Chervonenkis + Bradley Efron",
        year="1971 / 1979",
        formula="floor = min(AUC - eps_VC, Q_2.5%(AUC*_b))",
        uses=("n", "d", "auc", "bootstrap"),
        summary="The stricter of two floors: the VC capacity penalty and the 2.5th percentile of bootstrap AUCs.",
        compute=_vc_bootstrap,
    ),
    BoundDef(
        id="bootstrap",
        name="Percentile bootstrap",
        short="Bootstrap",
        credit="Bradley Efron",
        year="1979",
        formula="floor = Q_{delta/2}(AUC*_1, ..., AUC*_B)",
        uses=("n", "nPos", "auc", "bootstrap"),
        summary="Resample tokens with replacement, re-measure AUC each time, and take a low percentile.",
        compute=_bootstrap,
    ),
    BoundDef(
        id="hoeffding",
        name="Hoeffding bound for U-statistics",
        short="Hoeffding",
        credit="Wassily Hoeffding",
        year="1963",
        formula="eps = sqrt(ln(1/delta) / 2 min(n+, n-))",
        uses=("nPos", "auc"),
        summary="AUC is a two-sample U-statistic, so Hoeffding's inequality applies with the smaller class.",
        compute=_hoeffding,
    ),
    BoundDef(
        id="bernstein",
        name="Bernstein inequality",
        short="Bernstein",
        credit="Sergei Bernstein",
        year="1924",
        formula="eps = sqrt(2 s^2 ln(1/delta) / m) + 2 ln(1/delta) / 3m, s^2 = AUC(1-AUC)",
        uses=("nPos", "auc"),
        summary="Like Hoeffding but variance-aware: the penalty shrinks as AUC moves toward 0 or 1.",
        compute=_bernstein,
    ),
    BoundDef(
        id="dkw",
        name="Kolmogorov-Smirnov / DKW band",
        short="Kolmogorov (DKW)",
        credit="Andrey Kolmogorov; Dvoretzky-Kiefer-Wolfowitz; Massart",
        year="1933 / 1956 / 1990",
        formula="eps = sqrt(ln(4/delta) / 2n+) + sqrt(ln(4/delta) / 2n-)",
        uses=("nPos", "auc"),
        summary="Bound each class's empirical CDF uniformly; AUC can move by at most the sum of both errors.",
        compute=_dkw,
    ),
    BoundDef(
        id="wilcoxon",
        name="Wilcoxon-Mann-Whitney normal interval",
        short="Wilcoxon",
        credit="Frank Wilcoxon; Mann & Whitney; Hanley & McNeil",
        year="1945 / 1947 / 1982",
        formula="eps = z_{1-delta} * SE_HanleyMcNeil",
        uses=("nPos", "auc"),
        summary="Large-sample standard error of the rank-sum statistic with a one-sided normal quantile.",
        compute=_wilcoxon,
    ),
    BoundDef(
        id="cantelli",
        name="Chebyshev-Cantelli inequality",
        short="Chebyshev",
        credit="Pafnuty Chebyshev; Francesco Cantelli",
        year="1867 / 1928",
        formula="eps = SE * sqrt((1-delta)/delta)",
        uses=("nPos", "auc"),
        summary="Only assumes a finite variance: the one-sided Chebyshev inequality turns the SE into a floor.",
        compute=_cantelli,
    ),
    BoundDef(
        id="bayes",
        name="Bayes-Laplace posterior credible floor",
        short="Bayes",
        credit="Thomas Bayes; Pierre-Simon Laplace",
        year="1763 / 1774",
        formula="floor = BetaInv(delta; kA+1, k(1-A)+1), k = A(1-A)/SE^2 - 1",
        uses=("nPos", "auc"),
        summary="Uniform prior over AUC with k effective comparisons; report the delta-quantile of the posterior.",
        compute=_bayes,
    ),
)

BOUND_BY_ID: dict[str, BoundDef] = {b.id: b for b in BOUNDS}


def is_bound_id(value: object) -> bool:
    return isinstance(value, str) and value in BOUND_BY_ID


def jar_fraction(floor: float, auc_floor: float, auc_target: float) -> float:
    """Map a floor onto the jar: 0% at the coin-flip floor, 100% at the target."""
    return clamp((floor - auc_floor) / (auc_target - auc_floor), 0, 1)


def confidence_label(proven_floor: float) -> ConfidenceLabel:
    if proven_floor < 0:
        return "none"
    if proven_floor < 0.55:
        return "weak"
    if proven_floor < 0.65:
        return "provisional"
    return "qualified"
