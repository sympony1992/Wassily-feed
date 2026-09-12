"""What the Console reports: survival by launch hour, lore words with lift, and lore-length correlation."""

from __future__ import annotations

import math
import re
from collections.abc import Iterable
from dataclasses import dataclass, field

from wassily.engine.types import LiftWord, Token

STOPWORDS = frozenset(
    "a an and the of in on to it is was with by for one no not that this has been who at from then too very "
    "since there now every keeps says does".split()
)
MIN_WORD_COUNT = 60
TOP_WORDS = 6
_WORD = re.compile(r"[a-z]+")


@dataclass
class Findings:
    hour_all: list[int] = field(default_factory=lambda: [0] * 24)
    hour_win: list[int] = field(default_factory=lambda: [0] * 24)
    baseline: float = 0.0
    lift: list[LiftWord] = field(default_factory=list)
    lore_corr: float = 0.0


def compute_findings(labelled: Iterable[Token]) -> Findings:
    f = Findings()
    word_all: dict[str, int] = {}
    word_win: dict[str, int] = {}
    n = 0
    passes = 0
    sx = 0.0
    sxy = 0.0
    sxx = 0.0

    for t in labelled:
        n += 1
        passed = t.status == "passed"
        f.hour_all[t.hour] += 1
        if passed:
            f.hour_win[t.hour] += 1
            passes += 1
        text = t.lore_raw if t.lore_raw is not None else t.lore
        words = set(_WORD.findall(text.lower()))
        for w in words:
            word_all[w] = word_all.get(w, 0) + 1
            if passed:
                word_win[w] = word_win.get(w, 0) + 1
        x = len(words)
        sx += x
        sxx += x * x
        if passed:
            sxy += x

    f.baseline = passes / n if n else 0.0
    f.lift = sorted(
        (
            LiftWord(word=w, n=count, lift=(word_win.get(w, 0) / count / f.baseline) if f.baseline else 0.0)
            for w, count in word_all.items()
            if count >= MIN_WORD_COUNT and w not in STOPWORDS
        ),
        key=lambda lw: -lw.lift,
    )[:TOP_WORDS]

    # Point-biserial correlation between lore length and survival.
    den_sq = (n * sxx - sx * sx) * (n * passes - passes * passes)
    f.lore_corr = (n * sxy - sx * passes) / math.sqrt(den_sq) if den_sq > 0 else 0.0
    return f
