import json

from conftest import NOW_MS, make_run

from wassily.engine.simulator import Market
from wassily.engine.types import EliminatedItem, ModelRun, Token, camel


def test_camel_case_keys():
    assert camel("n_positive") == "nPositive"
    assert camel("time_split_gap") == "timeSplitGap"
    assert camel("mu") == "mu"


def test_token_round_trip_uses_state_json_keys():
    t = Market(3).history(1, NOW_MS)[0]
    data = t.to_json()
    assert {"launchedAt", "loreRaw", "peakMc", "loreWithheld"} <= set(data)
    assert "holdersMissing" not in data
    assert Token.from_json(json.loads(json.dumps(data))) == t


def test_reads_a_snapshot_written_by_the_site():
    written_by_node = {
        "mint": "0xabc", "name": "Velvet Otter", "symbol": "VOTT", "lore": "", "loreRaw": "", "loreWithheld": False,
        "holders": 0, "peakMc": 31000, "status": "passed", "hour": 13, "dow": 2,
        "launchedAt": "2026-09-01T13:05:00.000Z", "deployer": "", "hue": 12, "holdersMissing": True,
        "someFutureField": 1,
    }
    t = Token.from_json(written_by_node)
    assert t.holders_missing is True and t.peak_mc == 31000


def test_model_run_round_trip_restores_the_nested_model():
    run = make_run()
    restored = ModelRun.from_json(json.loads(json.dumps(run.to_json())))
    assert restored == run
    assert restored.model.weights == run.model.weights


def test_eliminated_item_keeps_a_null_rank():
    item = EliminatedItem("Kernel", "lore", 1, 0.8, 0.4, None, 2)
    assert item.to_json()["currentRank"] is None
