"""Idea cycles plus the two public records built from them.

* eliminated: leaders that lost rank 1 in a later cycle;
* exclusions: ideas someone else deployed after we committed them.
"""

from __future__ import annotations

from collections.abc import Set
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from wassily.config.personas import Persona
from wassily.config.site import SITE
from wassily.engine.features import IdeaFeatures, featurize
from wassily.engine.ideas import CycleInput, generate_cycle
from wassily.engine.model import predict_proba
from wassily.engine.proof import evaluate_model
from wassily.engine.types import Candidate, EliminatedItem, ExclusionItem, IdeaCycle, ModelRun
from wassily.maths.bounds import BoundDef
from wassily.utils.timeutil import iso, iso_to_ms, to_ms, utc_dow

MAX_ELIMINATED = 50
MAX_EXCLUSIONS = 100


@dataclass(frozen=True)
class Deployment:
    mint: str
    deployer: str
    at: datetime
    block_number: int


class IdeaLedger:
    def __init__(self, first_cycle_id: int = SITE.first_cycle_id, keep: int = 48) -> None:
        self._first_cycle_id = first_cycle_id
        self._keep = keep
        self._next_cycle_id = first_cycle_id
        self.cycles: list[IdeaCycle] = []
        self.eliminated: list[EliminatedItem] = []
        self.exclusions: list[ExclusionItem] = []
        self.stolen: set[str] = set()

    @property
    def current(self) -> IdeaCycle | None:
        return self.cycles[-1] if self.cycles else None

    def reset(self) -> None:
        self.cycles.clear()
        self.eliminated.clear()
        self.exclusions.clear()
        self.stolen.clear()
        self._next_cycle_id = self._first_cycle_id

    def cycle(self, cycle_id: int) -> IdeaCycle | None:
        return next((c for c in self.cycles if c.cycle_id == cycle_id), None)

    def publish(self, result: ModelRun, persona: Persona, bound: BoundDef, deployed_names: Set[str],
                at: datetime) -> IdeaCycle:
        proof = evaluate_model(result, bound)
        cycle = generate_cycle(
            CycleInput(
                cycle_id=self._next_cycle_id,
                run_id=result.run_id,
                model=result.model,
                median_holders=result.median_holders,
                dow=utc_dow(at),
                names=persona.ideas.names,
                suffixes=persona.ideas.suffixes,
                lores=persona.ideas.lores,
                deployed_names=deployed_names,
                stolen_names=self.stolen,
                auc=result.auc,
                floor=proof.floor,
                n=SITE.candidates_per_cycle,
                now=at,
            )
        )
        self._next_cycle_id += 1

        # The previous leader lost rank 1: keep the record of the revision.
        prev_cycle = self.current
        prev = prev_cycle.candidates[0] if prev_cycle and prev_cycle.candidates else None
        leader = cycle.candidates[0].name if cycle.candidates else None
        if prev_cycle and prev and leader != prev.name:
            again = next((c for c in cycle.candidates if c.name == prev.name), None)
            current_score = again.score if again else predict_proba(
                result.model,
                featurize(IdeaFeatures(name=prev.name, lore=prev.lore, hour=prev.hour, dow=cycle.dow,
                                       holders=cycle.median_holders)),
            )
            record = EliminatedItem(name=prev.name, lore=prev.lore, led_cycle=prev_cycle.cycle_id,
                                    peak_score=prev.score, current_score=current_score,
                                    current_rank=again.rank if again else None, demoted_cycle=cycle.cycle_id)
            self.eliminated = [record, *self.eliminated][:MAX_ELIMINATED]

        self.cycles.append(cycle)
        if len(self.cycles) > self._keep:
            self.cycles.pop(0)
        return cycle

    def find_committed(self, name: str) -> tuple[IdeaCycle, Candidate] | None:
        """The earliest commitment of a name we wrote and have not yet recorded as taken."""
        key = name.lower()
        if key in self.stolen:
            return None
        for cycle in self.cycles:
            for candidate in cycle.candidates:
                if candidate.name.lower() == key:
                    return cycle, candidate
        return None

    def record_theft(self, cycle: IdeaCycle, candidate: Candidate, deployment: Deployment) -> ExclusionItem:
        self.stolen.add(candidate.name.lower())
        gap_ms = to_ms(deployment.at) - iso_to_ms(candidate.committed_at)
        record = ExclusionItem(
            name=candidate.name,
            first_cycle=cycle.cycle_id,
            first_seen_at=candidate.committed_at,
            deployed_mint=deployment.mint,
            deployer=deployment.deployer,
            deployed_at=iso(deployment.at),
            block_number=deployment.block_number,
            time_gap_seconds=max(0, round(gap_ms / 1000)),
        )
        self.exclusions = [record, *self.exclusions][:MAX_EXCLUSIONS]
        return record

    def snapshot(self) -> dict[str, Any]:
        return {
            "nextCycleId": self._next_cycle_id,
            "cycles": [c.to_json() for c in self.cycles],
            "eliminated": [e.to_json() for e in self.eliminated],
            "exclusions": [x.to_json() for x in self.exclusions],
            "stolen": sorted(self.stolen),
        }

    def restore(self, s: dict[str, Any]) -> None:
        self._next_cycle_id = int(s.get("nextCycleId", self._first_cycle_id))
        self.cycles = [IdeaCycle.from_json(c) for c in s.get("cycles", [])]
        self.eliminated = [EliminatedItem.from_json(e) for e in s.get("eliminated", [])]
        self.exclusions = [ExclusionItem.from_json(x) for x in s.get("exclusions", [])]
        self.stolen = set(s.get("stolen", []))
