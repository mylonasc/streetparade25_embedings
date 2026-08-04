from __future__ import annotations

import argparse
import os
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import yaml

from streetparade_embeddings.db import connect, init_db
from streetparade_embeddings.repositories import create_or_update_artist, upsert_artist_love_mobile, upsert_love_mobile
from streetparade_embeddings.schemas import ArtistCreate


DEFAULT_LOVE_MOBILES_FILE = Path("assets/love-mobiles-26.yaml")


def now() -> str:
    return datetime.now(UTC).isoformat()


def load_love_mobiles(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        data = yaml.safe_load(handle)
    if not isinstance(data, dict):
        raise ValueError(f"expected a mapping in {path}")
    love_mobiles = data.get("love_mobiles")
    if not isinstance(love_mobiles, list):
        raise ValueError(f"expected love_mobiles list in {path}")
    return data


def social_url(links: list[dict[str, Any]], platform: str) -> str | None:
    for link in links:
        if str(link.get("type") or "").lower() == platform and link.get("url"):
            return str(link["url"])
    return None


def artist_payload(raw_artist: dict[str, Any]) -> ArtistCreate:
    links = [link for link in raw_artist.get("links") or [] if isinstance(link, dict)]
    socials = [
        {"platform": str(link["type"]), "url": str(link["url"])}
        for link in links
        if link.get("type") and link.get("url")
    ]
    link_urls = [str(link["url"]) for link in links if link.get("url")]
    return ArtistCreate(
        name=str(raw_artist["name"]),
        links=link_urls,
        socials=socials,
        bio=raw_artist.get("bio") or None,
        soundcloud_url=social_url(links, "soundcloud"),
        instagram=social_url(links, "instagram"),
        youtube=social_url(links, "youtube"),
        web=social_url(links, "website"),
    )


def love_mobile_payload(raw_mobile: dict[str, Any], source: str | None) -> dict[str, Any]:
    return {
        "source_index": raw_mobile["index"],
        "number": raw_mobile["number"],
        "name": raw_mobile["name"],
        "title": raw_mobile.get("title") or raw_mobile["name"],
        "genres": raw_mobile.get("genres"),
        "motto": raw_mobile.get("motto"),
        "time": raw_mobile.get("time"),
        "description": raw_mobile.get("description"),
        "image": raw_mobile.get("image") or {},
        "links": raw_mobile.get("links") or [],
        "source": source,
    }


def import_love_mobiles(path: Path = DEFAULT_LOVE_MOBILES_FILE) -> dict[str, int]:
    data = load_love_mobiles(path)
    init_db()
    source_indices = [int(mobile["index"]) for mobile in data["love_mobiles"] if isinstance(mobile, dict)]
    reset_imported_love_mobile_data(data.get("source"), source_indices)

    stats = {
        "love_mobiles": 0,
        "artist_love_mobile_links": 0,
        "artists_created_or_updated": 0,
    }
    for raw_mobile in data["love_mobiles"]:
        if not isinstance(raw_mobile, dict):
            continue
        love_mobile = upsert_love_mobile(love_mobile_payload(raw_mobile, data.get("source")), now)
        stats["love_mobiles"] += 1

        for raw_artist in raw_mobile.get("artists") or []:
            if not isinstance(raw_artist, dict) or not raw_artist.get("name"):
                continue
            artist = create_or_update_artist(artist_payload(raw_artist), now)
            stats["artists_created_or_updated"] += 1
            upsert_artist_love_mobile(
                int(artist["id"]),
                int(love_mobile["id"]),
                str(raw_artist["name"]),
                raw_artist.get("bio") or None,
                [link for link in raw_artist.get("links") or [] if isinstance(link, dict)],
                now,
            )
            stats["artist_love_mobile_links"] += 1

    return stats


def reset_imported_love_mobile_data(source: str | None, source_indices: list[int]) -> None:
    """Remove existing imported links and stale love mobiles before rebuilding."""
    with connect() as conn:
        if source is None:
            conn.execute("DELETE FROM artist_love_mobiles")
            return
        conn.execute(
            """
            DELETE FROM artist_love_mobiles
            WHERE love_mobile_id IN (
                SELECT id FROM love_mobiles WHERE source = ?
            )
            """,
            (source,),
        )
        if source_indices:
            placeholders = ",".join("?" for _ in source_indices)
            conn.execute(
                f"DELETE FROM love_mobiles WHERE source = ? AND source_index NOT IN ({placeholders})",
                [source, *source_indices],
            )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Import Street Parade 2026 love-mobile stages and artist links.")
    parser.add_argument("--love-mobiles-file", type=Path, default=DEFAULT_LOVE_MOBILES_FILE)
    parser.add_argument("--db", type=Path, default=None, help="SQLite database path. Defaults to STREETPARADE_DB or package default.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if args.db is not None:
        os.environ["STREETPARADE_DB"] = str(args.db)
    stats = import_love_mobiles(args.love_mobiles_file)
    print(
        "done: "
        f"love_mobiles={stats['love_mobiles']}, "
        f"artist_love_mobile_links={stats['artist_love_mobile_links']}, "
        f"artists_created_or_updated={stats['artists_created_or_updated']}"
    )


if __name__ == "__main__":
    main()
