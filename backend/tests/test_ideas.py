import hashlib

import pytest
from conftest import NOW, zero_model

from wassily.config.personas import PERSONA_BY_ID
from wassily.engine.ideas import CONTENT_RULES, CycleInput, generate_cycle, generator_sha
from wassily.maths.commit import verify_candidate

WASSILY = PERSONA_BY_ID["hoeffding"]


def spec(**overrides) -> CycleInput:
    base = dict(
        cycle_id=1412, run_id=438, model=zero_model(hour_sin=1.2, hour_cos=-0.4, lore_len=0.2, name_tokens=0.3),
        median_holders=288, dow=5, names=WASSILY.ideas.names, suffixes=WASSILY.ideas.suffixes,
        lores=WASSILY.ideas.lores, auc=0.61, floor=0.55, now=NOW,
    )
    base.update(overrides)
    return CycleInput(**base)


@pytest.fixture(scope="module")
def cycle():
    return generate_cycle(spec())


def test_cycle_is_replayable(cycle):
    again = generate_cycle(spec())
    assert [c.commitment for c in again.candidates] == [c.commitment for c in cycle.candidates]


def test_seed_is_the_sha256_of_the_run_id(cycle):
    assert cycle.seed == hashlib.sha256(b"438").hexdigest()
    assert generate_cycle(spec(run_id=439)).seed != cycle.seed


def test_filter_rejects_before_scoring(cycle):
    assert cycle.n_rejected > 0
    assert cycle.rule_hits.get("financial_promise", 0) > 0
    names = " ".join(c.name for c in cycle.candidates)
    assert "Guaranteed" not in names and "100x" not in names


def test_candidates_are_ranked_and_unique(cycle):
    assert 0 < cycle.n_generated == len(cycle.candidates) <= 100
    scores = [c.score for c in cycle.candidates]
    assert scores == sorted(scores, reverse=True)
    assert [c.rank for c in cycle.candidates] == list(range(1, len(scores) + 1))
    assert len({c.name.lower() for c in cycle.candidates}) == len(scores)


def test_every_commitment_verifies(cycle):
    assert all(verify_candidate(c.name, c.lore, c.hour, cycle.run_id, c.commitment) for c in cycle.candidates)
    c = cycle.candidates[0]
    assert not verify_candidate(c.name, c.lore, (c.hour + 1) % 24, cycle.run_id, c.commitment)


def test_stolen_names_are_excluded(cycle):
    top = cycle.candidates[0].name.lower()
    after = generate_cycle(spec(stolen_names={top}))
    assert top not in {c.name.lower() for c in after.candidates}
    assert after.n_excluded >= 1


def test_names_already_on_chain_are_rejected(cycle):
    top = cycle.candidates[0].name.lower()
    after = generate_cycle(spec(deployed_names={top}))
    assert after.rule_hits.get("near_duplicate") == 1
    assert top not in {c.name.lower() for c in after.candidates}


def test_rules_and_generator_identity():
    assert [r.id for r in CONTENT_RULES] == ["real_person", "financial_promise", "ticker_impersonation",
                                             "near_duplicate"]
    sha = generator_sha()
    assert len(sha) == 64 and sha == generator_sha()
