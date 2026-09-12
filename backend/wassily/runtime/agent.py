"""Server-side agent.

Owns the token set, retrains every cycle, publishes an idea cycle for every
persona, and records thefts. Events: token, model, cycle, exclusion.
"""

from __future__ import annotations

import asyncio
import contextlib
from dataclasses import replace
from datetime import datetime, timezone
from typing import Any

from wassily.config.personas import PERSONA_BY_ID, PERSONAS, Persona, is_persona_id
from wassily.config.site import SITE
from wassily.engine.ledger import Deployment, IdeaLedger
from wassily.engine.simulator import simulated_block_number, to_training_row
from wassily.engine.trainer import MIN_ROWS, TrainOptions, train_run
from wassily.engine.types import ModelRun, Token, TrainingRow
from wassily.maths.bounds import BOUND_BY_ID, BoundDef
from wassily.maths.stats import median
from wassily.runtime.events import EventBus
from wassily.store.persistence import Persistence
from wassily.utils.logging import get_logger
from wassily.utils.timeutil import HOUR_MS, iso, iso_to_ms, now_ms, parse_iso

log = get_logger("agent")

MAX_RUNS = 24 * 30  # a month of hourly runs for /api/model/history
SNAPSHOT_VERSION = 2


class Agent:
    def __init__(
        self,
        persona: str = "hoeffding",
        bound_id: str | None = None,
        cycle_seconds: int = SITE.cycle_seconds,
        *,
        events: EventBus | None = None,
        persistence: Persistence | None = None,
        source: str = "simulated",
        train_options: TrainOptions | None = None,
    ) -> None:
        self.persona = persona if is_persona_id(persona) else "hoeffding"
        self.bound_id = bound_id
        self.cycle_seconds = cycle_seconds
        # Not `events or EventBus()`: an EventBus with no subscribers is falsy (it has __len__).
        self.events = events if events is not None else EventBus()
        self.persistence = persistence
        self.source = source
        self.train_options = train_options or TrainOptions(folds=SITE.cv_folds, resamples=SITE.bootstrap_resamples)

        self.tokens: dict[str, Token] = {}  # key: lowercased address
        self.runs: list[ModelRun] = []
        self.ledgers: dict[str, IdeaLedger] = {p.id: IdeaLedger(SITE.first_cycle_id) for p in PERSONAS}
        self.next_cycle_at = 0
        self._run_id = SITE.first_run_id
        self._task: asyncio.Task[None] | None = None
        self._lock: asyncio.Lock | None = None

    # -- lookups ---------------------------------------------------------------

    @property
    def persona_def(self) -> Persona:
        return PERSONA_BY_ID[self.persona]

    @property
    def bound(self) -> BoundDef:
        return self.bound_for(self.persona_def)

    def bound_for(self, persona: Persona) -> BoundDef:
        return BOUND_BY_ID[self.bound_id or persona.default_bound]

    @property
    def latest(self) -> ModelRun | None:
        return self.runs[-1] if self.runs else None

    def ledger(self, persona: str | None = None) -> IdeaLedger:
        return self.ledgers[persona if persona and is_persona_id(persona) else self.persona]

    def labelled(self) -> list[Token]:
        return [t for t in self.tokens.values() if t.status != "pending"]

    def deployed_names(self) -> set[str]:
        return {t.name.lower() for t in self.tokens.values()}

    # -- tokens ----------------------------------------------------------------

    def upsert(self, token: Token, announce: bool = True, block_number: int | None = None) -> bool:
        key = token.mint.lower()
        is_new = key not in self.tokens
        self.tokens[key] = token
        if is_new:
            self._check_theft(token, block_number)
        if announce:
            self.events.publish("token", {"token": token, "counters": self.counters()})
        return is_new

    def _check_theft(self, token: Token, block_number: int | None) -> None:
        """Someone deployed a name we committed earlier: that is the theft record."""
        launched = parse_iso(token.launched_at)
        for p in PERSONAS:
            ledger = self.ledgers[p.id]
            hit = ledger.find_committed(token.name)
            if hit is None or launched <= parse_iso(hit[1].committed_at):
                continue
            block = block_number if block_number is not None else simulated_block_number(launched)
            record = ledger.record_theft(
                hit[0], hit[1], Deployment(mint=token.mint, deployer=token.deployer or "unknown", at=launched,
                                           block_number=block)
            )
            log.info("%s: %r was deployed by %s after we committed it", p.id, record.name, record.deployer)
            self.events.publish("exclusion", {"persona": p.id, "record": record})

    def counters(self) -> dict[str, int]:
        passed = stalled = pending = 0
        for t in self.tokens.values():
            if t.status == "passed":
                passed += 1
            elif t.status == "stalled":
                stalled += 1
            else:
                pending += 1
        return {
            "tokens": len(self.tokens),
            "labelled": passed + stalled,
            "passed": passed,
            "stalled": stalled,
            "pending": pending,
            "cycles": len(self.runs),
        }

    def warmup(self) -> dict[str, Any]:
        c = self.counters()
        pending = [iso_to_ms(t.launched_at) for t in self.tokens.values() if t.status == "pending"]
        next_label = min(pending) + SITE.holder_sample_hours * HOUR_MS if pending else None
        latest = self.latest
        return {
            "labelled": c["labelled"],
            "target": SITE.gates.n_samples_min,
            "ready": latest is not None and latest.n >= MIN_ROWS,
            "watching": c["pending"],
            "next_label_at": iso(next_label) if next_label is not None else None,
        }

    # -- training ----------------------------------------------------------------

    def training_rows(self) -> list[TrainingRow]:
        labelled = sorted(self.labelled(), key=lambda t: t.launched_at)
        known = [t.holders for t in labelled if not t.holders_missing]
        fill = median(known) if known else 0
        rows: list[TrainingRow] = []
        for t in labelled:
            row = to_training_row(t)
            if t.holders_missing:
                row.holders = fill  # no explorer configured: imputed with the median
            rows.append(row)
        return rows

    async def retrain(self, at: datetime | None = None, quick: bool = False) -> ModelRun:
        if self._lock is None:
            self._lock = asyncio.Lock()
        async with self._lock:
            at = at or datetime.now(timezone.utc)
            rows = self.training_rows()
            run_id = self._next_run_id()
            result = await asyncio.to_thread(train_run, rows, run_id, replace(self.train_options, quick=quick))
            return self.commit_run(result, at)

    def retrain_sync(self, at: datetime | None = None, quick: bool = False) -> ModelRun:
        at = at or datetime.now(timezone.utc)
        result = train_run(self.training_rows(), self._next_run_id(), replace(self.train_options, quick=quick))
        return self.commit_run(result, at)

    def _next_run_id(self) -> int:
        run_id = self._run_id
        self._run_id += 1
        return run_id

    def commit_run(self, result: ModelRun, at: datetime) -> ModelRun:
        result.ran_at = iso(at)
        result.source = "api" if self.source == "chain" else "simulated"
        self.runs.append(result)
        del self.runs[:-MAX_RUNS]

        deployed = self.deployed_names()
        for p in PERSONAS:
            cycle = self.ledgers[p.id].publish(result, p, self.bound_for(p), deployed, at)
            if self.persistence is not None:
                self.persistence.append_cycle(cycle, p.id)  # committed before any endpoint can serve it
            self.events.publish("cycle", {"persona": p.id, "cycle": cycle})

        log.info("run %d: n=%d n+=%d auc=%.4f±%.4f boot=%.4f", result.run_id, result.n, result.n_positive,
                 result.auc, result.auc_std, result.boot_lower)
        self.events.publish("model", {"run": result, "counters": self.counters()})
        self.save()
        return result

    # -- lifecycle ---------------------------------------------------------------

    def start(self) -> None:
        if self._task is None:
            self._task = asyncio.create_task(self._cycle_loop(), name="agent-cycles")

    async def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task
            self._task = None
        self.save()

    async def _cycle_loop(self) -> None:
        while True:
            self.next_cycle_at = now_ms() + self.cycle_seconds * 1000
            await asyncio.sleep(self.cycle_seconds)
            try:
                await self.retrain()
            except asyncio.CancelledError:
                raise
            except Exception:
                log.exception("retrain failed; the next cycle will try again")

    # -- persistence -------------------------------------------------------------

    def snapshot(self) -> dict[str, Any]:
        return {
            "version": SNAPSHOT_VERSION,
            "runId": self._run_id,
            "tokens": [t.to_json() for t in self.tokens.values()],
            "runs": [r.to_json() for r in self.runs],
            "ledgers": {pid: ledger.snapshot() for pid, ledger in self.ledgers.items()},
        }

    def restore(self, snapshot: dict[str, Any]) -> None:
        self._run_id = int(snapshot.get("runId", SITE.first_run_id))
        self.tokens = {t["mint"].lower(): Token.from_json(t) for t in snapshot.get("tokens", [])}
        self.runs = [ModelRun.from_json(r) for r in snapshot.get("runs", [])]
        if snapshot.get("version") == 1 and "ledger" in snapshot:
            # Snapshots written before idea cycles were kept per persona.
            self.ledgers[self.persona].restore(snapshot["ledger"])
            return
        for pid, ledger_snapshot in (snapshot.get("ledgers") or {}).items():
            if pid in self.ledgers:
                self.ledgers[pid].restore(ledger_snapshot)

    def save(self) -> None:
        if self.persistence is not None:
            self.persistence.save(self.snapshot())
