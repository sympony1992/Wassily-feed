import json

from conftest import NOW_MS

from wassily.cli import main
from wassily.engine.simulator import Market
from wassily.engine.trainer import TrainOptions
from wassily.runtime.agent import Agent
from wassily.store.persistence import Persistence


def snapshot_dir(tmp_path):
    persistence = Persistence(tmp_path)
    agent = Agent(train_options=TrainOptions(resamples=10), persistence=persistence)
    for t in Market(31).history(220, NOW_MS):
        agent.upsert(t, announce=False)
    agent.retrain_sync()
    return persistence


def test_simulate_prints_the_bound_table(capsys):
    assert main(["simulate", "--tokens", "220", "--resamples", "10", "--bound", "hoeffding", "--bound", "dkw"]) == 0
    out = capsys.readouterr().out
    assert "Hoeffding" in out and "Kolmogorov (DKW)" in out and "blocked by" in out


def test_train_from_a_snapshot(tmp_path, capsys):
    p = snapshot_dir(tmp_path)
    assert main(["train", "--state", str(p.state_file), "--resamples", "10"]) == 0
    model = json.loads(capsys.readouterr().out)
    assert model["n"] == 220 and "proven_floor" in model


def test_verify_commitments_catches_tampering(tmp_path, capsys):
    p = snapshot_dir(tmp_path)
    assert main(["verify-commitments", "--file", str(p.log_file)]) == 0

    lines = p.log_file.read_text(encoding="utf-8").splitlines()
    row = json.loads(lines[0])
    row["hour"] = (row["hour"] + 1) % 24
    lines[0] = json.dumps(row)
    p.log_file.write_text("\n".join(lines) + "\n", encoding="utf-8")
    assert main(["verify-commitments", "--file", str(p.log_file)]) == 1
    assert "does not verify" in capsys.readouterr().out


def test_replay_reproduces_the_published_cycle(tmp_path, capsys):
    p = snapshot_dir(tmp_path)
    assert main(["replay-cycle", "--state", str(p.state_file)]) == 0
    assert "commitments reproduced" in capsys.readouterr().out


def test_export_dataset(tmp_path, capsys):
    p = snapshot_dir(tmp_path)
    out = tmp_path / "rows.csv"
    assert main(["export-dataset", "--state", str(p.state_file), "--out", str(out)]) == 0
    assert len(out.read_text(encoding="utf-8").splitlines()) == 221
