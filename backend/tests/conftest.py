from __future__ import annotations

import sys
from datetime import datetime, timezone
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from wassily.engine.features import D  # noqa: E402
from wassily.engine.types import ModelRun, ScoringModel  # noqa: E402

NOW = datetime(2026, 9, 12, 10, 0, tzinfo=timezone.utc)
NOW_MS = int(NOW.timestamp() * 1000)

TOKEN = "0x" + "ab" * 20
PAIR = "0x" + "cd" * 20
CREATOR = "0x" + "ef" * 20


def word(value: int | str) -> str:
    """One 32-byte ABI word as 64 hex chars (an int, or an address left-padded)."""
    if isinstance(value, int):
        return value.to_bytes(32, "big").hex()
    return value[2:].rjust(64, "0")


def zero_model(**weights: float) -> ScoringModel:
    from wassily.engine.features import FEATURE_NAMES

    w = [weights.get(name, 0.0) for name in FEATURE_NAMES]
    return ScoringModel(weights=w, bias=0.0, mu=[0.0] * D, sigma=[1.0] * D)


def make_run(**overrides) -> ModelRun:
    base = dict(
        run_id=438, n=2500, n_positive=600, d=D, auc=0.66, auc_std=0.02, fold_aucs=[0.65, 0.67],
        time_split_gap=0.01, boot_lower=0.63, feature_importance={}, hour_rates=[0.0] * 24,
        hour_counts=[0] * 24, median_holders=288, model=zero_model(hour_sin=1.5, lore_len=0.3),
    )
    base.update(overrides)
    return ModelRun(**base)


@pytest.fixture
def now() -> datetime:
    return NOW
