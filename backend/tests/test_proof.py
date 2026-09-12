import math

from conftest import make_run

from wassily.config.site import SITE
from wassily.engine.proof import GATE_KEYS, evaluate_model
from wassily.maths.bounds import BOUND_BY_ID

HOEFFDING = BOUND_BY_ID["hoeffding"]


def test_all_gates_pass_and_the_jar_fills():
    p = evaluate_model(make_run(), HOEFFDING)
    assert math.isclose(p.epsilon, math.sqrt(math.log(20) / 1200))
    assert p.blocked_by is None
    assert p.jar == 1 and p.unlocked
    assert tuple(p.gates) == GATE_KEYS


def test_a_failing_gate_caps_the_jar():
    p = evaluate_model(make_run(n=1500), HOEFFDING)
    assert p.blocked_by == "n_samples"
    assert p.raw_jar == 1
    assert p.jar == SITE.gates.jar_cap_when_blocked
    assert not p.unlocked


def test_the_first_failing_gate_is_reported():
    p = evaluate_model(make_run(n=100, auc_std=0.2, time_split_gap=0.3), HOEFFDING)
    assert p.blocked_by == "n_samples"
    assert [k for k, ok in p.gates.items() if not ok] == ["n_samples", "auc_std", "time_split"]


def test_backend_gate_overrides_win():
    p = evaluate_model(make_run(gates_override={"time_split": False}), HOEFFDING)
    assert p.blocked_by == "time_split"


def test_thin_sample_keeps_the_jar_empty():
    p = evaluate_model(make_run(n=1000, n_positive=100, auc=0.62), HOEFFDING)
    assert p.jar == 0
    assert p.confidence == "weak"
