import math

import pytest

from wassily.maths.bounds import (
    BOUND_BY_ID,
    BOUNDS,
    BoundInput,
    confidence_label,
    hanley_mcneil_se,
    hoeffding_epsilon,
    is_bound_id,
    jar_fraction,
    vc_epsilon,
)


@pytest.mark.parametrize(
    "m, eps, floor, jar",
    [(100, 0.122, 0.528, 0.28), (200, 0.087, 0.563, 0.63), (600, 0.050, 0.600, 1.0), (1000, 0.039, 0.611, 1.0)],
)
def test_readme_worked_example(m, eps, floor, jar):
    """Measured AUC 0.65; survivors are the smaller class, so m is the number of survivors."""
    e = hoeffding_epsilon(m, 10 * m, 0.05)
    assert round(e, 3) == eps
    assert round(0.65 - e, 3) == floor
    assert abs(jar_fraction(0.65 - e, 0.5, 0.6) - jar) < 0.01


def test_thin_evidence_empties_the_jar():
    floor = 0.62 - hoeffding_epsilon(100, 900, 0.05)
    assert round(floor, 3) == 0.498
    assert jar_fraction(floor, 0.5, 0.6) == 0


def evidence(n, n_pos, **kw):
    return BoundInput(n=n, n_pos=n_pos, auc=kw.get("auc", 0.65), auc_std=0.02, d=28, delta=0.05,
                      boot_lower=kw.get("boot_lower"))


@pytest.mark.parametrize("bound", [b for b in BOUNDS if not b.needs_bootstrap], ids=lambda b: b.id)
def test_every_bound_tightens_with_evidence(bound):
    small = bound.compute(evidence(400, 40)).epsilon
    large = bound.compute(evidence(40_000, 4_000)).epsilon
    assert large < small


def test_bootstrap_bounds_wait_for_a_bootstrap():
    assert BOUND_BY_ID["bootstrap"].compute(evidence(2000, 300)).pending
    assert BOUND_BY_ID["vc-bootstrap"].compute(evidence(2000, 300)).pending
    done = BOUND_BY_ID["bootstrap"].compute(evidence(2000, 300, boot_lower=0.61))
    assert not done.pending and done.floor == 0.61


def test_vc_bootstrap_takes_the_stricter_floor():
    vc_floor = 0.65 - vc_epsilon(50_000, 28, 0.05)
    loose = BOUND_BY_ID["vc-bootstrap"].compute(BoundInput(50_000, 5_000, 0.65, 0.01, 28, 0.05, boot_lower=0.64))
    assert math.isclose(loose.floor, min(vc_floor, 0.64))


def test_vc_penalty_is_total_below_capacity():
    assert vc_epsilon(20, 28, 0.05) == 1


def test_hanley_mcneil_standard_error():
    assert abs(hanley_mcneil_se(0.5, 100, 100) - 0.040927) < 1e-5
    assert hanley_mcneil_se(0.7, 0, 10) == math.inf


def test_bayes_floor_is_below_the_measured_auc():
    r = BOUND_BY_ID["bayes"].compute(evidence(2000, 500))
    assert 0.5 < r.floor < 0.65


def test_confidence_labels():
    assert confidence_label(-0.1) == "none"
    assert confidence_label(0.52) == "weak"
    assert confidence_label(0.6) == "provisional"
    assert confidence_label(0.7) == "qualified"


def test_bound_ids():
    assert len(BOUNDS) == 9
    assert is_bound_id("hoeffding") and not is_bound_id("nope") and not is_bound_id(None)
