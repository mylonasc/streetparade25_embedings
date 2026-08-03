from __future__ import annotations

import os
from collections.abc import AsyncIterator, Callable

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .routes.catalog import router as catalog_router


def cors_origins() -> list[str]:
    """Return allowed CORS origins for the main API."""
    raw = os.environ.get(
        "STREETPARADE_CORS_ORIGINS",
        "http://localhost:5173,http://localhost:5174,http://localhost:3000,http://localhost:3001,"
        "http://127.0.0.1:5173,http://127.0.0.1:5174,http://127.0.0.1:3000,http://127.0.0.1:3001",
    )
    return [origin.strip() for origin in raw.split(",") if origin.strip()]


def cors_origin_regex() -> str | None:
    """Return the optional CORS origin regex for local network frontends."""
    return os.environ.get(
        "STREETPARADE_CORS_ORIGIN_REGEX",
        r"https?://(localhost|127\.0\.0\.1|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3})(:\d+)?",
    )


def create_app(lifespan: Callable[[FastAPI], AsyncIterator[None]] | None = None) -> FastAPI:
    """Create the FastAPI app and register shared middleware and routers."""
    app = FastAPI(title="Street Parade Embeddings API", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=cors_origins(),
        allow_origin_regex=cors_origin_regex(),
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(catalog_router)
    return app
