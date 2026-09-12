"""A synthetic Robinhood Chain.

The ground truth below is hidden from the model: it only ever sees launch hour,
weekday, holders and lore, never price.
"""

from __future__ import annotations

import math
import re
from datetime import datetime

from wassily.config.site import SITE
from wassily.engine.sanitize import sanitize_lore
from wassily.engine.types import Token, TrainingRow
from wassily.maths.stats import Rng, gaussian, hex_string, pick, rng_from_seed
from wassily.utils.timeutil import DAY_MS, HOUR_MS, iso, iso_to_ms, to_ms, utc_from_ms

ADJ = ("Velvet", "Rusty", "Lucky", "Sleepy", "Brave", "Lazy", "Spicy", "Frozen", "Electric", "Paper", "Hidden",
       "Jolly", "Grumpy", "Turbo", "Lunar", "Solar", "Pocket", "Royal", "Soggy", "Clever")
NOUN = ("Otter", "Walrus", "Badger", "Lobster", "Penguin", "Llama", "Beaver", "Gecko", "Raccoon", "Donkey", "Parrot",
        "Koala", "Turtle", "Falcon", "Bison", "Yak", "Squid", "Hedgehog", "Ferret", "Narwhal")

GOOD_WORDS = frozenset({"community", "patient", "builders", "honest", "quiet", "survivor"})
HYPE_WORDS = frozenset({"moon", "pump", "soon", "lambo"})

LORE = (
    "A {noun} that refused to leave the pool. The community kept feeding it.",
    "Launched by builders who forgot to write a roadmap.",
    "The {adj} {noun} does not chart. It waits, patient and unbothered.",
    "Nobody asked for a {noun}. Now there is an honest one.",
    "Straight to the moon, then probably back.",
    "Pump first, story later. The {noun} insists.",
    "A quiet {noun} with a loud wallet.",
    "Survivor of three rugs and one bad haircut.",
    "Soon. The {noun} has been saying soon since launch.",
    "Community owned, {noun} operated.",
    "Minted at dawn by someone who should have been asleep.",
    "The {adj} {noun} bought a lambo in a dream.",
    "Built slowly by patient builders and one {noun}.",
    "No team, no plan, one very {adj} {noun}.",
    "An honest {noun} in a dishonest liquidity pool.",
    "Deployed from a phone on a bus.",
    "The {noun} keeps a diary. Every entry says hold.",
    "Too {adj} to fail, too {noun} to explain.",
)

HOUR_WEIGHTS = (0.5, 0.4, 0.35, 0.3, 0.3, 0.35, 0.5, 0.7, 0.8, 0.9, 1, 1.1, 1.3, 1.5, 1.6, 1.6, 1.5, 1.4, 1.3, 1.2, 1,
                0.9, 0.7, 0.6)
HUES = (38, 152, 268, 196, 12, 88, 320)

B0 = -1.05
DOW_EFFECT = (0.05, 0, 0.05, 0.1, 0.15, -0.15, -0.2)
_TRAILING_DOT = re.compile(r"\.$")
_WORD = re.compile(r"[a-z]+")


def _circular_distance(h: float, center: float) -> float:
    d = abs(h - center) % 24
    return min(d, 24 - d)


def survival_logit(holders: float, hour: int, dow: int, lore: str) -> float:
    z_holders = (math.log(holders) - math.log(288)) / 0.8
    hour_effect = (
        0.6 * math.exp(-(_circular_distance(hour, 14.5) ** 2) / (2 * 2.5**2))
        - (0.35 if 2 <= hour <= 5 else 0)
        - 0.2
    )
    words = _WORD.findall(lore.lower())
    good = sum(1 for w in words if w in GOOD_WORDS)
    hype = sum(1 for w in words if w in HYPE_WORDS)
    lore_effect = 0.35 * min(2, good) - 0.25 * min(1, hype) if lore else -0.3
    return B0 + 0.3 * z_holders + hour_effect + DOW_EFFECT[dow] + lore_effect


class Market:
    def __init__(self, seed: int = 20_260_911) -> None:
        self.rng: Rng = rng_from_seed(seed)

    def history(self, count: int, now_ms: float) -> list[Token]:
        """Tokens already labelled before the service started, oldest first."""
        midnight = math.floor(now_ms / DAY_MS) * DAY_MS
        out: list[Token] = []
        for _ in range(count):
            day_offset = 2 + int(self.rng() * 10)
            at = midnight - day_offset * DAY_MS + self._sample_hour() * HOUR_MS + int(self.rng() * 60) * 60_000
            out.append(self._make(min(at, now_ms - SITE.holder_sample_hours * HOUR_MS)))
        out.sort(key=lambda t: iso_to_ms(t.launched_at))
        return out

    def arrival(self, now_ms: float, name: str | None = None) -> Token:
        """A token reaching its 48h label right now. ``name`` lets a copycat deploy a published idea."""
        midnight = math.floor(now_ms / DAY_MS) * DAY_MS
        at = midnight - 2 * DAY_MS + self._sample_hour() * HOUR_MS + int(self.rng() * 60) * 60_000
        if at > now_ms - SITE.holder_sample_hours * HOUR_MS:
            at -= DAY_MS
        return self._make(at, name)

    def random_address(self) -> str:
        return f"0x{hex_string(self.rng, 40)}"

    def chance(self, p: float) -> bool:
        return self.rng() < p

    def _sample_hour(self) -> int:
        r = self.rng() * sum(HOUR_WEIGHTS)
        for h, w in enumerate(HOUR_WEIGHTS):
            r -= w
            if r <= 0:
                return h
        return 23

    def _make(self, launched_at_ms: float, forced_name: str | None = None) -> Token:
        rng = self.rng
        date = utc_from_ms(launched_at_ms)
        hour = date.hour
        dow = date.weekday()
        adj = pick(rng, ADJ)
        noun = pick(rng, NOUN)
        name = forced_name if forced_name is not None else f"{adj} {noun}"
        if forced_name is not None:
            symbol = "".join(w[0] for w in forced_name.split()).upper()[:5] or "TKN"
        else:
            symbol = (adj[0] + noun[:3]).upper()

        raw = "" if rng() < 0.08 else pick(rng, LORE).replace("{adj}", adj.lower()).replace("{noun}", noun.lower())
        if raw and rng() < 0.03:
            raw += " https://t.me/" + hex_string(rng, 6)
        if raw and rng() < 0.006:
            raw = _TRAILING_DOT.sub(", holy shit.", raw)
        clean = sanitize_lore(raw)

        holders = max(12, math.floor(math.exp(math.log(288) + 0.8 * gaussian(rng)) + 0.5))
        p = 1 / (1 + math.exp(-survival_logit(holders, hour, dow, raw)))
        passed = rng() < p
        if passed:
            peak_mc = min(2_500_000, SITE.target_mc * math.exp(abs(gaussian(rng)) * 0.8))
        else:
            peak_mc = SITE.entry_mc + rng() * (SITE.target_mc - SITE.entry_mc - 100)

        return Token(
            mint=f"0x{hex_string(rng, 40)}",
            name=name,
            symbol=symbol,
            lore=clean.display,
            lore_raw=raw,
            lore_withheld=clean.withheld,
            holders=holders,
            peak_mc=math.floor(peak_mc + 0.5),
            status="passed" if passed else "stalled",
            hour=hour,
            dow=dow,
            launched_at=iso(date),
            deployer=f"0x{hex_string(rng, 40)}",
            hue=pick(rng, HUES),
        )


_SIM_EPOCH_MS = to_ms(datetime(2026, 9, 10))


def simulated_block_number(at: datetime) -> int:
    """Plausible block height for simulated deployments (~4 blocks per second)."""
    return 19_482_000 + math.floor((to_ms(at) - _SIM_EPOCH_MS) / 250)


def to_training_row(t: Token) -> TrainingRow:
    lore = t.lore_raw if t.lore_raw is not None else t.lore
    return TrainingRow(
        name=t.name,
        lore=lore,
        lore_missing=not lore.strip(),
        holders=t.holders,
        hour=t.hour,
        dow=t.dow,
        launched_at=iso_to_ms(t.launched_at),
        passed=1 if t.status == "passed" else 0,
    )
