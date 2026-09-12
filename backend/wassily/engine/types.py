"""Domain records.

Attributes are snake_case in Python; ``to_json``/``from_json`` speak the
camelCase shape of ``data/state.json`` so a snapshot written by either runtime
can be read by the other.
"""

from __future__ import annotations

from dataclasses import dataclass, field, fields
from typing import Any, Literal, TypeVar

TokenStatus = Literal["passed", "stalled", "pending"]
M = TypeVar("M", bound="JsonModel")


def camel(snake: str) -> str:
    head, *rest = snake.split("_")
    return head + "".join(part.title() for part in rest)


def _dump(value: Any) -> Any:
    if isinstance(value, JsonModel):
        return value.to_json()
    if isinstance(value, (list, tuple)):
        return [_dump(v) for v in value]
    if isinstance(value, dict):
        return {k: _dump(v) for k, v in value.items()}
    return value


class JsonModel:
    def to_json(self) -> dict[str, Any]:
        out: dict[str, Any] = {}
        for f in fields(self):  # type: ignore[arg-type]
            value = getattr(self, f.name)
            if value is None:
                continue
            out[camel(f.name)] = _dump(value)
        return out

    @classmethod
    def from_json(cls: type[M], data: dict[str, Any]) -> M:
        kwargs = {f.name: data[camel(f.name)] for f in fields(cls) if camel(f.name) in data}  # type: ignore[arg-type]
        return cls(**kwargs)


@dataclass
class Token(JsonModel):
    mint: str
    name: str
    symbol: str
    lore: str  # sanitized, safe to display
    lore_withheld: bool
    holders: int
    peak_mc: float
    status: TokenStatus
    hour: int  # UTC launch hour
    dow: int  # 0 = Monday
    launched_at: str  # ISO
    deployer: str
    hue: int
    lore_raw: str | None = None  # what the trainer sees; never rendered
    logo: str | None = None
    holders_missing: bool | None = None  # no explorer configured: imputed with the median at training time


@dataclass
class TrainingRow:
    """What the trainer needs from a token: nothing derived from price."""

    name: str
    lore: str
    lore_missing: bool
    holders: float
    hour: int
    dow: int
    launched_at: float  # epoch ms, only used to order the time split
    passed: int  # 0 | 1


@dataclass
class ScoringModel(JsonModel):
    weights: list[float]
    bias: float
    mu: list[float]
    sigma: list[float]


@dataclass
class ModelRun(JsonModel):
    run_id: int
    n: int
    n_positive: int
    d: int
    auc: float
    auc_std: float
    fold_aucs: list[float]
    time_split_gap: float
    boot_lower: float
    feature_importance: dict[str, float]
    hour_rates: list[float]  # survival rate by launch hour
    hour_counts: list[int]
    median_holders: float
    model: ScoringModel
    ran_at: str = ""
    source: Literal["simulated", "api"] = "simulated"
    gates_override: dict[str, bool] | None = None  # a backend may report gates it computed itself

    @classmethod
    def from_json(cls, data: dict[str, Any]) -> ModelRun:
        run = super().from_json(data)
        if isinstance(run.model, dict):
            run.model = ScoringModel.from_json(run.model)
        return run


@dataclass
class Candidate(JsonModel):
    rank: int
    name: str
    lore: str
    hour: int
    score: float
    commitment: str
    committed_at: str


@dataclass
class IdeaCycle(JsonModel):
    cycle_id: int
    run_id: int
    started_at: str
    seed: str
    median_holders: float
    dow: int
    n_generated: int
    n_rejected: int
    n_excluded: int
    rule_hits: dict[str, int]
    model: dict[str, float]  # {"auc": ..., "floor": ...}
    candidates: list[Candidate] = field(default_factory=list)

    @classmethod
    def from_json(cls, data: dict[str, Any]) -> IdeaCycle:
        cycle = super().from_json(data)
        cycle.candidates = [c if isinstance(c, Candidate) else Candidate.from_json(c) for c in cycle.candidates]
        return cycle


@dataclass
class EliminatedItem(JsonModel):
    name: str
    lore: str
    led_cycle: int
    peak_score: float
    current_score: float
    current_rank: int | None
    demoted_cycle: int

    def to_json(self) -> dict[str, Any]:
        out = super().to_json()
        out["currentRank"] = self.current_rank  # null is meaningful here: no longer ranked
        return out


@dataclass
class ExclusionItem(JsonModel):
    name: str
    first_cycle: int
    first_seen_at: str
    deployed_mint: str
    deployer: str
    deployed_at: str
    block_number: int
    time_gap_seconds: int


@dataclass
class LiftWord(JsonModel):
    word: str
    lift: float
    n: int
