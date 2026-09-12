"""JSON shapes of the public API (snake_case, compatible with the site's client)."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from wassily.config.site import SITE
from wassily.engine.findings import compute_findings
from wassily.engine.proof import evaluate_model
from wassily.engine.types import EliminatedItem, ExclusionItem, IdeaCycle, ModelRun, Token
from wassily.maths.bounds import BoundDef, confidence_label, vc_epsilon
from wassily.utils.timeutil import iso

if TYPE_CHECKING:
    from wassily.runtime.runtime import Runtime

MAX_STATE_TOKENS = 400


def r4(value: float) -> float:
    return round(value, 4)


def token_json(t: Token, chain: str) -> dict[str, Any]:
    return {
        "mint": t.mint,
        "chain": chain,
        "name": t.name,
        "symbol": t.symbol,
        "lore": t.lore,
        "lore_withheld": t.lore_withheld,
        "logo": t.logo,
        "creator": t.deployer or None,
        "launched_at": t.launched_at,
        "launch_hour": t.hour,
        "holders": None if t.holders_missing else t.holders,
        "peak_mc": t.peak_mc,
        "status": t.status,
    }


def model_json(run: ModelRun, bound: BoundDef) -> dict[str, Any]:
    proof = evaluate_model(run, bound)
    return {
        "id": run.run_id,
        "ran_at": run.ran_at,
        "n": run.n,
        "n_positive": run.n_positive,
        "d": run.d,
        "auc": r4(run.auc),
        "auc_std": r4(run.auc_std),
        "fold_aucs": [r4(a) for a in run.fold_aucs],
        "time_split_gap": r4(run.time_split_gap),
        "auc_boot_lower": r4(run.boot_lower),
        "epsilon_vc": r4(vc_epsilon(run.n, run.d, SITE.delta)),
        "bound": bound.id,
        "epsilon": r4(proof.epsilon),
        "proven_floor": r4(proof.floor),
        "jar_level": r4(proof.jar),
        "gates": proof.gates,
        "blocked_by": proof.blocked_by,
        "confidence": proof.confidence,
        "hour_rates": {str(h): round(rate, 3) for h, rate in enumerate(run.hour_rates)},
        "hour_counts": run.hour_counts,
        "feature_importance": {k: r4(v) for k, v in run.feature_importance.items()},
        "median_holders": run.median_holders,
    }


def state_json(rt: Runtime) -> dict[str, Any]:
    agent, config = rt.agent, rt.config
    f = compute_findings(agent.labelled())
    tokens = sorted(agent.tokens.values(), key=lambda t: t.launched_at, reverse=True)[:MAX_STATE_TOKENS]
    return {
        "source": config.source,
        "chain": config.chain,
        "persona": config.persona,
        "bound": agent.bound.id,
        "started_at": rt.started_at,
        "next_cycle_at": iso(agent.next_cycle_at) if agent.next_cycle_at else None,
        "cycle_number": len(agent.runs),
        "counters": agent.counters(),
        "warmup": agent.warmup(),
        "backfill": rt.backfill(),
        "findings": {
            "hour_counts": f.hour_all,
            "hour_wins": f.hour_win,
            "baseline": r4(f.baseline),
            "lift": [w.to_json() for w in f.lift],
            "lore_corr": r4(f.lore_corr),
        },
        "latest_model": model_json(agent.latest, agent.bound) if agent.latest else None,
        "tokens": [token_json(t, config.chain) for t in tokens],
    }


def cycle_json(cycle: IdeaCycle, generator_sha: str, persona: str) -> dict[str, Any]:
    """A published cycle exactly as recorded: floor and scores are never recomputed with a newer model."""
    return {
        "persona": persona,
        "cycle_id": cycle.cycle_id,
        "run_id": cycle.run_id,
        "generator_sha": generator_sha,
        "started_at": cycle.started_at,
        "seed": cycle.seed,
        "median_holders": cycle.median_holders,
        "dow": cycle.dow,
        "n_generated": cycle.n_generated,
        "n_rejected": cycle.n_rejected,
        "n_excluded": cycle.n_excluded,
        "rule_hits": cycle.rule_hits,
        "model": {
            "auc": r4(cycle.model["auc"]),
            "proven_floor": r4(cycle.model["floor"]),
            "confidence": confidence_label(cycle.model["floor"]),
        },
        "candidates": [
            {
                "rank": c.rank,
                "name": c.name,
                "lore": c.lore,
                "hour": c.hour,
                "score": round(c.score, 6),
                "commitment": c.commitment,
                "committed_at": c.committed_at,
            }
            for c in cycle.candidates
        ],
    }


def eliminated_json(e: EliminatedItem) -> dict[str, Any]:
    return {
        "name": e.name,
        "lore": e.lore,
        "led_cycle": e.led_cycle,
        "peak_score": r4(e.peak_score),
        "current_score": r4(e.current_score),
        "current_rank": e.current_rank,
        "demoted_cycle": e.demoted_cycle,
    }


def exclusion_json(x: ExclusionItem) -> dict[str, Any]:
    return {
        "name": x.name,
        "first_cycle": x.first_cycle,
        "first_seen_at": x.first_seen_at,
        "deployed_mint": x.deployed_mint,
        "deployer": x.deployer,
        "deployed_at": x.deployed_at,
        "block_number": x.block_number,
        "time_gap_seconds": x.time_gap_seconds,
    }
