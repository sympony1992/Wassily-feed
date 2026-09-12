"""FastAPI application factory."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

from wassily import __version__
from wassily.api.routes import ROUTERS
from wassily.config.settings import ServerConfig, load_config
from wassily.runtime.runtime import Runtime
from wassily.utils.logging import configure_logging


def create_app(config: ServerConfig | None = None, *, start_runtime: bool = True) -> FastAPI:
    config = config or load_config()
    configure_logging(config.log_level)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        runtime = Runtime(config)
        app.state.runtime = runtime
        if start_runtime:
            await runtime.start()
        try:
            yield
        finally:
            if start_runtime:
                await runtime.stop()

    app = FastAPI(
        title="Wassily",
        version=__version__,
        description="Survival agent for Robinhood Chain tokens: proven floors, validation gates and committed ideas.",
        lifespan=lifespan,
        docs_url="/api/docs",
        redoc_url=None,
        openapi_url="/api/openapi.json",
    )
    app.add_middleware(GZipMiddleware, minimum_size=2048)
    if config.cors_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=list(config.cors_origins),
            allow_methods=["GET"],
            allow_headers=["*"],
        )
    for router in ROUTERS:
        app.include_router(router)
    return app
