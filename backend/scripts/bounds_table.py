#!/usr/bin/env python
"""Print the README's worked example for any measured AUC: epsilon, floor and jar by number of survivors."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from wassily.config.site import SITE  # noqa: E402
from wassily.maths.bounds import hoeffding_epsilon, jar_fraction  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--auc", type=float, default=0.65)
    parser.add_argument("--delta", type=float, default=SITE.delta)
    parser.add_argument("survivors", nargs="*", type=int, default=[100, 200, 600, 1000])
    args = parser.parse_args()

    print(f"Measured AUC {args.auc}, delta = {args.delta}\n")
    print("| Survivors *m* | ε | Floor | Jar |")
    print("|---|---|---|---|")
    for m in args.survivors:
        eps = hoeffding_epsilon(m, m, args.delta)
        floor = args.auc - eps
        jar = jar_fraction(floor, SITE.auc_floor, SITE.auc_target)
        shown = "full*" if jar >= 1 else f"{jar:.0%}"
        print(f"| {m:,} | {eps:.3f} | {floor:.3f} | {shown} |")
    print("\n*Only once every gate passes. Until then the jar stops at "
          f"{SITE.gates.jar_cap_when_blocked:.0%}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
