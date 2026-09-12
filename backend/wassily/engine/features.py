"""Feature map: 2 hour + 7 weekday + 1 holders + 3 text-shape + 15 hashed lore words = 28 = d.

Nothing derived from price, volume or liquidity is ever a feature.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass
from typing import Protocol

LORE_DIMS = 15

FEATURE_NAMES: tuple[str, ...] = (
    "hour_sin",
    "hour_cos",
    *(f"dow_{i}" for i in range(7)),
    "holders_log",
    "lore_len",
    "lore_missing",
    "name_tokens",
    *(f"lore_hash_{i + 1}" for i in range(LORE_DIMS)),
)
D = len(FEATURE_NAMES)

_LORE_WORD = re.compile(r"[a-z0-9']+")


class FeatureInput(Protocol):
    hour: int
    dow: int
    holders: float
    lore: str
    lore_missing: bool
    name: str


@dataclass(frozen=True)
class IdeaFeatures:
    """A candidate idea being scored: holders are pinned by the caller."""

    name: str
    lore: str
    hour: int
    dow: int
    holders: float
    lore_missing: bool = False


def fnv1a(s: str) -> int:
    """32-bit FNV-1a over UTF-16 code units, matching ``charCodeAt`` on the site."""
    h = 0x811C9DC5
    data = s.encode("utf-16-le")
    for i in range(0, len(data), 2):
        h ^= data[i] | (data[i + 1] << 8)
        h = (h * 0x01000193) & 0xFFFFFFFF
    return h


def featurize(t: FeatureInput) -> list[float]:
    out = [0.0] * D
    out[0] = math.sin(2 * math.pi * t.hour / 24)
    out[1] = math.cos(2 * math.pi * t.hour / 24)
    out[2 + t.dow] = 1.0
    out[9] = math.log1p(t.holders)

    words = _LORE_WORD.findall(t.lore.lower())
    out[10] = float(len(words))
    out[11] = 1.0 if t.lore_missing else 0.0
    out[12] = float(len(t.name.split()))

    # Hashing trick: each word lands in one of 15 buckets with a +/-1 sign.
    for w in words:
        h = fnv1a(w)
        out[13 + h % LORE_DIMS] += 1.0 if (h >> 16) & 1 else -1.0
    norm = math.sqrt(sum(v * v for v in out[13:]))
    if norm > 0:
        for i in range(13, D):
            out[i] /= norm
    return out


FEATURE_GROUPS: tuple[tuple[str, str], ...] = (
    ("holders_log", "Holders at 48h (log scale)"),
    ("hour_cos", "Launch hour · cosine of the 24h cycle"),
    ("hour_sin", "Launch hour · sine of the 24h cycle"),
    ("dow", "Day-of-week pattern"),
    ("lore_words", "Lore wording (hashed bag of words)"),
    ("lore_len", "Lore length"),
    ("lore_missing", "Lore missing"),
    ("name_tokens", "Words in the name"),
)


def feature_group(name: str) -> str:
    if name.startswith("dow_"):
        return "dow"
    if name.startswith("lore_hash_"):
        return "lore_words"
    return name


def grouped_importance(importance: dict[str, float]) -> dict[str, float]:
    out: dict[str, float] = {key: 0.0 for key, _ in FEATURE_GROUPS}
    for name, value in importance.items():
        out[feature_group(name)] = out.get(feature_group(name), 0.0) + value
    return out
