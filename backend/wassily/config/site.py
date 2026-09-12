"""Study, jar and simulator constants.

Mirrors ``src/config/site.ts`` so the Python and TypeScript runtimes agree on
every threshold. Change a number here and in the site config together.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class Gates:
    n_samples_min: int = 2000
    n_positive_min: int = 200
    auc_std_max: float = 0.05
    time_split_gap_max: float = 0.04
    jar_cap_when_blocked: float = 0.95


@dataclass(frozen=True)
class Site:
    chain: str = "Robinhood Chain"
    dexscreener_chain: str = "robinhood"

    # Study definition
    entry_mc: float = 10_000
    target_mc: float = 30_000
    holder_sample_hours: int = 48

    # Jar math
    auc_floor: float = 0.5
    auc_target: float = 0.6
    delta: float = 0.05
    capacity_d: int = 28
    cv_folds: int = 5
    bootstrap_resamples: int = 500
    gates: Gates = field(default_factory=Gates)

    # Simulated market
    seed_tokens: int = 2346
    cycle_seconds: int = 90
    arrival_ms: tuple[int, int] = (3000, 9000)
    prior_cycles: int = 6
    first_cycle_id: int = 1412
    first_run_id: int = 438

    # Ideas
    candidates_per_cycle: int = 100


SITE = Site()


def fmt_usd_k(value: float) -> str:
    return f"${round(value / 1000)}K"
