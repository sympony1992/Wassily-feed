"""SHA-256 commitments for idea candidates.

Fields are joined by an explicit 0x1f unit separator so ("ab", "c") and
("a", "bc") never hash alike. The Brain page re-verifies the same digest in the
browser, so the encoding here must not drift.
"""

from __future__ import annotations

import hashlib
from collections.abc import Iterable

UNIT_SEPARATOR = b"\x1f"


def sha256_hex(data: str | bytes) -> str:
    raw = data.encode("utf-8") if isinstance(data, str) else data
    return hashlib.sha256(raw).hexdigest()


def sha256_fields(fields: Iterable[str]) -> str:
    return sha256_hex(UNIT_SEPARATOR.join(f.encode("utf-8") for f in fields))


def candidate_commitment(name: str, lore: str, hour: int, run_id: int) -> str:
    return sha256_fields([name, lore, str(hour), str(run_id)])


def verify_candidate(name: str, lore: str, hour: int, run_id: int, commitment: str) -> bool:
    return candidate_commitment(name, lore, hour, run_id) == commitment.lower()
