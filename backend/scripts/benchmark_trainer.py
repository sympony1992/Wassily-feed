#!/usr/bin/env python
"""Time one full retrain on the simulated market with numpy and with the pure-Python IRLS path."""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from wassily.engine import model  # noqa: E402
from wassily.engine.simulator import Market, to_training_row  # noqa: E402
from wassily.engine.trainer import TrainOptions, train_run  # noqa: E402
from wassily.utils.timeutil import now_ms  # noqa: E402


def timed(rows, use_numpy: bool, resamples: int):
    model.USE_NUMPY = use_numpy
    started = time.perf_counter()
    run = train_run(rows, 438, TrainOptions(resamples=resamples))
    return time.perf_counter() - started, run


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tokens", type=int, default=2346)
    parser.add_argument("--resamples", type=int, default=500)
    parser.add_argument("--skip-python", action="store_true", help="only time the numpy path")
    args = parser.parse_args()

    rows = [to_training_row(t) for t in Market().history(args.tokens, now_ms())]
    print(f"{len(rows)} rows, {sum(r.passed for r in rows)} passed, {args.resamples} bootstrap resamples")

    results = {}
    if model._np is not None:
        results["numpy"] = timed(rows, True, args.resamples)
    if not args.skip_python:
        results["python"] = timed(rows, False, args.resamples)

    for name, (seconds, run) in results.items():
        print(f"{name:<7} {seconds:7.2f}s  auc={run.auc:.6f}  boot_lower={run.boot_lower:.6f}")
    if len(results) == 2:
        gap = abs(results["numpy"][1].auc - results["python"][1].auc)
        print(f"AUC difference between paths: {gap:.2e}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
