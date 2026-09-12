"""Lore arrives from strangers.

It is cleaned before display, but the token is always kept in the dataset:
dropping flagged rows would bias the sample.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Literal

# Zero-width spaces/joiners, BOM, and bidi controls (escaped so the source stays ASCII).
_INVISIBLE = re.compile("[\\u200b-\\u200f\\u202a-\\u202e\\u2060-\\u2069\\ufeff]")
_URLS = re.compile(r"https?://\S+|ipfs://\S+|www\.\S+", re.IGNORECASE)
_WORDS = re.compile(r"\w+", re.ASCII)
_SPACES = re.compile(r"\s{2,}")

# Extend this list for production; it only needs to catch what you refuse to display.
BLOCKLIST = frozenset({"fuck", "shit", "bitch"})
MAX_LORE_CHARS = 280


@dataclass(frozen=True)
class SanitizedLore:
    display: str
    withheld: bool
    reason: Literal["blocklist"] | None


def sanitize_lore(raw: str | None) -> SanitizedLore:
    if not raw or not raw.strip():
        return SanitizedLore("", False, None)
    text = _INVISIBLE.sub("", raw)
    if any(w in BLOCKLIST for w in _WORDS.findall(text.lower())):
        return SanitizedLore("", True, "blocklist")
    display = _SPACES.sub(" ", _URLS.sub("", text)).strip()[:MAX_LORE_CHARS].strip()
    return SanitizedLore(display, False, None)
