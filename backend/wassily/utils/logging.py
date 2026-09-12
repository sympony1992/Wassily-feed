"""One log format for the service, the ingest loop and the CLI."""

from __future__ import annotations

import logging
import sys

_FORMAT = "%(asctime)s %(levelname)-5s [%(name)s] %(message)s"
_configured = False


def configure_logging(level: str = "info") -> None:
    global _configured
    if _configured:
        logging.getLogger().setLevel(level.upper())
        return
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(logging.Formatter(_FORMAT, datefmt="%Y-%m-%dT%H:%M:%S"))
    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(level.upper())
    for noisy in ("httpx", "httpcore"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
    _configured = True


def get_logger(name: str) -> logging.Logger:
    return logging.getLogger(f"wassily.{name}")
