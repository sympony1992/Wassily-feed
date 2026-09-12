from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query

from wassily.api.deps import get_runtime
from wassily.api.serialize import cycle_json, eliminated_json, exclusion_json
from wassily.config.personas import PERSONA_BY_ID
from wassily.engine.ideas import CONTENT_RULES, generator_sha, generator_source
from wassily.runtime.runtime import Runtime

router = APIRouter(prefix="/api/ideas", tags=["ideas"])


def _persona(rt: Runtime, persona: str | None) -> str:
    return persona if persona in PERSONA_BY_ID else rt.config.persona


@router.get("/current")
def current(persona: str | None = None, rt: Runtime = Depends(get_runtime)) -> dict[str, Any]:
    pid = _persona(rt, persona)
    cycle = rt.agent.ledger(pid).current
    if cycle is None:
        raise HTTPException(status_code=404, detail="No idea cycle yet: the first retrain has not run.")
    return cycle_json(cycle, generator_sha(), pid)


@router.get("/cycle/{cycle_id}")
def cycle(cycle_id: int, persona: str | None = None, rt: Runtime = Depends(get_runtime)) -> dict[str, Any]:
    pid = _persona(rt, persona)
    found = rt.agent.ledger(pid).cycle(cycle_id)
    if found is None:
        raise HTTPException(status_code=404, detail=f"Cycle {cycle_id} is not kept in memory.")
    return cycle_json(found, generator_sha(), pid)


@router.get("/eliminated")
def eliminated(persona: str | None = None, rt: Runtime = Depends(get_runtime)) -> dict[str, Any]:
    pid = _persona(rt, persona)
    return {"persona": pid, "items": [eliminated_json(e) for e in rt.agent.ledger(pid).eliminated]}


@router.get("/exclusions")
def exclusions(persona: str | None = None, rt: Runtime = Depends(get_runtime)) -> dict[str, Any]:
    pid = _persona(rt, persona)
    return {"persona": pid, "items": [exclusion_json(x) for x in rt.agent.ledger(pid).exclusions]}


@router.get("/commitments")
def commitments(
    persona: str | None = None,
    start: int | None = Query(None, alias="from"),
    end: int | None = Query(None, alias="to"),
    rt: Runtime = Depends(get_runtime),
) -> dict[str, Any]:
    """Every commitment ever written, from the append-only log when persistence is on."""
    pid = _persona(rt, persona)
    if rt.persistence is not None:
        rows = rt.persistence.read_commitments(pid, start, end)
    else:
        rows = [
            {"persona": pid, "cycle_id": c.cycle_id, "run_id": c.run_id, "rank": cand.rank, "name": cand.name,
             "lore": cand.lore, "hour": cand.hour, "commitment": cand.commitment, "committed_at": cand.committed_at}
            for c in rt.agent.ledger(pid).cycles
            if (start is None or c.cycle_id >= start) and (end is None or c.cycle_id <= end)
            for cand in c.candidates
        ]
    return {"persona": pid, "count": len(rows), "commitments": rows}


@router.get("/generator")
def generator() -> dict[str, Any]:
    """The generator's real source and its sha256."""
    return {"path": "wassily/engine/ideas.py", "sha256": generator_sha(), "source": generator_source()}


@router.get("/filter")
def content_filter() -> dict[str, Any]:
    return {
        "applied": "before scoring",
        "rules": [
            {"id": r.id, "label": r.label, "pattern": r.pattern.pattern if r.pattern else None} for r in CONTENT_RULES
        ],
    }
