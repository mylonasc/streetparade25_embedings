"""Prepare an isolated runtime database for the Street Parade e2e suite.

Copies the repository SQLite database to a throwaway path and seeds:

1. one anonymous ``completed`` ``embedding_layouts`` row so the initial map
   renders immediately instead of running a full t-SNE projection on first
   load. The layout carries placeholder points with exactly ``SEED_CLUSTERS``
   distinct cluster IDs, which lets the layout recompute spec assert that a
   requested cluster count actually reaches the UI;
2. a handful of real artist tracks whose metadata exposes ``love_mobiles``
   with per-artist set times, so the shared page and loved-trucks modal render
   their score/time sliders when a quality user has preferences;
3. ``up`` artist preferences for the ``quality-*`` usernames used by the
   visual-quality spec, which is what turns those artists into loved trucks
   (and therefore renders the sliders).
"""

from __future__ import annotations

import json
import re
import shutil
import sqlite3
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

SEED_CLUSTERS = 7

# Usernames used by streetparade-quality.spec.js (one per device).
SEED_USERS = [
    "quality-pixel-7",
    "quality-pixel-10",
    "quality-iphone-se-3rd-gen",
    "quality-iphone-13",
    "quality-iphone-16",
]

# Real artists that have both tracks in the embeddings and love mobiles. Their
# artist points exist in the seeded layout and survive a layout recompute, so
# the quality spec sees trucks (and sliders) regardless of test ordering.
FEATURED_ARTISTS = ["AIIA", "Alanor", "Aleno", "Alessio Sassano"]

TRACKS_PER_ARTIST = 2


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _slugify(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", str(value).lower()).strip("-") or "artist"


def _fresh_copy(source: Path, target: Path) -> None:
    for suffix in ("", "-wal", "-shm"):
        stale = Path(str(target) + suffix)
        if stale.exists():
            stale.unlink()
    shutil.copy2(source, target)


def _ensure_set_time_columns(conn: sqlite3.Connection) -> None:
    columns = {row["name"] for row in conn.execute("PRAGMA table_info(artist_love_mobiles)")}
    for column, definition in (("set_order", "INTEGER"), ("set_start", "TEXT"), ("set_end", "TEXT")):
        if column not in columns:
            conn.execute(f"ALTER TABLE artist_love_mobiles ADD COLUMN {column} {definition}")


def _parse_clock(text: str | None) -> int | None:
    if not text:
        return None
    parts = text.strip().replace(".", ":").split(":")
    if len(parts) != 2:
        return None
    try:
        hours, minutes = int(parts[0]), int(parts[1])
    except ValueError:
        return None
    if not (0 <= hours < 24) or not (0 <= minutes < 60):
        return None
    return hours * 60 + minutes


def _format_clock(minutes: float) -> str:
    minutes = int(round(minutes))
    if minutes >= 24 * 60:
        minutes -= 24 * 60
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def _equal_set_times(time: str | None, count: int) -> list[tuple[str, str] | None]:
    if count <= 0:
        return []
    bounds = re.split(r"\s*[-–]\s*", time or "")
    if len(bounds) != 2:
        return [None for _ in range(count)]
    start = _parse_clock(bounds[0])
    end = _parse_clock(bounds[1])
    if start is None or end is None:
        return [None for _ in range(count)]
    if end <= start:
        end += 24 * 60
    span = (end - start) / count
    return [(_format_clock(start + index * span), _format_clock(start + (index + 1) * span)) for index in range(count)]


def _json_value(value: str | None, default: object) -> object:
    if not value:
        return default
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return default


def _artist_love_mobiles(conn: sqlite3.Connection, artist_id: int, artist_name: str) -> list[dict[str, object]]:
    rows = conn.execute(
        """
        SELECT lm.id, lm.uuid, lm.source_index, lm.number, lm.name, lm.title, lm.genres,
               lm.motto, lm.time, lm.description, lm.image, lm.links, lm.source
        FROM artist_love_mobiles alm
        JOIN love_mobiles lm ON lm.id = alm.love_mobile_id
        WHERE alm.artist_id = ?
        ORDER BY alm.id
        """,
        (artist_id,),
    ).fetchall()
    result: list[dict[str, object]] = []
    for row in rows:
        truck_artists = [
            item["artist_name"]
            for item in conn.execute(
                "SELECT artist_name FROM artist_love_mobiles WHERE love_mobile_id = ? ORDER BY id",
                (row["id"],),
            ).fetchall()
        ]
        slots = _equal_set_times(row["time"], len(truck_artists))
        index = truck_artists.index(artist_name) if artist_name in truck_artists else 0
        slot = slots[index] if index < len(slots) else None
        result.append(
            {
                "id": row["id"],
                "uuid": row["uuid"],
                "source_index": row["source_index"],
                "number": row["number"],
                "name": row["name"],
                "title": row["title"],
                "genres": row["genres"],
                "motto": row["motto"],
                "time": row["time"],
                "description": row["description"],
                "image": _json_value(row["image"], {}),
                "links": _json_value(row["links"], []),
                "source": row["source"],
                "artist_name": artist_name,
                "artist_bio": None,
                "artist_links": [],
                "set_order": index,
                "set_start": slot[0] if slot else None,
                "set_end": slot[1] if slot else None,
            }
        )
    return result


def _featured_artist_ids(conn: sqlite3.Connection) -> list[tuple[int, str]]:
    placeholders = ", ".join("?" for _ in FEATURED_ARTISTS)
    rows = conn.execute(
        f"""
        SELECT id, name FROM artists
        WHERE name IN ({placeholders})
        ORDER BY name
        """,
        FEATURED_ARTISTS,
    ).fetchall()
    return [(int(row["id"]), str(row["name"])) for row in rows]


def seed(target: Path) -> None:
    with sqlite3.connect(target) as conn:
        conn.row_factory = sqlite3.Row
        _ensure_set_time_columns(conn)
        row = conn.execute("SELECT COUNT(*) FROM tracks").fetchone()
        track_count = int(row[0]) if row else 0
        if track_count <= 0:
            print(f"no tracks in {target}; skipping seed layout")
            return

        featured = _featured_artist_ids(conn)
        points: list[dict[str, object]] = []
        counter = 0
        cluster_assignments: dict[str, int] = {}

        def next_cluster() -> int:
            return counter % SEED_CLUSTERS

        for artist_id, artist_name in featured:
            love_mobiles = _artist_love_mobiles(conn, artist_id, artist_name)
            for _ in range(TRACKS_PER_ARTIST):
                counter += 1
                cluster = next_cluster()
                cluster_assignments[f"artist:{artist_name}"] = cluster
                points.append(
                    {
                        "id": f"track-{counter}",
                        "kind": "track",
                        "label": f"Seed artist track {counter} - {artist_name}",
                        "x": float(counter % 20),
                        "y": float(counter // 20),
                        "cluster": cluster,
                        "metadata": {
                            "track_id": counter,
                            "title": f"Seed artist track {counter}",
                            "artist_name": artist_name,
                            "url": "",
                            "love_mobiles": love_mobiles,
                        },
                    }
                )

        while counter < track_count:
            counter += 1
            points.append(
                {
                    "id": f"track-{counter}",
                    "kind": "track",
                    "label": f"Seed track {counter}",
                    "x": float(counter % 20),
                    "y": float(counter // 20),
                    "cluster": counter % SEED_CLUSTERS,
                    "metadata": {},
                }
            )

        points.append(
            {
                "id": "track-90000",
                "kind": "track",
                "label": (
                    "Seed track 90000 - long-label-ellipsis regression: a deliberately very long "
                    "track label that must render as a single line with an ellipsis inside the "
                    "in-canvas search results instead of blowing out the map-card grid track or "
                    "being clipped without an ellipsis indicator"
                ),
                "x": 19.5,
                "y": 19.5,
                "cluster": 0,
                "metadata": {},
            }
        )

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

        # Artist-only "up" preferences: they turn the featured artists into
        # loved trucks (rendering the shared-page/modal sliders) without
        # giving any artist a positive likeScore, so the "likely" filter
        # keeps showing its empty training state regardless of layout scope.
        artist_targets: list[tuple[str, str, str, int | None]] = []
        for _, artist_name in featured:
            artist_id_value = f"artist-{_slugify(artist_name)}"
            artist_targets.append(("artist", artist_id_value, artist_id_value, None))

        timestamp = _now_iso()
        for username in SEED_USERS:
            conn.execute(
                """
                INSERT INTO users (uuid, username, created_at, updated_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(username) DO UPDATE SET updated_at = excluded.updated_at
                """,
                (uuid.uuid4().hex, username, timestamp, timestamp),
            )
            user_id = conn.execute("SELECT id FROM users WHERE username = ?", (username,)).fetchone()["id"]
            for target_kind, target_id, point_id, track_id in artist_targets:
                conn.execute(
                    """
                    INSERT INTO user_preferences
                        (user_id, username, point_id, target_kind, target_id, track_id, user_track_id, vector_id, value, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, 'up', ?)
                    ON CONFLICT(user_id, target_kind, target_id) DO UPDATE SET
                        value = excluded.value, updated_at = excluded.updated_at
                    """,
                    (user_id, username, point_id, target_kind, target_id, track_id, timestamp),
                )

        print(
            f"seeded anonymous layout with {len(points)} points across {SEED_CLUSTERS} clusters, "
            f"preferences for {len(SEED_USERS)} users over {len(featured)} artists"
        )


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
