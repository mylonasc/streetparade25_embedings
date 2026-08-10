from __future__ import annotations

import json
from typing import Any

import numpy as np
from fastapi import APIRouter, HTTPException, Query

from ..db import db_path, init_db
from ..db import connect
from ..repositories import create_or_update_artist as _create_or_update_artist
from ..repositories import get_artist_embeddings as _get_artist_embeddings
from ..repositories import get_artist_response as _get_artist_response
from ..repositories import get_track_embedding as _get_track_embedding
from ..repositories import get_track_samples as _get_track_samples
from ..repositories import list_artist_tracks as _list_artist_tracks
from ..repositories import list_artists as _list_artists
from ..repositories import list_track_embeddings as _list_track_embeddings
from ..repositories import list_tracks as _list_tracks
from ..repositories import similarity_search as _similarity_search
from ..runtime import now
from ..schemas import ArtistCreate, SimilaritySearchRequest
from ..vectorstore import IDS_FILE, METADATA_FILE, VECTORS_FILE, default_chroma_dir, default_numpy_store_dir, default_vector_store_backend


router = APIRouter()


@router.get("/health")
async def health() -> dict[str, str]:
    """Return API health and active SQLite database path."""
    return {"status": "ok", "database": str(db_path())}


@router.get("/ready")
async def ready() -> dict[str, Any]:
    """Return readiness for dependencies needed by the deployed visualizer."""
    status = readiness_status()
    if status["status"] != "ok":
        raise HTTPException(status_code=503, detail=status)
    return status


def readiness_status() -> dict[str, Any]:
    """Check database/schema and configured vector-store files."""
    checks = {
        "database": _database_readiness(),
        "vector_store": _vector_store_readiness(),
    }
    problems = [name for name, check in checks.items() if not check.get("ok")]
    return {
        "status": "ok" if not problems else "not_ready",
        "database": str(db_path()),
        "vector_store_backend": default_vector_store_backend(),
        "checks": checks,
    }


def _database_readiness() -> dict[str, Any]:
    path = db_path()
    if not path.exists():
        return {"ok": False, "detail": "database file is missing"}
    required_tables = {"artists", "tracks", "track_embeddings", "embedding_layouts", "users", "user_preferences"}
    try:
        with connect() as conn:
            quick_check = conn.execute("PRAGMA quick_check").fetchone()[0]
            rows = conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'").fetchall()
            tables = {row["name"] for row in rows}
    except Exception as exc:
        return {"ok": False, "detail": str(exc)}
    missing = sorted(required_tables - tables)
    return {"ok": quick_check == "ok" and not missing, "quick_check": quick_check, "missing_tables": missing}


def _vector_store_readiness() -> dict[str, Any]:
    backend = default_vector_store_backend()
    if backend == "numpy":
        return _numpy_vector_store_readiness()
    if backend == "chroma":
        path = default_chroma_dir()
        return {"ok": path.exists(), "path": str(path), "detail": "chroma directory exists" if path.exists() else "chroma directory is missing"}
    return {"ok": False, "detail": f"unsupported vector store backend: {backend}"}


def _numpy_vector_store_readiness() -> dict[str, Any]:
    store_dir = default_numpy_store_dir()
    paths = {"ids": store_dir / IDS_FILE, "metadata": store_dir / METADATA_FILE, "vectors": store_dir / VECTORS_FILE}
    missing = [name for name, path in paths.items() if not path.exists()]
    if missing:
        return {"ok": False, "path": str(store_dir), "missing": missing}
    try:
        ids = json.loads(paths["ids"].read_text(encoding="utf-8"))
        with paths["metadata"].open("r", encoding="utf-8") as handle:
            metadata_count = sum(1 for line in handle if line.strip())
        vectors = np.load(paths["vectors"], mmap_mode="r")
    except Exception as exc:
        return {"ok": False, "path": str(store_dir), "detail": str(exc)}
    vector_count = int(vectors.shape[0]) if vectors.ndim >= 1 else 0
    consistent = len(ids) == metadata_count == vector_count
    return {
        "ok": consistent and vector_count > 0,
        "path": str(store_dir),
        "ids": len(ids),
        "metadata": metadata_count,
        "vectors": vector_count,
        "detail": "ready" if consistent and vector_count > 0 else "numpy vector store is empty or inconsistent",
    }


@router.post("/artists")
async def create_artist(payload: ArtistCreate) -> dict[str, Any]:
    """Create an artist or update an existing artist by name."""
    init_db()
    return _create_or_update_artist(payload, now)


@router.get("/artists")
async def list_artists() -> list[dict[str, Any]]:
    """List all artists in the database."""
    init_db()
    return _list_artists()


@router.get("/artists/{artist_id}")
async def get_artist(artist_id: int) -> dict[str, Any]:
    """Return one artist by primary key."""
    init_db()
    return _get_artist_response(artist_id)


@router.get("/artists/{artist_id}/tracks")
async def list_artist_tracks(artist_id: int, include_embedding: bool = False) -> list[dict[str, Any]]:
    """List tracks for one artist, optionally including latest vectors."""
    init_db()
    return _list_artist_tracks(artist_id, include_embedding=include_embedding)


@router.get("/tracks")
async def list_tracks(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=100, ge=1),
    include_embedding: bool = False,
) -> dict[str, Any]:
    """List tracks with pagination and optional embedding vectors."""
    init_db()
    return _list_tracks(page=page, page_size=page_size, include_embedding=include_embedding)


@router.get("/tracks/{track_id}/samples")
async def get_track_samples(track_id: int) -> list[dict[str, Any]]:
    """Return recorded audio chunk metadata for a track."""
    init_db()
    return _get_track_samples(track_id)


@router.get("/tracks/{track_id}/embeddings")
async def list_track_embeddings(track_id: int, include_embedding: bool = False) -> list[dict[str, Any]]:
    """Return stored embedding rows for one track."""
    init_db()
    return _list_track_embeddings(track_id, include_embedding=include_embedding)


@router.post("/similarity/track-embeddings")
async def search_similar_track_embeddings(payload: SimilaritySearchRequest) -> dict[str, Any]:
    """Search for tracks similar to a vector, vectors, or track IDs."""
    init_db()
    return {"results": _similarity_search(payload)}


@router.get("/tracks/{track_id}/embedding")
async def get_track_embedding(track_id: int) -> dict[str, Any]:
    """Return one track with its latest embedding vector."""
    init_db()
    return _get_track_embedding(track_id)


@router.get("/artists/{artist_id}/embeddings")
async def get_artist_embeddings(artist_id: int, include_tracks: bool = Query(default=True)) -> dict[str, Any]:
    """Return averaged embedding data for one artist."""
    init_db()
    return _get_artist_embeddings(artist_id, include_tracks=include_tracks)
