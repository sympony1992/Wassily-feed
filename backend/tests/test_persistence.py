import json

from conftest import NOW, zero_model

from wassily.config.personas import PERSONA_BY_ID
from wassily.engine.ideas import CycleInput, generate_cycle
from wassily.maths.commit import verify_candidate
from wassily.store.persistence import Persistence

WASSILY = PERSONA_BY_ID["hoeffding"]


def small_cycle(cycle_id: int, run_id: int):
    return generate_cycle(CycleInput(
        cycle_id=cycle_id, run_id=run_id, model=zero_model(hour_sin=1.0), median_holders=200, dow=1,
        names=WASSILY.ideas.names, suffixes=WASSILY.ideas.suffixes, lores=WASSILY.ideas.lores,
        auc=0.6, floor=0.5, n=5, now=NOW,
    ))


def test_state_is_saved_atomically(tmp_path):
    p = Persistence(tmp_path / "data")
    assert p.load() is None
    p.save({"version": 2, "runId": 440})
    assert p.load() == {"version": 2, "runId": 440}
    assert not list((tmp_path / "data").glob("*.tmp"))


def test_unknown_versions_and_corrupt_files_are_ignored(tmp_path):
    p = Persistence(tmp_path)
    p.save({"version": 9})
    assert p.load() is None
    p.state_file.write_text("{", encoding="utf-8")
    assert p.load() is None


def test_commitment_log_is_append_only_and_filterable(tmp_path):
    p = Persistence(tmp_path)
    p.append_cycle(small_cycle(1, 10), "hoeffding")
    p.append_cycle(small_cycle(2, 11), "hoeffding")
    p.append_cycle(small_cycle(2, 11), "kolmogorov")

    rows = p.read_commitments("hoeffding")
    assert len(rows) == 10
    assert [r["cycle_id"] for r in p.read_commitments("hoeffding", start=2)] == [2] * 5
    assert len(p.read_commitments("kolmogorov", end=1)) == 0
    assert all(verify_candidate(r["name"], r["lore"], r["hour"], r["run_id"], r["commitment"]) for r in rows)
    assert len(p.log_file.read_text(encoding="utf-8").splitlines()) == 15
    assert json.loads(p.log_file.read_text(encoding="utf-8").splitlines()[0])["rank"] == 1
