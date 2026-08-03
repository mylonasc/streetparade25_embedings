from __future__ import annotations

import argparse
import os
import sqlite3
from collections import defaultdict
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

import numpy as np

from streetparade_embeddings.audio import DEFAULT_SAMPLING_RATE, preprocess_track
from streetparade_embeddings.db import ensure_sample_embedding_table
from streetparade_embeddings.embeddings import ClapEmbeddingModel
from streetparade_embeddings.provenance import canonical_json, config_hash
from streetparade_embeddings.vectorstore import ChromaVectorStore, DEFAULT_COLLECTION


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Compute CLAP segment embeddings needed for training from an annotation_campaign.",
    )
    parser.add_argument("--campaign-id", type=int, default=int(os.environ.get("ANNOTATION_CAMPAIGN_ID", "1")))
    parser.add_argument("--db", type=Path, default=Path(os.environ.get("STREETPARADE_DB", "data/streetparade_embeddings.sqlite3")))
    parser.add_argument("--chroma-dir", type=Path, default=Path(os.environ.get("STREETPARADE_CHROMA_DIR", "chroma")))
    parser.add_argument("--collection", default=os.environ.get("STREETPARADE_CHROMA_COLLECTION", DEFAULT_COLLECTION))
    parser.add_argument("--model-name", default="laion/clap-htsat-unfused")
    parser.add_argument("--device", default="auto", choices=["auto", "cpu", "cuda"])
    parser.add_argument("--sampling-rate", type=int, default=DEFAULT_SAMPLING_RATE)
    parser.add_argument("--chunk-seconds", type=int, default=30)
    parser.add_argument("--chunk-stride-seconds", type=int, default=60)
    parser.add_argument("--max-chunks", type=int, default=10)
    parser.add_argument("--limit", type=int, default=None, help="Optional maximum number of segments to process.")
    parser.add_argument("--force", action="store_true", help="Recompute even when a matching sample_embedding row exists.")
    parser.add_argument(
        "--audio-root",
        action="append",
        default=[],
        help="Additional root used to remap stored .songs_cache paths. May be provided multiple times.",
    )
    return parser.parse_args()


def connect(db_path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA busy_timeout = 30000")
    return conn


def assert_database_writable(conn: sqlite3.Connection, db_path: Path, campaign_id: int) -> None:
    if not db_path.exists():
        raise SystemExit(f"SQLite DB does not exist: {db_path}")
    if not os.access(db_path, os.W_OK):
        raise SystemExit(
            f"SQLite DB is not writable: {db_path}\n"
            "Use a writable copy of the DB, fix file ownership/permissions, or change the Docker volume from read-only to read-write."
        )
    if not os.access(db_path.parent, os.W_OK):
        raise SystemExit(
            f"SQLite DB directory is not writable: {db_path.parent}\n"
            "SQLite may need to create WAL/journal files next to the database.\n"
            f"Fix locally with: sudo chown $USER:$USER {db_path.parent} && chmod u+w {db_path.parent}"
        )
    try:
        conn.execute("SAVEPOINT write_check")
        cursor = conn.execute("UPDATE annotation_campaign SET updated_at = updated_at WHERE id = ?", (campaign_id,))
        if cursor.rowcount == 0:
            raise SystemExit(f"annotation_campaign {campaign_id} does not exist in {db_path}")
        conn.execute("ROLLBACK TO write_check")
        conn.execute("RELEASE write_check")
    except sqlite3.OperationalError as exc:
        try:
            conn.execute("ROLLBACK TO write_check")
            conn.execute("RELEASE write_check")
        except sqlite3.Error:
            pass
        if "readonly" in str(exc).lower() or "read-only" in str(exc).lower():
            raise SystemExit(
                f"SQLite DB opened read-only and cannot store sample_embeddings: {db_path}\n"
                "Fix ownership/permissions, run against a writable DB copy, or mount the DB volume read-write."
            ) from exc
        raise


def now() -> str:
    return datetime.now(UTC).isoformat()


def sampling_strategy(args: argparse.Namespace) -> dict[str, Any]:
    return {
        "sampling_rate": args.sampling_rate,
        "channels": 1,
        "chunk_seconds": args.chunk_seconds,
        "chunk_stride_seconds": args.chunk_stride_seconds,
        "max_chunks": args.max_chunks,
        "normalize": "int16_to_float32",
    }


def embedding_model_config(args: argparse.Namespace) -> dict[str, Any]:
    return {
        "backend": "clap",
        "model_name": args.model_name,
        "model_revision": None,
        "device": args.device,
        "options": {},
    }


def pipeline_config(args: argparse.Namespace) -> dict[str, Any]:
    return {
        "embedding_model": embedding_model_config(args),
        "sampling_strategy": sampling_strategy(args),
        "annotation_campaign_id": args.campaign_id,
        "source": "ml_pipeline/2_train/compute_set_training_embedings.py",
    }


def select_required_segments(
    conn: sqlite3.Connection,
    campaign_id: int,
    model_hash: str,
    sampling_hash: str,
    force: bool,
    limit: int | None,
) -> list[sqlite3.Row]:
    where = ["items.annotation_campaign_id = ?"]
    params: list[Any] = [campaign_id]
    if not force:
        where.append(
            """
            NOT EXISTS (
                SELECT 1
                FROM sample_embeddings existing
                WHERE existing.track_sample_id = items.track_sample_id
                  AND existing.embedding_backend = 'clap'
                  AND existing.embedding_model_config_hash = ?
                  AND existing.sampling_strategy_hash = ?
            )
            """
        )
        params.extend([model_hash, sampling_hash])

    query = f"""
        SELECT
            items.id AS annotation_item_id,
            items.track_id,
            items.track_sample_id,
            samples.chunk_index,
            samples.start_seconds,
            samples.duration_seconds,
            tracks.uuid AS track_uuid,
            tracks.url AS track_url,
            tracks.path AS track_path
        FROM annotation_items items
        JOIN track_samples samples ON samples.id = items.track_sample_id
        JOIN tracks ON tracks.id = items.track_id
        WHERE {' AND '.join(where)}
        ORDER BY items.track_id, samples.chunk_index
    """
    if limit is not None:
        query += " LIMIT ?"
        params.append(limit)
    return conn.execute(query, params).fetchall()


def resolve_audio_path(path_value: str | None, db_path: Path, audio_roots: list[str]) -> Path | None:
    if not path_value:
        return None
    original = Path(path_value).expanduser()
    candidates = [original]
    if not original.is_absolute():
        candidates.extend([db_path.parent / original, Path.cwd() / original])

    roots = [Path(value).expanduser() for value in audio_roots]
    roots.extend(Path(value).expanduser() for value in os.environ.get("ANNOTATION_AUDIO_ROOTS", "").split(",") if value.strip())
    roots.extend([Path(".songs_cache"), Path("/app/.songs_cache")])

    parts = original.parts
    if ".songs_cache" in parts:
        relative_to_cache = Path(*parts[parts.index(".songs_cache") + 1 :])
        candidates.extend(root / relative_to_cache for root in roots)

    for candidate in candidates:
        if candidate.exists():
            return candidate
    return None


def store_sample_embedding(
    conn: sqlite3.Connection,
    vector_store: ChromaVectorStore,
    row: sqlite3.Row,
    embedding: np.ndarray,
    args: argparse.Namespace,
    model_config: dict[str, Any],
    model_hash: str,
    sample_strategy: dict[str, Any],
    sampling_hash: str,
    run_config: dict[str, Any],
) -> str:
    timestamp = now()
    embedding_uuid = uuid4().hex
    vector_id = f"sample:{row['track_sample_id']}:embedding:{embedding_uuid}"
    metadata = {
        "vector_id": vector_id,
        "track_id": int(row["track_id"]),
        "track_uuid": row["track_uuid"],
        "track_sample_id": int(row["track_sample_id"]),
        "chunk_index": int(row["chunk_index"]),
        "start_seconds": float(row["start_seconds"]),
        "duration_seconds": float(row["duration_seconds"]),
        "embedding_backend": "clap",
        "embedding_model": args.model_name,
        "embedding_model_config_hash": model_hash,
        "sampling_strategy_hash": sampling_hash,
        "embedding_dim": int(embedding.shape[0]),
        "embedded_at": timestamp,
    }
    vector_store.upsert_embedding(vector_id, embedding, metadata)
    conn.execute(
        """
        INSERT INTO sample_embeddings (
            uuid, vector_id, track_id, track_sample_id, chunk_index, start_seconds, duration_seconds,
            embedding_backend, embedding_model, embedding_model_config, embedding_model_config_hash,
            sampling_strategy, sampling_strategy_hash, pipeline_config, embedding_dim, embedded_at,
            last_error, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, 'clap', ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
        ON CONFLICT(track_sample_id, embedding_backend, embedding_model, embedding_model_config_hash, sampling_strategy_hash)
        DO UPDATE SET
            uuid = excluded.uuid,
            vector_id = excluded.vector_id,
            chunk_index = excluded.chunk_index,
            start_seconds = excluded.start_seconds,
            duration_seconds = excluded.duration_seconds,
            embedding_model_config = excluded.embedding_model_config,
            sampling_strategy = excluded.sampling_strategy,
            pipeline_config = excluded.pipeline_config,
            embedding_dim = excluded.embedding_dim,
            embedded_at = excluded.embedded_at,
            last_error = NULL,
            updated_at = excluded.updated_at
        """,
        (
            embedding_uuid,
            vector_id,
            int(row["track_id"]),
            int(row["track_sample_id"]),
            int(row["chunk_index"]),
            float(row["start_seconds"]),
            float(row["duration_seconds"]),
            args.model_name,
            canonical_json(model_config),
            model_hash,
            canonical_json(sample_strategy),
            sampling_hash,
            canonical_json(run_config),
            int(embedding.shape[0]),
            timestamp,
            timestamp,
            timestamp,
        ),
    )
    return vector_id


def compute_embeddings(args: argparse.Namespace) -> None:
    model_config = embedding_model_config(args)
    model_hash = config_hash(model_config)
    sample_strategy = sampling_strategy(args)
    sampling_hash = config_hash(sample_strategy)
    run_config = pipeline_config(args)

    with connect(args.db) as conn:
        assert_database_writable(conn, args.db, args.campaign_id)
        ensure_sample_embedding_table(conn)
        rows = select_required_segments(conn, args.campaign_id, model_hash, sampling_hash, args.force, args.limit)
        if not rows:
            print("No missing segment embeddings found for this annotation_campaign/configuration.")
            return

        by_track: dict[int, list[sqlite3.Row]] = defaultdict(list)
        for row in rows:
            by_track[int(row["track_id"])].append(row)

        print(f"segments to embed: {len(rows)}")
        print(f"tracks to load: {len(by_track)}")

        vector_store = ChromaVectorStore(persist_dir=args.chroma_dir, collection_name=args.collection)
        model = ClapEmbeddingModel(model_name=args.model_name, device=args.device)

        stored_count = 0
        skipped_count = 0
        for track_id, track_rows in by_track.items():
            first = track_rows[0]
            audio_path = resolve_audio_path(first["track_path"], args.db, args.audio_root)
            if audio_path is None:
                skipped_count += len(track_rows)
                print(f"skip track {track_id}: audio not found: {first['track_path']}")
                continue

            try:
                chunks = preprocess_track(
                    audio_path,
                    sampling_rate=args.sampling_rate,
                    chunk_seconds=args.chunk_seconds,
                    stride_seconds=args.chunk_stride_seconds,
                    max_chunks=args.max_chunks,
                )
                available_rows = [row for row in track_rows if int(row["chunk_index"]) < len(chunks)]
                missing_chunk_rows = len(track_rows) - len(available_rows)
                if missing_chunk_rows:
                    skipped_count += missing_chunk_rows
                    print(f"skip {missing_chunk_rows} segment(s) for track {track_id}: chunk index outside preprocessed chunks")
                if not available_rows:
                    continue

                selected_chunks = [chunks[int(row["chunk_index"])] for row in available_rows]
                embeddings = model.embed_chunk_batch(selected_chunks, sampling_rate=args.sampling_rate)
                for row, embedding in zip(available_rows, embeddings):
                    store_sample_embedding(
                        conn,
                        vector_store,
                        row,
                        np.asarray(embedding, dtype=np.float32),
                        args,
                        model_config,
                        model_hash,
                        sample_strategy,
                        sampling_hash,
                        run_config,
                    )
                    stored_count += 1
                conn.commit()
                print(f"track {track_id}: stored {len(available_rows)} segment embedding(s)")
            except Exception as exc:
                if isinstance(exc, sqlite3.OperationalError) and ("readonly" in str(exc).lower() or "read-only" in str(exc).lower()):
                    raise SystemExit(
                        f"SQLite DB became read-only while storing segment embeddings: {args.db}\n"
                        "No further tracks will be processed. Fix DB write permissions and rerun."
                    ) from exc
                skipped_count += len(track_rows)
                print(f"skip track {track_id}: {exc}")

    print({"stored": stored_count, "skipped": skipped_count})


def main() -> None:
    compute_embeddings(parse_args())


if __name__ == "__main__":
    main()
