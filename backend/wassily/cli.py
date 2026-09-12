"""Command line: ``python -m wassily <command>``."""

from __future__ import annotations

import argparse
import json
import sys
import time
from collections.abc import Sequence
from pathlib import Path
from typing import Any

from wassily import __version__


def _load_snapshot(path: str) -> dict[str, Any]:
    file = Path(path)
    if not file.exists():
        raise SystemExit(f"no snapshot at {file}")
    return json.loads(file.read_text(encoding="utf-8"))


def cmd_serve(args: argparse.Namespace) -> int:
    import uvicorn

    from wassily.config.settings import load_config

    config = load_config()
    uvicorn.run(
        "wassily.api.app:create_app",
        factory=True,
        host=args.host or config.host,
        port=args.port or config.port,
        reload=args.reload,
        log_level=config.log_level,
        proxy_headers=True,
    )
    return 0


def cmd_simulate(args: argparse.Namespace) -> int:
    from wassily.config.site import SITE
    from wassily.engine.proof import evaluate_model
    from wassily.engine.simulator import Market, to_training_row
    from wassily.engine.trainer import TrainOptions, train_run
    from wassily.maths.bounds import BOUND_BY_ID, BOUNDS
    from wassily.utils.timeutil import now_ms

    market = Market(args.seed)
    tokens = market.history(args.tokens, now_ms())
    started = time.perf_counter()
    run = train_run([to_training_row(t) for t in tokens], SITE.first_run_id, TrainOptions(resamples=args.resamples))
    elapsed = time.perf_counter() - started

    print(f"simulated {run.n} tokens, {run.n_positive} passed, trained in {elapsed:.2f}s")
    print(f"AUC {run.auc:.4f} ± {run.auc_std:.4f}  time-split gap {run.time_split_gap:.4f}  "
          f"bootstrap 2.5% {run.boot_lower:.4f}")
    print()
    print(f"{'bound':<18}{'epsilon':>9}{'floor':>9}{'jar':>7}  blocked by")
    bounds = [BOUND_BY_ID[b] for b in args.bound] if args.bound else list(BOUNDS)
    for bound in bounds:
        p = evaluate_model(run, bound)
        print(f"{bound.short:<18}{p.epsilon:>9.4f}{p.floor:>9.4f}{p.jar:>6.0%}  {p.blocked_by or '-'}")
    return 0


def cmd_train(args: argparse.Namespace) -> int:
    from wassily.api.serialize import model_json
    from wassily.engine.trainer import TrainOptions, train_run
    from wassily.maths.bounds import BOUND_BY_ID
    from wassily.runtime.agent import Agent

    agent = Agent(bound_id=args.bound)
    agent.restore(_load_snapshot(args.state))
    run = train_run(agent.training_rows(), args.run_id, TrainOptions(resamples=args.resamples))
    run.ran_at = "offline"
    bound = BOUND_BY_ID[args.bound] if args.bound else agent.bound
    json.dump(model_json(run, bound), sys.stdout, indent=2)
    print()
    return 0


def cmd_export_dataset(args: argparse.Namespace) -> int:
    import csv

    from wassily.runtime.agent import Agent

    agent = Agent()
    agent.restore(_load_snapshot(args.state))
    rows = agent.training_rows()
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.writer(fh)
        writer.writerow(["name", "hour", "dow", "holders", "lore_missing", "launched_at_ms", "passed"])
        for r in rows:
            writer.writerow([r.name, r.hour, r.dow, r.holders, int(r.lore_missing), int(r.launched_at), r.passed])
    print(f"wrote {len(rows)} labelled rows to {out}")
    return 0


def cmd_verify_commitments(args: argparse.Namespace) -> int:
    from wassily.maths.commit import verify_candidate

    path = Path(args.file)
    if not path.exists():
        raise SystemExit(f"no commitment log at {path}")
    checked = bad = 0
    with path.open(encoding="utf-8") as fh:
        for line_no, line in enumerate(fh, start=1):
            if not line.strip():
                continue
            row = json.loads(line)
            checked += 1
            if not verify_candidate(row["name"], row["lore"], int(row["hour"]), int(row["run_id"]), row["commitment"]):
                bad += 1
                print(f"line {line_no}: cycle {row['cycle_id']} rank {row['rank']} {row['name']!r} does not verify")
    print(f"{checked} commitments checked, {bad} failed")
    return 1 if bad else 0


def cmd_replay_cycle(args: argparse.Namespace) -> int:
    from wassily.config.personas import PERSONA_BY_ID
    from wassily.engine.ideas import CycleInput, generate_cycle
    from wassily.runtime.agent import Agent
    from wassily.utils.timeutil import parse_iso

    agent = Agent()
    agent.restore(_load_snapshot(args.state))
    ledger = agent.ledger(args.persona)
    cycle = ledger.cycle(args.cycle_id) if args.cycle_id else ledger.current
    if cycle is None:
        raise SystemExit("cycle not found in the snapshot")
    run = next((r for r in agent.runs if r.run_id == cycle.run_id), None)
    if run is None:
        raise SystemExit(f"run {cycle.run_id} is no longer kept, so its model cannot be replayed")

    started = parse_iso(cycle.started_at)
    deployed = {t.name.lower() for t in agent.tokens.values() if parse_iso(t.launched_at) < started}
    persona = PERSONA_BY_ID[args.persona] if args.persona else agent.persona_def
    replay = generate_cycle(CycleInput(
        cycle_id=cycle.cycle_id, run_id=cycle.run_id, model=run.model, median_holders=cycle.median_holders,
        dow=cycle.dow, names=persona.ideas.names, suffixes=persona.ideas.suffixes, lores=persona.ideas.lores,
        auc=cycle.model["auc"], floor=cycle.model["floor"], deployed_names=deployed, stolen_names=ledger.stolen,
        n=len(cycle.candidates), now=started,
    ))
    published = {c.commitment for c in cycle.candidates}
    replayed = {c.commitment for c in replay.candidates}
    print(f"cycle {cycle.cycle_id} (run {cycle.run_id}): {len(published & replayed)}/{len(published)} "
          f"commitments reproduced")
    return 0 if published <= replayed else 1


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="wassily", description="Survival agent research service")
    parser.add_argument("--version", action="version", version=f"wassily {__version__}")
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("serve", help="run the HTTP API and the ingest loop")
    p.add_argument("--host")
    p.add_argument("--port", type=int)
    p.add_argument("--reload", action="store_true")
    p.set_defaults(func=cmd_serve)

    p = sub.add_parser("simulate", help="train once on a simulated market and print every bound")
    p.add_argument("--tokens", type=int, default=2346)
    p.add_argument("--seed", type=int, default=20_260_911)
    p.add_argument("--resamples", type=int, default=500)
    p.add_argument("--bound", action="append", help="limit the table to these bound ids")
    p.set_defaults(func=cmd_simulate)

    p = sub.add_parser("train", help="retrain offline from a state.json snapshot")
    p.add_argument("--state", default="data/state.json")
    p.add_argument("--run-id", type=int, default=0)
    p.add_argument("--resamples", type=int, default=500)
    p.add_argument("--bound")
    p.set_defaults(func=cmd_train)

    p = sub.add_parser("export-dataset", help="write the labelled training rows to CSV")
    p.add_argument("--state", default="data/state.json")
    p.add_argument("--out", default="data/training_rows.csv")
    p.set_defaults(func=cmd_export_dataset)

    p = sub.add_parser("verify-commitments", help="re-hash every line of commitments.jsonl")
    p.add_argument("--file", default="data/commitments.jsonl")
    p.set_defaults(func=cmd_verify_commitments)

    p = sub.add_parser("replay-cycle", help="regenerate a published cycle from its model and compare commitments")
    p.add_argument("--state", default="data/state.json")
    p.add_argument("--persona")
    p.add_argument("--cycle-id", type=int)
    p.set_defaults(func=cmd_replay_cycle)

    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return int(args.func(args) or 0)
