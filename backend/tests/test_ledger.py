import json
from datetime import timedelta

from conftest import NOW, make_run, zero_model

from wassily.config.personas import PERSONA_BY_ID
from wassily.engine.ledger import Deployment, IdeaLedger
from wassily.maths.bounds import BOUND_BY_ID

WASSILY = PERSONA_BY_ID["hoeffding"]
HOEFFDING = BOUND_BY_ID["hoeffding"]


def publish(ledger, run_id, sign=1.0, at=NOW):
    run = make_run(run_id=run_id, model=zero_model(hour_sin=3 * sign, lore_len=-0.5 * sign))
    return ledger.publish(run, WASSILY, HOEFFDING, set(), at)


def test_cycle_ids_advance_and_leader_changes_are_recorded():
    ledger = IdeaLedger(1412)
    first = publish(ledger, 1)
    second = publish(ledger, 2, sign=-1, at=NOW + timedelta(hours=1))
    assert (first.cycle_id, second.cycle_id) == (1412, 1413)
    assert ledger.current is second
    if second.candidates[0].name != first.candidates[0].name:
        record = ledger.eliminated[0]
        assert record.name == first.candidates[0].name
        assert (record.led_cycle, record.demoted_cycle) == (1412, 1413)
    else:
        assert not ledger.eliminated


def test_theft_is_recorded_once_with_its_time_gap():
    ledger = IdeaLedger(1)
    cycle = publish(ledger, 7)
    name = cycle.candidates[3].name
    hit = ledger.find_committed(name.upper())
    assert hit is not None and hit[1].name == name
    record = ledger.record_theft(*hit, Deployment("0xabc", "0xdef", NOW + timedelta(seconds=90), 123))
    assert record.time_gap_seconds == 90 and record.first_cycle == 1
    assert ledger.find_committed(name) is None
    assert ledger.exclusions == [record]


def test_snapshot_round_trips_through_json():
    ledger = IdeaLedger(1412)
    publish(ledger, 1)
    publish(ledger, 2, sign=-1)
    ledger.stolen.add("bounded sum")
    restored = IdeaLedger(1412)
    restored.restore(json.loads(json.dumps(ledger.snapshot())))
    assert [c.cycle_id for c in restored.cycles] == [1412, 1413]
    assert restored.current.candidates == ledger.current.candidates
    assert restored.stolen == {"bounded sum"}
    assert publish(restored, 3).cycle_id == 1414


def test_only_the_newest_cycles_are_kept():
    ledger = IdeaLedger(1, keep=3)
    for run_id in range(5):
        publish(ledger, run_id)
    assert [c.cycle_id for c in ledger.cycles] == [3, 4, 5]
    assert ledger.cycle(1) is None and ledger.cycle(5) is ledger.current
