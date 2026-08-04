from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from typing import Any, Protocol

import numpy as np

DEFAULT_COLLECTION = "track_embeddings"
DEFAULT_NUMPY_STORE_DIR = "vectorstore"
IDS_FILE = "ids.json"
METADATA_FILE = "metadata.jsonl"
VECTORS_FILE = "vectors.npy"


class VectorStore(Protocol):
    """Vector-store API used by the API, workers, and visualization code."""

    def upsert_embedding(self, vector_id: str, embedding: np.ndarray, metadata: dict[str, Any]) -> str: ...
    def get_embedding(self, vector_id: str) -> list[float] | None: ...
    def query_by_vector(
        self,
        embedding: list[float] | np.ndarray,
        n_results: int = 10,
        where: dict[str, Any] | None = None,
    ) -> list[dict[str, Any]]: ...
    def query_by_embedding_ids(
        self,
        vector_ids: list[str],
        n_results: int = 10,
        where: dict[str, Any] | None = None,
    ) -> list[dict[str, Any]]: ...


def default_chroma_dir() -> Path:
    """Return the configured ChromaDB persistence directory."""
    return Path(os.environ.get("STREETPARADE_CHROMA_DIR", "chroma"))


def default_numpy_store_dir() -> Path:
    """Return the configured SimpleNumpyVectorStore persistence directory."""
    return Path(os.environ.get("STREETPARADE_NUMPY_VECTOR_DIR", DEFAULT_NUMPY_STORE_DIR))


def default_vector_store_backend() -> str:
    """Return the configured vector store backend name."""
    return os.environ.get("STREETPARADE_VECTOR_STORE", "chroma").strip().lower()


def _metadata_value(value: Any) -> str | int | float | bool | None:
    if value is None or isinstance(value, str | int | float | bool):
        return value
    return str(value)


def _metadata(metadata: dict[str, Any]) -> dict[str, str | int | float | bool | None]:
    return {key: _metadata_value(value) for key, value in metadata.items()}


def _json_default(value: Any) -> Any:
    if isinstance(value, np.integer):
        return int(value)
    if isinstance(value, np.floating):
        return float(value)
    if isinstance(value, np.ndarray):
        return value.tolist()
    return str(value)


class ChromaVectorStore:
    """Local ChromaDB-backed storage for audio embeddings."""

    def __init__(self, persist_dir: str | Path | None = None, collection_name: str = DEFAULT_COLLECTION):
        try:
            import chromadb
        except ImportError as exc:
            raise RuntimeError("Vector storage requires chromadb. Use STREETPARADE_VECTOR_STORE=numpy for the lean store.") from exc

        self.persist_dir = Path(persist_dir) if persist_dir is not None else default_chroma_dir()
        self.persist_dir.mkdir(parents=True, exist_ok=True)
        self.client = chromadb.PersistentClient(path=str(self.persist_dir))
        self.collection = self.client.get_or_create_collection(name=collection_name, metadata={"hnsw:space": "cosine"})

    def upsert_embedding(self, vector_id: str, embedding: np.ndarray, metadata: dict[str, Any]) -> str:
        """Insert or replace an embedding vector and metadata."""
        vector = np.asarray(embedding, dtype=np.float32).astype(float).tolist()
        self.collection.upsert(ids=[vector_id], embeddings=[vector], metadatas=[_metadata(metadata)])
        return vector_id

    def get_embedding(self, vector_id: str) -> list[float] | None:
        """Load one embedding vector by ID."""
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
        """Find nearest stored embeddings to a query vector."""
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
        """Find neighbors for the centroid of existing embeddings."""
        vectors = self.collection.get(ids=vector_ids, include=["embeddings"]).get("embeddings")
        if vectors is None or len(vectors) == 0:
            return []
        centroid = np.mean(np.asarray(vectors, dtype=np.float32), axis=0)
        return self.query_by_vector(centroid, n_results=n_results, where=where)

    def export_to_numpy(
        self,
        output_dir: str | Path,
        batch_size: int = 1000,
    ) -> dict[str, Any]:
        """Export the Chroma collection into SimpleNumpyVectorStore files."""
        output_path = Path(output_dir)
        output_path.mkdir(parents=True, exist_ok=True)
        count = int(self.collection.count())
        ids_path = output_path / IDS_FILE
        metadata_path = output_path / METADATA_FILE
        vectors_path = output_path / VECTORS_FILE

        ids: list[str] = []
        vectors: np.lib.format.open_memmap | None = None
        with metadata_path.open("w", encoding="utf-8") as metadata_file:
            for offset in range(0, count, batch_size):
                batch = self.collection.get(
                    limit=batch_size,
                    offset=offset,
                    include=["embeddings", "metadatas"],
                )
                batch_ids = [str(item) for item in batch.get("ids", [])]
                raw_embeddings = batch.get("embeddings")
                embeddings = np.asarray([] if raw_embeddings is None else raw_embeddings, dtype=np.float32)
                if not batch_ids:
                    continue
                if embeddings.ndim != 2:
                    raise RuntimeError("Chroma export expected a 2D embedding array")
                if vectors is None:
                    vectors = np.lib.format.open_memmap(vectors_path, mode="w+", dtype=np.float32, shape=(count, embeddings.shape[1]))
                vectors[offset : offset + len(batch_ids)] = embeddings
                ids.extend(batch_ids)
                metadatas = batch.get("metadatas") or [{} for _ in batch_ids]
                for metadata in metadatas:
                    metadata_file.write(json.dumps(_metadata(metadata or {}), sort_keys=True, default=_json_default) + "\n")

        if vectors is None:
            np.lib.format.open_memmap(vectors_path, mode="w+", dtype=np.float32, shape=(0, 0))
        else:
            vectors.flush()
            del vectors
        ids_path.write_text(json.dumps(ids, indent=2), encoding="utf-8")
        return {"ids": len(ids), "vectors": str(vectors_path), "metadata": str(metadata_path)}


class SimpleNumpyVectorStore:
    """Small persisted vector store backed by NumPy memmap files."""

    def __init__(self, persist_dir: str | Path | None = None, batch_size: int | None = None):
        self.persist_dir = Path(persist_dir) if persist_dir is not None else default_numpy_store_dir()
        self.batch_size = batch_size or int(os.environ.get("STREETPARADE_NUMPY_VECTOR_BATCH_SIZE", "4096"))
        self.ids_path = self.persist_dir / IDS_FILE
        self.metadata_path = self.persist_dir / METADATA_FILE
        self.vectors_path = self.persist_dir / VECTORS_FILE
        self._loaded = False
        self.ids: list[str] = []
        self.metadata: list[dict[str, Any]] = []
        self.index: dict[str, int] = {}
        self.vectors: np.memmap | np.ndarray | None = None

    def _load(self) -> None:
        if self._loaded:
            return
        if not self.ids_path.exists() or not self.metadata_path.exists() or not self.vectors_path.exists():
            self._loaded = True
            return
        self.ids = [str(item) for item in json.loads(self.ids_path.read_text(encoding="utf-8"))]
        with self.metadata_path.open("r", encoding="utf-8") as handle:
            self.metadata = [json.loads(line) for line in handle if line.strip()]
        self.vectors = np.load(self.vectors_path, mmap_mode="r")
        if len(self.ids) != len(self.metadata) or len(self.ids) != int(self.vectors.shape[0]):
            raise RuntimeError(f"inconsistent SimpleNumpyVectorStore files in {self.persist_dir}")
        self.index = {vector_id: idx for idx, vector_id in enumerate(self.ids)}
        self._loaded = True

    def upsert_embedding(self, vector_id: str, embedding: np.ndarray, metadata: dict[str, Any]) -> str:
        """Insert or replace an embedding vector and persist the full store."""
        self._load()
        vector = np.asarray(embedding, dtype=np.float32)
        if vector.ndim != 1:
            raise ValueError("embedding must be a 1D vector")
        if self.vectors is None or len(self.ids) == 0:
            ids = [vector_id]
            metadatas = [_metadata(metadata)]
            vectors = vector.reshape(1, -1)
        else:
            vectors = np.asarray(self.vectors, dtype=np.float32)
            ids = list(self.ids)
            metadatas = list(self.metadata)
            if vectors.shape[1] != vector.shape[0]:
                raise ValueError(f"embedding dimension mismatch: expected {vectors.shape[1]}, got {vector.shape[0]}")
            if vector_id in self.index:
                idx = self.index[vector_id]
                vectors[idx] = vector
                metadatas[idx] = _metadata(metadata)
            else:
                ids.append(vector_id)
                metadatas.append(_metadata(metadata))
                vectors = np.vstack([vectors, vector])
        write_numpy_store(self.persist_dir, ids, vectors, metadatas)
        self._loaded = False
        self._load()
        return vector_id

    def get_embedding(self, vector_id: str) -> list[float] | None:
        """Load one embedding vector by ID."""
        self._load()
        if self.vectors is None or vector_id not in self.index:
            return None
        return [float(value) for value in self.vectors[self.index[vector_id]]]

    def query_by_vector(
        self,
        embedding: list[float] | np.ndarray,
        n_results: int = 10,
        where: dict[str, Any] | None = None,
    ) -> list[dict[str, Any]]:
        """Find nearest stored embeddings by cosine distance using batched memmap reads."""
        self._load()
        if self.vectors is None or len(self.ids) == 0 or n_results <= 0:
            return []
        query = np.asarray(embedding, dtype=np.float32)
        if query.ndim != 1:
            raise ValueError("query embedding must be a 1D vector")
        query_norm = float(np.linalg.norm(query))
        if query_norm == 0.0:
            raise ValueError("query embedding must not be the zero vector")

        best: list[tuple[float, int]] = []
        for start in range(0, len(self.ids), self.batch_size):
            end = min(start + self.batch_size, len(self.ids))
            indexes = [idx for idx in range(start, end) if _matches_where(self.metadata[idx], where)]
            if not indexes:
                continue
            batch = np.asarray(self.vectors[indexes], dtype=np.float32)
            norms = np.linalg.norm(batch, axis=1)
            valid = norms > 0
            if not np.any(valid):
                continue
            valid_indexes = np.asarray(indexes, dtype=np.int64)[valid]
            scores = batch[valid].dot(query) / (norms[valid] * query_norm)
            distances = 1.0 - scores
            for distance, idx in zip(distances, valid_indexes):
                best.append((float(distance), int(idx)))
            best = sorted(best, key=lambda item: item[0])[:n_results]
        return [self._result_item(distance, idx) for distance, idx in best]

    def query_by_embedding_ids(
        self,
        vector_ids: list[str],
        n_results: int = 10,
        where: dict[str, Any] | None = None,
    ) -> list[dict[str, Any]]:
        """Find neighbors for the centroid of existing embeddings."""
        self._load()
        if self.vectors is None:
            return []
        indexes = [self.index[vector_id] for vector_id in vector_ids if vector_id in self.index]
        if not indexes:
            return []
        centroid = np.mean(np.asarray(self.vectors[indexes], dtype=np.float32), axis=0)
        return self.query_by_vector(centroid, n_results=n_results, where=where)

    def _result_item(self, distance: float, idx: int) -> dict[str, Any]:
        return {
            "vector_id": self.ids[idx],
            "distance": distance,
            "similarity": 1.0 - distance,
            "metadata": self.metadata[idx],
        }


def write_numpy_store(
    output_dir: str | Path,
    ids: list[str],
    vectors: np.ndarray,
    metadatas: list[dict[str, Any]],
) -> None:
    """Write SimpleNumpyVectorStore files."""
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)
    vectors_array = np.asarray(vectors, dtype=np.float32)
    if vectors_array.ndim != 2:
        raise ValueError("vectors must be a 2D array")
    if len(ids) != vectors_array.shape[0] or len(ids) != len(metadatas):
        raise ValueError("ids, vectors, and metadatas must have matching row counts")
    memmap = np.lib.format.open_memmap(output_path / VECTORS_FILE, mode="w+", dtype=np.float32, shape=vectors_array.shape)
    memmap[:] = vectors_array
    memmap.flush()
    del memmap
    (output_path / IDS_FILE).write_text(json.dumps(ids, indent=2), encoding="utf-8")
    with (output_path / METADATA_FILE).open("w", encoding="utf-8") as handle:
        for metadata in metadatas:
            handle.write(json.dumps(_metadata(metadata), sort_keys=True, default=_json_default) + "\n")


def export_chroma_to_numpy(
    chroma_dir: str | Path | None = None,
    output_dir: str | Path | None = None,
    collection_name: str = DEFAULT_COLLECTION,
    batch_size: int = 1000,
) -> dict[str, Any]:
    """Export Chroma vectors to the SimpleNumpyVectorStore file format."""
    source = ChromaVectorStore(persist_dir=chroma_dir, collection_name=collection_name)
    return source.export_to_numpy(output_dir or default_numpy_store_dir(), batch_size=batch_size)


def _matches_where(metadata: dict[str, Any], where: dict[str, Any] | None) -> bool:
    if not where:
        return True
    return all(metadata.get(key) == value for key, value in where.items())


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


def get_vector_store(persist_dir: str | Path | None = None, backend: str | None = None) -> VectorStore:
    """Create the configured vector store."""
    selected = (backend or default_vector_store_backend()).strip().lower()
    if selected in {"numpy", "simple", "simple-numpy"}:
        return SimpleNumpyVectorStore(persist_dir=persist_dir)
    if selected == "chroma":
        return ChromaVectorStore(persist_dir=persist_dir)
    raise ValueError(f"unsupported vector store backend: {selected}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Vector store maintenance utilities.")
    subparsers = parser.add_subparsers(dest="command", required=True)
    export_parser = subparsers.add_parser("export-chroma", help="Export ChromaDB vectors to SimpleNumpyVectorStore files.")
    export_parser.add_argument("--chroma-dir", type=Path, default=default_chroma_dir())
    export_parser.add_argument("--out", type=Path, default=default_numpy_store_dir())
    export_parser.add_argument("--collection", default=DEFAULT_COLLECTION)
    export_parser.add_argument("--batch-size", type=int, default=1000)
    args = parser.parse_args()
    if args.command == "export-chroma":
        result = export_chroma_to_numpy(args.chroma_dir, args.out, args.collection, args.batch_size)
        print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
