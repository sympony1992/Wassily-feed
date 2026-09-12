import pytest

from wassily.engine.findings import compute_findings
from wassily.engine.types import Token


def token(i: int, hour: int, passed: bool, lore: str) -> Token:
    return Token(
        mint=f"0x{i:040x}", name=f"T{i}", symbol="T", lore=lore, lore_raw=lore, lore_withheld=False, holders=100,
        peak_mc=40_000 if passed else 12_000, status="passed" if passed else "stalled", hour=hour, dow=0,
        launched_at="2026-09-01T00:00:00.000Z", deployer="", hue=0,
    )


def test_hours_baseline_and_lift():
    tokens = [token(i, 14, i < 60, "patient builders") for i in range(100)]
    tokens += [token(100 + i, 3, i < 20, "moon soon") for i in range(100)]
    f = compute_findings(tokens)
    assert f.hour_all[14] == 100 and f.hour_win[14] == 60
    assert f.hour_all[3] == 100 and f.hour_win[3] == 20
    assert f.baseline == 0.4
    assert {w.word for w in f.lift[:2]} == {"patient", "builders"}
    assert f.lift[0].lift == pytest.approx(1.5) and f.lift[-1].lift == pytest.approx(0.5)
    assert f.lore_corr == 0  # every lore has two words: no variance to correlate


def test_rare_words_and_stopwords_are_ignored():
    tokens = [token(i, 1, i % 2 == 0, "the quiet one") for i in range(80)] + [token(99, 1, True, "rare")]
    words = {w.word for w in compute_findings(tokens).lift}
    assert words == {"quiet"}


def test_empty_input():
    f = compute_findings([])
    assert f.baseline == 0 and f.lift == [] and sum(f.hour_all) == 0
