"""Live source: every pool launch on Robinhood Chain, read from the RPC and labelled 48 hours later.

1. Discover: v2 PairCreated, v3 PoolCreated, v4 Initialize and Pons curve creation logs.
2. Admit: tokens launched against WETH, ETH or USDG. An existing token opening a new pool is not a launch.
3. Measure: 48h peak price times total supply. Pons peaks come from on-chain trades; other venues from
   GeckoTerminal's hourly candles.
4. Label: below $10K leaves the study; at or above $30K passed; otherwise stalled.
5. Backfill: the last BACKFILL_DAYS of launches, newest first, as a uniform random sample by address.
"""

from __future__ import annotations

import asyncio
import contextlib
import hashlib
import time
from collections.abc import Awaitable, Callable
from dataclasses import asdict, dataclass
from typing import TYPE_CHECKING, Any

from wassily.chain.abi import LAUNCH_TOPICS, NATIVE, USDG, WETH, PoolLaunch, decode_launch
from wassily.chain.gecko import GeckoClient, GeckoUnavailable
from wassily.chain.holders import holders_at
from wassily.chain.pons import PonsCurve, pons_peaks
from wassily.chain.prices import QuotePrices
from wassily.chain.rpc import RpcClient
from wassily.chain.tokens import TokenInfoCache
from wassily.config.site import SITE
from wassily.engine.features import fnv1a
from wassily.engine.types import Token
from wassily.sources.base import Source
from wassily.utils.logging import get_logger
from wassily.utils.timeutil import iso, utc_from_ms

if TYPE_CHECKING:
    from wassily.config.settings import ServerConfig
    from wassily.runtime.agent import Agent
    from wassily.store.persistence import Persistence

log = get_logger("chain")

QUOTES = frozenset({WETH, NATIVE, USDG})
SCAN_SPAN = 5_000  # blocks per launch scan
DEX_PER_TICK = 20  # GeckoTerminal lookups per tick; Pons curves cost no API budget
STATE_FILE = "chain.json"
STATE_WRITER = "wassily-py"
LABEL_SECONDS = SITE.holder_sample_hours * 3600


def in_sample(address: str, share: float) -> bool:
    """Uniform by address, so the backfill sample is unbiased and stable across restarts."""
    if share >= 1:
        return True
    if share <= 0:
        return False
    return int(hashlib.sha256(address.lower().encode()).hexdigest()[:8], 16) / 2**32 < share


def launched_token(launch: PoolLaunch) -> tuple[str, str] | None:
    """(token, quote) for a pool that launches a token, or None for quote/quote and token/token pools."""
    if launch.kind == "pons":
        return launch.token_a, launch.token_b
    a_quote = launch.token_a in QUOTES
    b_quote = launch.token_b in QUOTES
    if a_quote == b_quote:
        return None
    token, quote = (launch.token_b, launch.token_a) if a_quote else (launch.token_a, launch.token_b)
    return token, WETH if quote == NATIVE else quote


@dataclass
class Launch:
    token: str
    kind: str
    pool: str
    quote: str
    block: int
    launched_at: int  # unix seconds
    creator: str | None = None


@dataclass
class BackfillProgress:
    from_block: int
    to_block: int
    cursor: int  # walks from newest to oldest
    scanned: int = 0
    sampled: int = 0
    done: bool = False

    @property
    def reached_block(self) -> int:
        return max(self.from_block, self.cursor + 1)


class ChainSource(Source):
    kind = "chain"

    def __init__(
        self,
        agent: Agent,
        config: ServerConfig,
        persistence: Persistence | None = None,
        *,
        rpc: RpcClient | None = None,
        gecko: GeckoClient | None = None,
    ) -> None:
        self.agent = agent
        self.config = config
        self.persistence = persistence
        self.rpc = rpc or RpcClient(config.rpc_url)
        self.gecko = gecko or GeckoClient(config.chain, api=config.gecko_api, per_minute=config.gecko_per_minute)
        self.prices = QuotePrices(self.gecko)
        self.token_info = TokenInfoCache(self.rpc)

        self.pending: dict[str, Launch] = {}
        self.known: set[str] = set()
        self.progress: BackfillProgress | None = None
        self.cursor = 0
        self.head = 0
        self.block_seconds = 0.25
        self._anchor: tuple[int, float] = (0, 0.0)
        self._ready = False
        self._task: asyncio.Task[None] | None = None
        self.stats: dict[str, Any] = {
            "launches": 0,
            "labelled": 0,
            "below_entry": 0,
            "errors": 0,
            "last_error": None,
            "last_tick_at": None,
        }

    # -- lifecycle ---------------------------------------------------------------

    async def start(self) -> None:
        if self._task is None:
            self._task = asyncio.create_task(self._run(), name="chain-source")

    async def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task
            self._task = None
        self._save()
        await self.rpc.aclose()
        await self.gecko.aclose()

    async def init(self) -> None:
        self.known.update(self.agent.tokens)
        head = await self.rpc.block_number()
        head_ts = await self.rpc.timestamp(head)
        span = min(head - 1, 100_000)
        if span > 0:
            old_ts = await self.rpc.timestamp(head - span)
            self.block_seconds = max(0.01, (head_ts - old_ts) / span)
        self._anchor = (head, float(head_ts))
        self.head = head

        saved = self.persistence.load_json(STATE_FILE) if self.persistence else None
        if isinstance(saved, dict) and saved.get("writer") == STATE_WRITER:
            self._restore(saved)
        else:
            self.cursor = head
            if self.config.backfill_days > 0:
                start = await self.rpc.block_at(int(head_ts - self.config.backfill_days * 86400), head)
                self.progress = BackfillProgress(from_block=start, to_block=head, cursor=head)
        self._ready = True
        log.info("chain ready: head=%d cursor=%d %.3fs/block backfill=%s", head, self.cursor, self.block_seconds,
                 f"{self.progress.from_block}-{self.progress.to_block}" if self.progress else "off")

    async def _run(self) -> None:
        while not self._ready:
            if not await self._guard("init", self.init):
                await asyncio.sleep(min(60, self.config.poll_seconds))
        while True:
            self.stats["last_tick_at"] = iso(time.time() * 1000)
            await self._guard("live", self.live_tick)
            await self._guard("backfill", self.backfill_step)
            await self._guard("label", self.label_due)
            self._save()
            await asyncio.sleep(self.config.poll_seconds)

    async def _guard(self, stage: str, step: Callable[[], Awaitable[None]]) -> bool:
        try:
            await step()
            return True
        except asyncio.CancelledError:
            raise
        except Exception as err:  # one failing stage must not stop the loop
            self.stats["errors"] += 1
            self.stats["last_error"] = f"{stage}: {err}"[:200]
            log.warning("%s failed: %s", stage, err)
            return False

    # -- discovery ---------------------------------------------------------------

    async def live_tick(self) -> None:
        head = await self.rpc.block_number()
        start = self.cursor + 1
        while start <= head:
            end = min(head, start + SCAN_SPAN - 1)
            for launch in await self.launches(start, end):
                self._admit(launch)
            self.cursor = end
            start = end + 1
        if head > self._anchor[0]:
            self._anchor = (head, float(await self.rpc.timestamp(head)))
        self.head = head

    async def backfill_step(self) -> None:
        p = self.progress
        if p is None or p.done:
            return
        end = p.cursor
        start = max(p.from_block, end - SCAN_SPAN + 1)
        for launch in await self.launches(start, end):
            p.scanned += 1
            if in_sample(launch.token, self.config.backfill_sample):
                p.sampled += 1
                self._admit(launch)
        p.cursor = start - 1
        p.done = p.cursor < p.from_block
        if p.done:
            log.info("backfill finished: %d launches scanned, %d sampled", p.scanned, p.sampled)

    async def launches(self, start: int, end: int) -> list[Launch]:
        logs = await self.rpc.get_logs(start, end, None, [list(LAUNCH_TOPICS)])
        out: list[Launch] = []
        for entry in logs:
            decoded = decode_launch(entry)
            pair = launched_token(decoded) if decoded else None
            if decoded is None or pair is None:
                continue
            token, quote = pair
            launched_at = await self.rpc.timestamp(decoded.block)
            out.append(Launch(token, decoded.kind, decoded.pool, quote, decoded.block, launched_at, decoded.creator))
        return out

    def _admit(self, launch: Launch) -> None:
        if launch.token in self.known:
            return  # an existing token that merely opens a new pool is not a launch
        self.known.add(launch.token)
        self.pending[launch.token] = launch
        self.stats["launches"] += 1

    # -- labelling ---------------------------------------------------------------

    def seconds_at(self, block: int) -> float:
        head, ts = self._anchor
        return ts - (head - block) * self.block_seconds

    def window_blocks(self) -> int:
        return int(LABEL_SECONDS / self.block_seconds)

    async def label_due(self) -> None:
        now = time.time()
        due = sorted((x for x in self.pending.values() if now >= x.launched_at + LABEL_SECONDS),
                     key=lambda x: -x.launched_at)
        if not due:
            return

        pons = [x for x in due if x.kind == "pons"]
        if pons:
            peaks = await pons_peaks(
                self.rpc, self.prices, self.token_info,
                [PonsCurve(x.token, x.pool, x.quote, x.block) for x in pons],
                window_blocks=self.window_blocks(), head=self.head, seconds_at=self.seconds_at,
            )
            for launch in pons:
                peak = peaks.get(launch.token)
                await self._finish(launch, peak.peak_price if peak else 0.0)

        for launch in [x for x in due if x.kind != "pons"][:DEX_PER_TICK]:
            try:
                price = await self.gecko.peak_price(launch.pool, launch.token, launch.launched_at,
                                                    launch.launched_at + LABEL_SECONDS)
            except GeckoUnavailable:
                break  # keep them pending: unanswered is not "no trades"
            await self._finish(launch, price or 0.0)

    async def _finish(self, launch: Launch, peak_price: float) -> None:
        info = await self.token_info.get(launch.token)
        if info is None:
            self.pending.pop(launch.token, None)
            return
        cap = peak_price * info.supply
        if cap < SITE.entry_mc:
            self.pending.pop(launch.token, None)
            self.stats["below_entry"] += 1
            return

        end = min(self.head, launch.block + self.window_blocks())
        holders = await holders_at(self.rpc, launch.token, launch.block, end)
        launched = utc_from_ms(launch.launched_at * 1000)
        token = Token(
            mint=launch.token,
            name=info.name or launch.token[:10],
            symbol=info.symbol or "?",
            lore="",  # descriptions are not on-chain
            lore_raw="",
            lore_withheld=False,
            holders=holders,
            peak_mc=round(cap),
            status="passed" if cap >= SITE.target_mc else "stalled",
            hour=launched.hour,
            dow=launched.weekday(),
            launched_at=iso(launched),
            deployer=launch.creator or "",
            hue=fnv1a(launch.token) % 360,
        )
        self.pending.pop(launch.token, None)
        self.agent.upsert(token, block_number=launch.block)
        self.stats["labelled"] += 1

    # -- reporting and persistence -----------------------------------------------

    def backfill(self) -> dict[str, Any] | None:
        p = self.progress
        if p is None:
            return None
        total = max(1, p.to_block - p.from_block)
        return {
            "done": p.done,
            "from_block": p.from_block,
            "to_block": p.to_block,
            "reached_block": p.reached_block,
            "reached_at": iso(self.seconds_at(p.reached_block) * 1000) if self._ready else None,
            "progress": round((p.to_block - p.reached_block) / total, 4),
            "scanned": p.scanned,
            "sampled": p.sampled,
            "sample": self.config.backfill_sample,
            "pending": len(self.pending),
        }

    def health(self) -> dict[str, Any]:
        return {
            "kind": self.kind,
            "ready": self._ready,
            "head": self.head,
            "cursor": self.cursor,
            "pending": len(self.pending),
            "block_seconds": round(self.block_seconds, 4),
            **self.stats,
            "gecko": asdict(self.gecko.stats),
            "gecko_backlog_seconds": round(self.gecko.backlog_seconds(), 1),
        }

    def _save(self) -> None:
        if self.persistence is None or not self._ready:
            return
        self.persistence.save_json(
            STATE_FILE,
            {
                "writer": STATE_WRITER,
                "version": 1,
                "cursor": self.cursor,
                "blockSeconds": self.block_seconds,
                "pending": [asdict(x) for x in self.pending.values()],
                "backfill": asdict(self.progress) if self.progress else None,
                "stats": {k: self.stats[k] for k in ("launches", "labelled", "below_entry")},
            },
        )

    def _restore(self, saved: dict[str, Any]) -> None:
        self.cursor = int(saved["cursor"])
        self.pending = {x["token"]: Launch(**x) for x in saved.get("pending", [])}
        self.known.update(self.pending)
        backfill = saved.get("backfill")
        self.progress = BackfillProgress(**backfill) if backfill else None
        self.stats.update(saved.get("stats") or {})
