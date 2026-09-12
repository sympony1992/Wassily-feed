"""UTC time helpers that produce the same ISO strings as ``Date.toISOString``."""

from __future__ import annotations

import math
import time
from datetime import datetime, timezone

HOUR_MS = 3_600_000
DAY_MS = 86_400_000


def now_ms() -> int:
    return int(time.time() * 1000)


def utc_from_ms(ms: float) -> datetime:
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc)


def to_ms(dt: datetime) -> int:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return int(round(dt.timestamp() * 1000))


def iso(value: datetime | float | int) -> str:
    """``2026-09-12T10:04:05.123Z``: millisecond precision, always UTC, always a Z."""
    ms = to_ms(value) if isinstance(value, datetime) else int(value)
    dt = utc_from_ms(ms)
    return dt.strftime("%Y-%m-%dT%H:%M:%S.") + f"{ms % 1000:03d}Z"


def parse_iso(value: str) -> datetime:
    text = value.strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    dt = datetime.fromisoformat(text)
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def iso_to_ms(value: str) -> int:
    return to_ms(parse_iso(value))


def utc_dow(dt: datetime) -> int:
    """Day of week with Monday = 0, as the feature map expects."""
    return dt.astimezone(timezone.utc).weekday()


def js_round(x: float) -> int:
    """``Math.round``: halves go up, unlike Python's banker's rounding."""
    return math.floor(x + 0.5)
