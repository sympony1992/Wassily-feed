from __future__ import annotations

import csv
import io
from typing import Any

from fastapi import APIRouter, Depends
from fastapi.responses import Response

from wassily.api.deps import get_runtime
from wassily.config.site import SITE
from wassily.engine.features import D, FEATURE_NAMES
from wassily.engine.ideas import CONTENT_RULES, generator_sha
from wassily.runtime.runtime import Runtime

router = APIRouter(tags=["open data"])

CSV_COLUMNS = ("mint", "name", "symbol", "launched_at", "launch_hour", "dow", "holders", "lore_words", "lore_missing",
               "peak_mc", "status")

KNOWN_LIMITS = (
    "Sampled history: the backfill looks up a uniform random share of past launches by address.",
    "Resolution: Pons peaks use every trade; other venues use hourly candles.",
    "Unusual quote assets: a token launched only against a rarely used quote asset may be missed.",
    "No lore: descriptions are not on-chain, so lore is not a live feature.",
)


@router.get("/api/dataset.csv")
def dataset_csv(rt: Runtime = Depends(get_runtime)) -> Response:
    buf = io.StringIO()
    writer = csv.writer(buf, lineterminator="\n")
    writer.writerow(CSV_COLUMNS)
    for t in sorted(rt.agent.labelled(), key=lambda t: t.launched_at):
        lore = t.lore_raw if t.lore_raw is not None else t.lore
        writer.writerow((t.mint, t.name, t.symbol, t.launched_at, t.hour, t.dow,
                         "" if t.holders_missing else t.holders, len(lore.split()), int(not lore.strip()),
                         t.peak_mc, t.status))
    return Response(
        buf.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"content-disposition": 'attachment; filename="dataset.csv"'},
    )


@router.get("/api/methodology.json")
def methodology(rt: Runtime = Depends(get_runtime)) -> dict[str, Any]:
    bound = rt.agent.bound
    g = SITE.gates
    return {
        "name": rt.agent.persona_def.mascot,
        "chain": SITE.chain,
        "source": rt.config.source,
        "study": {
            "entry_mc_usd": SITE.entry_mc,
            "target_mc_usd": SITE.target_mc,
            "label_window_hours": SITE.holder_sample_hours,
            "labels": {"below_entry": "leaves the study", "at_or_above_target": "passed", "otherwise": "stalled"},
        },
        "features": {"d": D, "names": list(FEATURE_NAMES), "never_used": ["price", "volume", "liquidity"]},
        "model": {
            "type": "logistic regression",
            "fit": "Newton's method (IRLS)",
            "regularisation": "L2, lambda = 1",
            "class_weighting": "balanced",
            "validation": {
                "cv_folds": SITE.cv_folds,
                "time_split": "train on the oldest 70%, test on the newest 30%",
                "bootstrap_resamples": SITE.bootstrap_resamples,
            },
        },
        "bound": {"id": bound.id, "name": bound.name, "formula": bound.formula, "delta": SITE.delta},
        "jar": {"auc_floor": SITE.auc_floor, "auc_target": SITE.auc_target, "cap_when_blocked": g.jar_cap_when_blocked},
        "gates": {
            "n_samples_min": g.n_samples_min,
            "n_positive_min": g.n_positive_min,
            "auc_std_max": g.auc_std_max,
            "time_split_gap_max": g.time_split_gap_max,
        },
        "ideas": {
            "per_cycle": SITE.candidates_per_cycle,
            "seed": "sha256(run_id)",
            "commitment": "sha256(name 0x1f lore 0x1f hour 0x1f run_id)",
            "generator_sha256": generator_sha(),
            "rules": [r.id for r in CONTENT_RULES],
        },
        "known_limits": list(KNOWN_LIMITS),
    }
