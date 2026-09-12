"""Route modules, in the order they are mounted."""

from wassily.api.routes import bootstrap, dataset, health, ideas, model, state, stream

ROUTERS = (
    health.router,
    state.router,
    stream.router,
    model.router,
    ideas.router,
    dataset.router,
    bootstrap.router,
)

__all__ = ["ROUTERS"]
