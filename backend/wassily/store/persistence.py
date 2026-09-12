"""JSON snapshot for state, plus an append-only JSONL commitment log.

The file layout matches the Next.js server (``state.json``,
``commitments.jsonl``, ``chain.json``), so either runtime can pick up the
other's data directory.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from wassily.engine.types import IdeaCycle

SUPPORTED_VERSIONS = (1, 2)


class Persistence:
    def __init__(self, directory: str | os.PathLike[str]) -> None:
        self.dir = Path(directory)
        self.dir.mkdir(parents=True, exist_ok=True)

    @property
    def state_file(self) -> Path:
        return self.dir / "state.json"

    @property
    def log_file(self) -> Path:
        return self.dir / "commitments.jsonl"

    def load(self) -> dict[str, Any] | None:
        snapshot = self.load_json("state.json")
        if not isinstance(snapshot, dict) or snapshot.get("version") not in SUPPORTED_VERSIONS:
            return None
        return snapshot

    def save(self, snapshot: dict[str, Any]) -> None:
        self.save_json("state.json", snapshot)

    def load_json(self, name: str) -> Any | None:
        path = self.dir / name
        if not path.exists():
            return None
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return None

    def save_json(self, name: str, data: Any) -> None:
        path = self.dir / name
        tmp = path.with_suffix(path.suffix + ".tmp")
        tmp.write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")
        os.replace(tmp, path)  # atomic replace: a crash never leaves half a file

    def append_cycle(self, cycle: IdeaCycle, persona: str) -> None:
        """Called synchronously when a cycle is generated, before any endpoint can serve it."""
        lines = [
            json.dumps(
                {
                    "persona": persona,
                    "cycle_id": cycle.cycle_id,
                    "run_id": cycle.run_id,
                    "rank": c.rank,
                    "name": c.name,
                    "lore": c.lore,
                    "hour": c.hour,
                    "commitment": c.commitment,
                    "committed_at": c.committed_at,
                },
                ensure_ascii=False,
            )
            for c in cycle.candidates
        ]
        with self.log_file.open("a", encoding="utf-8") as fh:
            fh.write("\n".join(lines) + "\n")
            fh.flush()
            os.fsync(fh.fileno())

    def read_commitments(self, persona: str, start: int | None = None, end: int | None = None) -> list[dict[str, Any]]:
        if not self.log_file.exists():
            return []
        out: list[dict[str, Any]] = []
        with self.log_file.open(encoding="utf-8") as fh:
            for line in fh:
                if not line.strip():
                    continue
                row = json.loads(line)
                if row.get("persona", persona) != persona:
                    continue
                if start is not None and row["cycle_id"] < start:
                    continue
                if end is not None and row["cycle_id"] > end:
                    continue
                out.append(row)
        return out
