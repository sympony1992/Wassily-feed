#!/usr/bin/env python
"""Check a state.json written by the Next.js server against this package.

For the current cycle of every persona, re-hash each commitment and re-score
each candidate with the stored model of the run that produced it. Exits
non-zero on any mismatch.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from wassily.config.personas import PERSONAS  # noqa: E402
from wassily.engine.features import IdeaFeatures, featurize  # noqa: E402
from wassily.engine.model import predict_proba  # noqa: E402
from wassily.maths.commit import verify_candidate  # noqa: E402
from wassily.runtime.agent import Agent  # noqa: E402

DEFAULT_STATE = Path(__file__).resolve().parents[2] / "data" / "state.json"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--state", default=str(DEFAULT_STATE))
    parser.add_argument("--tolerance", type=float, default=1e-9)
    args = parser.parse_args()

    path = Path(args.state)
    if not path.exists():
        print(f"no snapshot at {path}; run the site with PERSIST=true first")
        return 2

    agent = Agent()
    agent.restore(json.loads(path.read_text(encoding="utf-8")))
    runs = {r.run_id: r for r in agent.runs}
    print(f"{path}: {len(agent.tokens)} tokens, {len(agent.runs)} runs")

    failures = 0
    for persona in PERSONAS:
        cycle = agent.ledger(persona.id).current
        if cycle is None:
            continue
        run = runs.get(cycle.run_id)
        bad_hashes = 0
        worst = 0.0
        for c in cycle.candidates:
            if not verify_candidate(c.name, c.lore, c.hour, cycle.run_id, c.commitment):
                bad_hashes += 1
            if run is not None:
                x = featurize(IdeaFeatures(name=c.name, lore=c.lore, hour=c.hour, dow=cycle.dow,
                                           holders=cycle.median_holders))
                worst = max(worst, abs(predict_proba(run.model, x) - c.score))
        note = "" if run else " (run no longer kept: scores not checked)"
        print(f"  {persona.id:<11} cycle {cycle.cycle_id} run {cycle.run_id}: {len(cycle.candidates)} candidates, "
              f"{bad_hashes} bad commitments, max score diff {worst:.1e}{note}")
        failures += bad_hashes + int(worst > args.tolerance)

    print("parity OK" if not failures else f"{failures} problem(s)")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
