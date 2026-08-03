from __future__ import annotations

import os
import shutil
import sqlite3
from pathlib import Path


def main() -> None:
    """Seed the configured runtime database from a seed database when empty.

    The source is read from ``STREETPARADE_SEED_DB`` and the destination from
    ``STREETPARADE_DB``. Copying is skipped when the seed is missing, both paths
    are the same, or the destination already has embedding rows.
    """
    seed = Path(os.environ.get("STREETPARADE_SEED_DB", ""))
    target = Path(os.environ.get("STREETPARADE_DB", "streetparade_embeddings.sqlite3"))
    if not seed or not seed.exists() or seed.resolve() == target.resolve():
        return

    seed_embeddings = embedding_count(seed)
    target_embeddings = embedding_count(target) if target.exists() else 0
    if seed_embeddings > 0 and target_embeddings == 0:
        target.parent.mkdir(parents=True, exist_ok=True)
        try:
            shutil.copy2(seed, target)
            print(f"Seeded {target} from {seed} with {seed_embeddings} embedding rows")
        except OSError as exc:
            print(f"Could not seed {target} from {seed}: {exc}")


def embedding_count(path: Path) -> int:
    """Count track embedding rows in a SQLite database.

    Args:
        path: SQLite database path.

    Returns:
        Number of rows in ``track_embeddings``, or ``0`` when the database/table
        cannot be read.
    """
    if not path.exists():
        return 0
    try:
        with sqlite3.connect(path) as conn:
            row = conn.execute(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'track_embeddings'"
            ).fetchone()
            if not row or int(row[0]) == 0:
                return 0
            return int(conn.execute("SELECT COUNT(*) FROM track_embeddings").fetchone()[0])
    except sqlite3.Error:
        return 0


if __name__ == "__main__":
    main()
