from __future__ import annotations

import argparse
import json
from pathlib import Path

from build_embedding_visualization import DEFAULT_CHROMA_DIR, DEFAULT_DB, DEFAULT_SNAPSHOT
from build_embedding_visualization import load_track_points, snapshot_payload


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Create a compact static data snapshot from SQLite metadata and Chroma embeddings."
    )
    parser.add_argument("--db", type=Path, default=DEFAULT_DB, help="SQLite metadata database path.")
    parser.add_argument("--chroma-dir", type=Path, default=DEFAULT_CHROMA_DIR, help="Chroma persistence directory.")
    parser.add_argument("--out", type=Path, default=DEFAULT_SNAPSHOT, help="Snapshot JSON output path.")
    parser.add_argument(
        "--model",
        default=None,
        help="Optional embedding_model filter. By default the latest embedding per track is snapshotted.",
    )
    return parser.parse_args()


def create_static_data_snapshot(
    db_path: Path = DEFAULT_DB,
    chroma_dir: Path = DEFAULT_CHROMA_DIR,
    output_path: Path = DEFAULT_SNAPSHOT,
    model: str | None = None,
) -> dict[str, object]:
    track_points = load_track_points(db_path, chroma_dir, model=model)
    payload = snapshot_payload(track_points, db_path=db_path, chroma_dir=chroma_dir, model=model)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return payload


def main() -> None:
    args = parse_args()
    payload = create_static_data_snapshot(args.db, args.chroma_dir, args.out, model=args.model)
    print(f"Wrote {payload['track_point_count']} track embeddings to {args.out}")


if __name__ == "__main__":
    main()
