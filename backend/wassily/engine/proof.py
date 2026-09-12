"""The jar: a bound's floor, capped until every validation gate passes."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from wassily.config.site import SITE, Site
from wassily.maths.bounds import BoundDef, BoundInput, confidence_label, jar_fraction

GATE_KEYS = ("n_samples", "n_positive", "auc_std", "time_split")


class ModelStats(Protocol):
    n: int
    n_positive: int
    auc: float
    auc_std: float
    d: int
    boot_lower: float
    time_split_gap: float
    gates_override: dict[str, bool] | None


@dataclass(frozen=True)
class ProofView:
    epsilon: float
    floor: float
    pending: bool
    gates: dict[str, bool]
    blocked_by: str | None
    raw_jar: float
    jar: float
    unlocked: bool  # floor >= target and nothing blocking: a launch is allowed
    confidence: str


def evaluate_model(m: ModelStats, bound: BoundDef, site: Site = SITE) -> ProofView:
    result = bound.compute(
        BoundInput(n=m.n, n_pos=m.n_positive, auc=m.auc, auc_std=m.auc_std, d=m.d, delta=site.delta,
                   boot_lower=m.boot_lower)
    )

    # Every gate must pass before the jar may read 100%.
    g = site.gates
    gates = {
        "n_samples": m.n >= g.n_samples_min,
        "n_positive": m.n_positive >= g.n_positive_min,
        "auc_std": m.auc_std < g.auc_std_max,
        "time_split": m.time_split_gap <= g.time_split_gap_max,
    }
    if getattr(m, "gates_override", None):
        gates.update(m.gates_override or {})
    blocked_by = next((k for k in gates if not gates[k]), None)

    raw_jar = jar_fraction(result.floor, site.auc_floor, site.auc_target)
    jar = min(raw_jar, g.jar_cap_when_blocked) if blocked_by else raw_jar

    return ProofView(
        epsilon=result.epsilon,
        floor=result.floor,
        pending=result.pending,
        gates=gates,
        blocked_by=blocked_by,
        raw_jar=raw_jar,
        jar=jar,
        unlocked=jar >= 1,
        confidence=confidence_label(result.floor),
    )
