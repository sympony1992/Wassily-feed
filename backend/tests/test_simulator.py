from conftest import NOW_MS

from wassily.config.site import SITE
from wassily.engine.simulator import Market, simulated_block_number, to_training_row
from wassily.utils.timeutil import HOUR_MS, iso_to_ms, parse_iso


def test_history_is_sorted_labelled_and_old_enough():
    tokens = Market(1).history(300, NOW_MS)
    stamps = [iso_to_ms(t.launched_at) for t in tokens]
    assert stamps == sorted(stamps)
    assert max(stamps) <= NOW_MS - SITE.holder_sample_hours * HOUR_MS
    for t in tokens:
        assert t.status in ("passed", "stalled")
        assert t.peak_mc >= SITE.entry_mc
        assert (t.peak_mc >= SITE.target_mc) == (t.status == "passed")
        assert t.holders >= 12 and t.mint.startswith("0x") and len(t.mint) == 42


def test_market_is_deterministic():
    assert [t.mint for t in Market(4).history(20, NOW_MS)] == [t.mint for t in Market(4).history(20, NOW_MS)]


def test_survival_rate_is_plausible():
    tokens = Market(2).history(2000, NOW_MS)
    rate = sum(t.status == "passed" for t in tokens) / len(tokens)
    assert 0.1 < rate < 0.5


def test_copycat_arrival_keeps_the_name():
    t = Market(3).arrival(NOW_MS, "Honest Mean Ledger")
    assert t.name == "Honest Mean Ledger" and t.symbol == "HML"


def test_training_row_never_sees_price():
    t = Market(5).arrival(NOW_MS)
    row = to_training_row(t)
    assert row.passed == (1 if t.status == "passed" else 0)
    assert row.lore_missing == (not (t.lore_raw or "").strip())
    assert not hasattr(row, "peak_mc")


def test_simulated_block_numbers_increase():
    a = simulated_block_number(parse_iso("2026-09-10T00:00:00.000Z"))
    b = simulated_block_number(parse_iso("2026-09-10T00:00:01.000Z"))
    assert a == 19_482_000 and b - a == 4
