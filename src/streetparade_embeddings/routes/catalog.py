from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Query

from ..db import db_path, init_db
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


router = APIRouter()


@router.get("/health")
async def health() -> dict[str, str]:
    """Return API health and active SQLite database path."""
    return {"status": "ok", "database": str(db_path())}


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
