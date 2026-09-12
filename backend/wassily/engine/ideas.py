"""Idea cycles: runs once per model retrain.

The cycle is seeded by sha256 of the run id, so anyone holding the model can
replay it. The filter runs before scoring, and every candidate is committed
before anything can display it.
"""

from __future__ import annotations

import re
from collections.abc import Sequence, Set
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

from wassily.engine.features import IdeaFeatures, featurize
from wassily.engine.model import predict_proba
from wassily.engine.types import Candidate, IdeaCycle, ScoringModel
from wassily.maths.commit import candidate_commitment, sha256_hex
from wassily.maths.stats import pick, rng_from_hex
from wassily.utils.timeutil import iso

_FLAGS = re.IGNORECASE | re.ASCII


@dataclass(frozen=True)
class ContentRule:
    id: str
    label: str
    pattern: re.Pattern[str] | None


CONTENT_RULES: tuple[ContentRule, ...] = (
    ContentRule("real_person", "No real person's name",
                re.compile(r"\b(elon|musk|trump|biden|vitalik|saylor|satoshi)\b", _FLAGS)),
    ContentRule("financial_promise", "No claims about returns, yield or price",
                re.compile(r"\b(guarantee[ds]?|profits?|returns?|yield|apy|\d+x|risk[- ]?free)\b", _FLAGS)),
    ContentRule("ticker_impersonation", "No impersonation of existing tickers",
                re.compile(r"\b(btc|eth|sol|pepe|doge|usdc|usdt)\b", _FLAGS)),
    ContentRule("near_duplicate", "No near-duplicates of deployed tokens", None),
)


@dataclass
class CycleInput:
    cycle_id: int
    run_id: int
    model: ScoringModel
    median_holders: float
    dow: int
    names: Sequence[str]
    suffixes: Sequence[str]
    lores: Sequence[str]
    auc: float
    floor: float
    deployed_names: Set[str] = field(default_factory=frozenset)  # every token name already on chain (casefolded)
    stolen_names: Set[str] = field(default_factory=frozenset)  # our own past ideas someone else deployed
    n: int = 100
    now: datetime | None = None


def _matching_rule(name: str, lore: str, key: str, spec: CycleInput) -> ContentRule | None:
    text = f"{name} {lore}"
    for rule in CONTENT_RULES:
        if rule.pattern is not None:
            if rule.pattern.search(text):
                return rule
        elif key in spec.deployed_names and key not in spec.stolen_names:
            return rule
    return None


def generate_cycle(spec: CycleInput) -> IdeaCycle:
    now = spec.now or datetime.now(timezone.utc)
    committed_at = iso(now)

    # Anyone holding the model and the run id can replay this exact cycle.
    seed = sha256_hex(str(spec.run_id))
    rng = rng_from_hex(seed)

    seen: set[str] = set()
    rejected: set[str] = set()  # count each rejected name once
    rule_hits: dict[str, int] = {}
    out: list[Candidate] = []
    n_rejected = 0
    n_excluded = 0

    attempt = 0
    while len(out) < spec.n and attempt < spec.n * 60:
        attempt += 1
        name = pick(rng, spec.names)
        if rng() < 0.35:
            name += pick(rng, spec.suffixes)
        lore = pick(rng, spec.lores)
        hour = int(rng() * 24)
        key = name.lower()

        # 1. Reject before scoring, never after: the filter must not shape the ranking.
        rule = _matching_rule(name, lore, key, spec)
        if rule is not None:
            if key not in rejected:
                rejected.add(key)
                n_rejected += 1
                rule_hits[rule.id] = rule_hits.get(rule.id, 0) + 1
            continue

        # 2. Case-folded uniqueness within the cycle.
        if key in seen:
            continue
        seen.add(key)

        # 3. Deployed by another address since we wrote it: ours no longer.
        if key in spec.stolen_names:
            n_excluded += 1
            continue

        # 4. Holders pinned at the dataset median, so only name, lore and hour move the score.
        x = featurize(IdeaFeatures(name=name, lore=lore, hour=hour, dow=spec.dow, holders=spec.median_holders))
        score = predict_proba(spec.model, x)

        # 5. Commit before anything can display it.
        out.append(Candidate(rank=0, name=name, lore=lore, hour=hour, score=score,
                             commitment=candidate_commitment(name, lore, hour, spec.run_id), committed_at=committed_at))

    out.sort(key=lambda c: -c.score)
    for i, c in enumerate(out):
        c.rank = i + 1

    return IdeaCycle(
        cycle_id=spec.cycle_id,
        run_id=spec.run_id,
        started_at=committed_at,
        seed=seed,
        median_holders=spec.median_holders,
        dow=spec.dow,
        n_generated=len(out),
        n_rejected=n_rejected,
        n_excluded=n_excluded,
        rule_hits=rule_hits,
        model={"auc": spec.auc, "floor": spec.floor},
        candidates=out,
    )


def generator_source() -> str:
    """This exact file, as the Brain page publishes it."""
    return Path(__file__).read_text(encoding="utf-8")


def generator_sha() -> str:
    return sha256_hex(generator_source())
