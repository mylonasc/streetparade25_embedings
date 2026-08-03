from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import numpy as np

DEFAULT_COLLECTION = "track_embeddings"


def default_chroma_dir() -> Path:
    """Return the configured ChromaDB persistence directory."""
    return Path(os.environ.get("STREETPARADE_CHROMA_DIR", "chroma"))


def _metadata_value(value: Any) -> str | int | float | bool | None:
    if value is None or isinstance(value, str | int | float | bool):
        return value
    return str(value)


def _metadata(metadata: dict[str, Any]) -> dict[str, str | int | float | bool | None]:
    return {key: _metadata_value(value) for key, value in metadata.items()}


class ChromaVectorStore:
    """Local ChromaDB-backed storage for audio embeddings."""

    def __init__(self, persist_dir: str | Path | None = None, collection_name: str = DEFAULT_COLLECTION):
        try:
            import chromadb
        except ImportError as exc:
            raise RuntimeError("Vector storage requires chromadb. Install the project dependencies first.") from exc

        self.persist_dir = Path(persist_dir) if persist_dir is not None else default_chroma_dir()
        self.persist_dir.mkdir(parents=True, exist_ok=True)
        self.client = chromadb.PersistentClient(path=str(self.persist_dir))
        self.collection = self.client.get_or_create_collection(name=collection_name, metadata={"hnsw:space": "cosine"})

    def upsert_embedding(self, vector_id: str, embedding: np.ndarray, metadata: dict[str, Any]) -> str:
        """Insert or replace an embedding vector and metadata.

        Args:
            vector_id: Stable vector identifier used as the ChromaDB ID.
            embedding: Numeric vector to store.
            metadata: Metadata values to store alongside the vector.

        Returns:
            The stored ``vector_id``.
        """
        vector = np.asarray(embedding, dtype=np.float32).astype(float).tolist()
        self.collection.upsert(ids=[vector_id], embeddings=[vector], metadatas=[_metadata(metadata)])
        return vector_id

    def get_embedding(self, vector_id: str) -> list[float] | None:
        """Load one embedding vector by ID.

        Args:
            vector_id: ChromaDB vector identifier.

        Returns:
            Vector values as floats, or ``None`` when no vector exists.
        """
        result = self.collection.get(ids=[vector_id], include=["embeddings"])
        embeddings = result.get("embeddings")
        if embeddings is None or len(embeddings) == 0:
            return None
        return [float(value) for value in embeddings[0]]

    def query_by_vector(
        self,
        embedding: list[float] | np.ndarray,
        n_results: int = 10,
        where: dict[str, Any] | None = None,
    ) -> list[dict[str, Any]]:
        """Find nearest stored embeddings to a query vector.

        Args:
            embedding: Query embedding vector.
            n_results: Maximum number of neighbors to return.
            where: Optional ChromaDB metadata filter.

        Returns:
            Ranked result dictionaries with vector IDs, distances, similarities,
            and metadata.
        """
        vector = np.asarray(embedding, dtype=np.float32).astype(float).tolist()
        result = self.collection.query(
            query_embeddings=[vector],
            n_results=n_results,
            where=_metadata(where) if where else None,
            include=["metadatas", "distances"],
        )
        return _query_result_items(result)

    def query_by_embedding_ids(
        self,
        vector_ids: list[str],
        n_results: int = 10,
        where: dict[str, Any] | None = None,
    ) -> list[dict[str, Any]]:
        """Find neighbors for the centroid of existing embeddings.

        Args:
            vector_ids: Existing vector IDs used to compute the query centroid.
            n_results: Maximum number of neighbors to return.
            where: Optional ChromaDB metadata filter.

        Returns:
            Ranked neighbor results, or an empty list when none of the requested
            IDs have vectors.
        """
        vectors = self.collection.get(ids=vector_ids, include=["embeddings"]).get("embeddings")
        if vectors is None or len(vectors) == 0:
            return []
        centroid = np.mean(np.asarray(vectors, dtype=np.float32), axis=0)
        return self.query_by_vector(centroid, n_results=n_results, where=where)


def _query_result_items(result: dict[str, Any]) -> list[dict[str, Any]]:
    ids = (result.get("ids") or [[]])[0]
    metadatas = (result.get("metadatas") or [[]])[0]
    distances = (result.get("distances") or [[]])[0]
    items = []
    for idx, vector_id in enumerate(ids):
        distance = float(distances[idx]) if idx < len(distances) and distances[idx] is not None else None
        items.append(
            {
                "vector_id": vector_id,
                "distance": distance,
                "similarity": None if distance is None else 1.0 - distance,
                "metadata": metadatas[idx] if idx < len(metadatas) else {},
            }
        )
    return items


def get_vector_store(persist_dir: str | Path | None = None) -> ChromaVectorStore:
    """Create a Chroma-backed vector store.

    Args:
        persist_dir: Optional directory overriding ``STREETPARADE_CHROMA_DIR``.

    Returns:
        Initialized vector store instance.
    """
    return ChromaVectorStore(persist_dir=persist_dir)
