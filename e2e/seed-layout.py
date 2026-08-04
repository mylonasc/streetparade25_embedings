"""Prepare an isolated runtime database for the Street Parade e2e suite.

Copies the repository SQLite database to a throwaway path and seeds one
anonymous ``completed`` ``embedding_layouts`` row so the initial map renders
immediately instead of running a full t-SNE projection on first load.

The seeded layout carries placeholder points with exactly ``SEED_CLUSTERS``
distinct cluster IDs, which lets the layout recompute spec assert that a
requested cluster count actually reaches the UI.
"""

from __future__ import annotations

import json
import shutil
import sqlite3
import sys
from pathlib import Path

SEED_CLUSTERS = 7


def _fresh_copy(source: Path, target: Path) -> None:
    for suffix in ("", "-wal", "-shm"):
        stale = Path(str(target) + suffix)
        if stale.exists():
            stale.unlink()
    shutil.copy2(source, target)


def seed(target: Path) -> None:
    with sqlite3.connect(target) as conn:
        row = conn.execute("SELECT COUNT(*) FROM tracks").fetchone()
        track_count = int(row[0]) if row else 0
        if track_count <= 0:
            print(f"no tracks in {target}; skipping seed layout")
            return
        points = [
            {
                "id": f"track-{idx + 1}",
                "kind": "track",
                "label": f"Seed track {idx + 1}",
                "x": float(idx % 20),
                "y": float(idx // 20),
                "cluster": idx % SEED_CLUSTERS,
                "metadata": {},
            }
            for idx in range(track_count)
        ]
        conn.execute(
            """
            INSERT OR REPLACE INTO embedding_layouts
                (id, username, status, points_json, error, created_at, started_at, finished_at)
            VALUES (?, NULL, 'completed', ?, NULL, ?, ?, ?)
            """,
            (
                "seed-layout",
                json.dumps(points),
                "2026-08-04T00:00:00+00:00",
                "2026-08-04T00:00:01+00:00",
                "2026-08-04T00:00:02+00:00",
            ),
        )
        print(f"seeded anonymous layout with {len(points)} points across {SEED_CLUSTERS} clusters")


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("usage: seed-layout.py <source.db> <target.db>")
    source = Path(sys.argv[1])
    target = Path(sys.argv[2])
    target.parent.mkdir(parents=True, exist_ok=True)
    _fresh_copy(source, target)
    seed(target)


if __name__ == "__main__":
    main()
