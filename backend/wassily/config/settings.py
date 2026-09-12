"""Runtime configuration read from the environment (see ``.env.example``)."""

from __future__ import annotations

import math
import os
from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Literal

from wassily.config.personas import is_persona_id
from wassily.config.site import SITE
from wassily.maths.bounds import is_bound_id

SourceKind = Literal["simulated", "chain"]


def _num(env: Mapping[str, str], key: str, default: float) -> float:
    raw = env.get(key)
    if raw is None or not raw.strip():
        return default
    try:
        value = float(raw)
    except ValueError:
        return default
    return value if math.isfinite(value) else default


@dataclass(frozen=True)
class ServerConfig:
    source: SourceKind
    chain: str
    persona: str  # the default persona for idea endpoints without ?persona=
    bound: str | None
    cycle_seconds: int
    poll_seconds: int
    rpc_url: str
    gecko_api: str
    gecko_per_minute: float
    dexscreener_api: str
    backfill_days: float  # history the chain source labels on first start
    backfill_sample: float  # share of past launches looked up, chosen uniformly at random
    data_dir: str
    persist: bool
    seed_tokens: int
    arrival_ms: tuple[int, int]
    prior_cycles: int
    host: str = "0.0.0.0"
    port: int = 8000
    cors_origins: tuple[str, ...] = field(default_factory=tuple)
    log_level: str = "info"

    @property
    def live(self) -> bool:
        return self.source == "chain"


def load_config(env: Mapping[str, str] | None = None) -> ServerConfig:
    env = os.environ if env is None else env
    # "dexscreener" named the live source before discovery moved on-chain; it still selects live data.
    live = env.get("DATA_SOURCE") in ("chain", "dexscreener")

    arrival = [part for part in env.get("ARRIVAL_MS", "").split(",") if part.strip()]
    try:
        arrival_ms = (int(arrival[0]), int(arrival[1])) if len(arrival) == 2 else SITE.arrival_ms
    except ValueError:
        arrival_ms = SITE.arrival_ms

    sample = _num(env, "BACKFILL_SAMPLE", 0.5)
    persona = env.get("PERSONA")
    bound = env.get("BOUND")
    origins = tuple(o.strip() for o in env.get("CORS_ORIGINS", "").split(",") if o.strip())

    return ServerConfig(
        source="chain" if live else "simulated",
        chain=env.get("CHAIN", "robinhood"),
        persona=persona if persona and is_persona_id(persona) else "hoeffding",
        bound=bound if bound and is_bound_id(bound) else None,
        cycle_seconds=int(_num(env, "CYCLE_SECONDS", 3600 if live else SITE.cycle_seconds)),
        poll_seconds=int(_num(env, "POLL_SECONDS", 60)),
        rpc_url=env.get("RPC_URL", "https://rpc.mainnet.chain.robinhood.com"),
        gecko_api=env.get("GECKO_API", "https://api.geckoterminal.com/api/v2"),
        gecko_per_minute=_num(env, "GECKO_PER_MINUTE", 28),
        dexscreener_api=env.get("DEXSCREENER_API", "https://api.dexscreener.com"),
        backfill_days=_num(env, "BACKFILL_DAYS", 14),
        backfill_sample=max(0.0, min(1.0, sample)),
        data_dir=env.get("DATA_DIR", "data"),
        persist=env.get("PERSIST", "true" if live else "false") == "true",
        seed_tokens=int(_num(env, "SEED_TOKENS", SITE.seed_tokens)),
        arrival_ms=arrival_ms,
        prior_cycles=SITE.prior_cycles,
        host=env.get("HOST", "0.0.0.0"),
        port=int(_num(env, "PORT", 8000)),
        cors_origins=origins,
        log_level=env.get("LOG_LEVEL", "info"),
    )
