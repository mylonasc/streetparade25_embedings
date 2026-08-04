from __future__ import annotations

import argparse
import json
import math
import re
import shutil
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import quote, unquote, urlparse

import numpy as np
from sklearn.cluster import SpectralClustering
from sklearn.manifold import TSNE
from sklearn.metrics.pairwise import cosine_similarity

from streetparade_embeddings.vectorstore import get_vector_store


DEFAULT_DB = Path("streetparade_embeddings.sqlite3")
DEFAULT_CHROMA_DIR = Path("chroma")
DEFAULT_OUTPUT_DIR = Path("outputs/embedding_visualization")
DEFAULT_SNAPSHOT = Path("scripts/.data_cache/static_data_snapshot.json")


@dataclass
class EmbeddingPoint:
    id: str
    kind: str
    label: str
    embedding: np.ndarray
    metadata: dict[str, Any]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build a static D3.js embedding visualization from SQLite metadata and Chroma vectors."
    )
    parser.add_argument("--db", type=Path, default=DEFAULT_DB, help="SQLite metadata database path.")
    parser.add_argument("--chroma-dir", type=Path, default=DEFAULT_CHROMA_DIR, help="Chroma persistence directory.")
    parser.add_argument(
        "--snapshot",
        type=Path,
        default=None,
        help="Static data snapshot produced by scripts/create_static_data_snapshot.py. When set, SQLite and Chroma are not read.",
    )
    parser.add_argument("--out", type=Path, default=DEFAULT_OUTPUT_DIR, help="Output directory for the generated site.")
    parser.add_argument("--clusters", type=int, default=None, help="Number of spectral clusters. Defaults to an automatic value.")
    parser.add_argument("--perplexity", type=float, default=None, help="t-SNE perplexity. Defaults to an automatic value.")
    parser.add_argument("--random-state", type=int, default=42, help="Random seed for t-SNE and clustering.")
    parser.add_argument("--tracks-only", action="store_true", help="Exclude artist-average points from the visualization.")
    parser.add_argument(
        "--playback",
        choices=("local", "soundcloud"),
        default="local",
        help="Playback strategy for the generated website.",
    )
    parser.add_argument(
        "--start-fraction",
        type=float,
        default=0.0,
        help="Start playback at this fraction of each song duration, for example 0.5 for the middle.",
    )
    parser.add_argument(
        "--start-seconds",
        type=float,
        default=None,
        help="Start playback at this fixed offset in seconds. Takes precedence over --start-fraction.",
    )
    parser.add_argument(
        "--audio-assets",
        choices=("symlink", "copy", "none"),
        default="symlink",
        help="Expose cached songs in local playback mode. Symlinks avoid duplicating the cache.",
    )
    parser.add_argument(
        "--model",
        default=None,
        help="Optional embedding_model filter. By default the latest embedding per track is used regardless of model.",
    )
    args = parser.parse_args()
    if not 0.0 <= args.start_fraction < 1.0:
        parser.error("--start-fraction must be greater than or equal to 0 and less than 1")
    if args.start_seconds is not None and args.start_seconds < 0:
        parser.error("--start-seconds must be greater than or equal to 0")
    return args


def connect(db_path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    return conn


def load_points(
    db_path: Path,
    chroma_dir: Path,
    include_artists: bool,
    model: str | None,
    snapshot_path: Path | None = None,
) -> list[EmbeddingPoint]:
    if snapshot_path is not None:
        return load_points_from_snapshot(snapshot_path, include_artists=include_artists, model=model)

    track_points = load_track_points(db_path, chroma_dir, model=model)
    if not include_artists:
        return track_points
    return track_points + build_artist_points(track_points)


def load_track_points(db_path: Path, chroma_dir: Path, model: str | None) -> list[EmbeddingPoint]:
    if not db_path.exists():
        raise FileNotFoundError(f"SQLite database not found: {db_path}")
    if not chroma_dir.exists():
        raise FileNotFoundError(f"Chroma directory not found: {chroma_dir}")

    vector_store = get_vector_store(persist_dir=chroma_dir)
    with connect(db_path) as conn:
        rows = conn.execute(latest_track_embedding_sql(model is not None), (model,) if model else ()).fetchall()
        love_mobiles_by_artist = load_love_mobiles_by_artist(conn)

    track_points: list[EmbeddingPoint] = []
    for row in rows:
        vector = vector_store.get_embedding(row["vector_id"])
        if vector is None:
            continue
        embedding = np.asarray(vector, dtype=np.float32)
        title = title_from_url(row["url"]) or title_from_path(row["path"]) or f"Track {row['track_id']}"
        artist_name = row["artist_name"] or f"Artist {row['artist_id']}"
        metadata = {
            "track_id": row["track_id"],
            "track_uuid": row["track_uuid"],
            "artist_id": row["artist_id"],
            "artist_uuid": row["artist_uuid_db"] or row["artist_uuid"],
            "artist_name": artist_name,
            "title": title,
            "url": row["url"],
            "path": row["path"],
            "download_status": row["download_status"],
            "sample_count": row["sample_count"],
            "vector_id": row["vector_id"],
            "embedding_backend": row["embedding_backend"],
            "embedding_model": row["embedding_model"],
            "embedding_dim": row["embedding_dim"],
            "embedded_at": row["embedded_at"],
            "artist_links": json_data(row["links"], []),
            "artist_images": json_data(row["images"], []),
            "artist_info": json_data(row["info"], []),
            "artist_socials": json_data(row["socials"], []),
            "artist_bio": row["bio"],
            "artist_soundcloud_url": row["soundcloud_url"],
            "artist_instagram": row["instagram"],
            "artist_youtube": row["youtube"],
            "artist_web": row["web"],
            "love_mobiles": love_mobiles_by_artist.get(int(row["artist_id"]), []),
        }
        metadata["soundcloud_embed_url"] = soundcloud_embed_url(metadata["url"])
        track_points.append(
            EmbeddingPoint(
                id=f"track-{row['track_id']}",
                kind="track",
                label=f"{title} - {artist_name}",
                embedding=embedding,
                metadata=metadata,
            )
        )
    return track_points


def load_points_from_snapshot(snapshot_path: Path, include_artists: bool, model: str | None) -> list[EmbeddingPoint]:
    if not snapshot_path.exists():
        raise FileNotFoundError(f"static data snapshot not found: {snapshot_path}")
    payload = json.loads(snapshot_path.read_text(encoding="utf-8"))
    track_points = []
    for item in payload.get("track_points", []):
        metadata = item.get("metadata") or {}
        if model is not None and metadata.get("embedding_model") != model:
            continue
        track_points.append(
            EmbeddingPoint(
                id=str(item["id"]),
                kind="track",
                label=str(item["label"]),
                embedding=np.asarray(item["embedding"], dtype=np.float32),
                metadata=metadata,
            )
        )

    if not include_artists:
        return track_points
    return track_points + build_artist_points(track_points)


def build_artist_points(track_points: list[EmbeddingPoint]) -> list[EmbeddingPoint]:
    vectors_by_artist: dict[int, list[np.ndarray]] = {}
    artist_metadata: dict[int, dict[str, Any]] = {}
    tracks_by_artist: dict[int, list[dict[str, Any]]] = {}

    for point in track_points:
        metadata = point.metadata
        artist_id = int(metadata["artist_id"])
        vectors_by_artist.setdefault(artist_id, []).append(point.embedding)
        tracks_by_artist.setdefault(artist_id, []).append(
            {
                "track_id": metadata.get("track_id"),
                "title": metadata.get("title"),
                "artist_name": metadata.get("artist_name"),
                "url": metadata.get("url"),
                "soundcloud_embed_url": metadata.get("soundcloud_embed_url") or soundcloud_embed_url(metadata.get("url")),
                "path": metadata.get("path"),
            }
        )
        artist_metadata.setdefault(
            artist_id,
            {
                "artist_id": artist_id,
                "artist_uuid": metadata.get("artist_uuid"),
                "artist_name": metadata.get("artist_name"),
                "links": metadata.get("artist_links") or [],
                "images": metadata.get("artist_images") or [],
                "info": metadata.get("artist_info") or [],
                "socials": metadata.get("artist_socials") or [],
                "bio": metadata.get("artist_bio"),
                "soundcloud_url": metadata.get("artist_soundcloud_url"),
                "soundcloud_embed_url": soundcloud_embed_url(metadata.get("artist_soundcloud_url")),
                "instagram": metadata.get("artist_instagram"),
                "youtube": metadata.get("artist_youtube"),
                "web": metadata.get("artist_web"),
                "love_mobiles": metadata.get("love_mobiles") or [],
            },
        )

    artist_points = []
    for artist_id, vectors in vectors_by_artist.items():
        metadata = dict(artist_metadata[artist_id])
        metadata["track_embedding_count"] = len(vectors)
        metadata["embedding_dim"] = int(vectors[0].shape[0])
        metadata["tracks"] = tracks_by_artist.get(artist_id, [])
        artist_name = metadata["artist_name"]
        artist_points.append(
            EmbeddingPoint(
                id=f"artist-{artist_id}",
                kind="artist",
                label=artist_name,
                embedding=np.mean(np.vstack(vectors), axis=0),
                metadata=metadata,
            )
        )
    return artist_points


def snapshot_payload(track_points: list[EmbeddingPoint], db_path: Path, chroma_dir: Path, model: str | None) -> dict[str, Any]:
    return {
        "created_at": datetime.now(timezone.utc).isoformat(),
        "source": {
            "db": str(db_path),
            "chroma_dir": str(chroma_dir),
            "model_filter": model,
        },
        "track_point_count": len(track_points),
        "track_points": [
            {
                "id": point.id,
                "label": point.label,
                "embedding": point.embedding.astype(float).tolist(),
                "metadata": point.metadata,
            }
            for point in track_points
        ],
    }


def latest_track_embedding_sql(has_model_filter: bool) -> str:
    model_filter = "AND te.embedding_model = ?" if has_model_filter else ""
    return f"""
        SELECT
            te.*,
            tracks.id AS track_id,
            tracks.uuid AS track_uuid,
            tracks.url,
            tracks.path,
            tracks.download_status,
            tracks.downloaded,
            tracks.sample_count,
            artists.name AS artist_name,
            artists.uuid AS artist_uuid_db,
            artists.links,
            artists.images,
            artists.info,
            artists.socials,
            artists.bio,
            artists.soundcloud_url,
            artists.instagram,
            artists.youtube,
            artists.web
        FROM track_embeddings te
        JOIN tracks ON tracks.id = te.track_id
        JOIN artists ON artists.id = te.artist_id
        WHERE te.id = (
            SELECT latest.id
            FROM track_embeddings latest
            WHERE latest.track_id = te.track_id {model_filter}
            ORDER BY latest.embedded_at DESC, latest.id DESC
            LIMIT 1
        )
        ORDER BY artists.name, tracks.id
    """


def json_data(value: str | None, default: Any) -> Any:
    if not value:
        return default
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return default


def load_love_mobiles_by_artist(conn: sqlite3.Connection) -> dict[int, list[dict[str, Any]]]:
    has_table = conn.execute(
        "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'artist_love_mobiles'"
    ).fetchone()["count"]
    if not has_table:
        return {}
    rows = conn.execute(
        """
        SELECT
            alm.artist_id,
            alm.artist_name,
            alm.artist_bio,
            alm.artist_links,
            lm.id,
            lm.uuid,
            lm.source_index,
            lm.number,
            lm.name,
            lm.title,
            lm.genres,
            lm.motto,
            lm.time,
            lm.description,
            lm.image,
            lm.links,
            lm.source
        FROM artist_love_mobiles alm
        JOIN love_mobiles lm ON lm.id = alm.love_mobile_id
        ORDER BY alm.artist_id, lm.source_index
        """
    ).fetchall()
    result: dict[int, list[dict[str, Any]]] = {}
    for row in rows:
        result.setdefault(int(row["artist_id"]), []).append(
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
                "image": json_data(row["image"], {}),
                "links": json_data(row["links"], []),
                "source": row["source"],
                "artist_name": row["artist_name"],
                "artist_bio": row["artist_bio"],
                "artist_links": json_data(row["artist_links"], []),
            }
        )
    return result


def title_from_url(url: str | None) -> str | None:
    if not url:
        return None
    path = urlparse(url).path.strip("/")
    if not path:
        return None
    slug = unquote(path.split("/")[-1])
    return humanize_slug(slug)


def title_from_path(path: str | None) -> str | None:
    if not path:
        return None
    return humanize_slug(Path(path).stem)


def humanize_slug(value: str) -> str | None:
    cleaned = re.sub(r"[_\-]+", " ", value).strip()
    if not cleaned:
        return None
    return " ".join(part.capitalize() for part in cleaned.split())


def soundcloud_embed_url(url: str | None) -> str | None:
    if not url or not re.match(r"^https?://(www\.)?soundcloud\.com/", url, re.IGNORECASE):
        return None
    return (
        "https://w.soundcloud.com/player/"
        f"?url={quote(url, safe='')}"
        "&auto_play=true"
        "&show_artwork=false"
        "&visual=false"
    )


def build_projection(points: list[EmbeddingPoint], perplexity: float | None, random_state: int) -> np.ndarray:
    if len(points) == 0:
        raise ValueError("no embeddings found")
    if len(points) == 1:
        return np.zeros((1, 2), dtype=np.float32)

    x = np.vstack([point.embedding for point in points])
    effective_perplexity = perplexity or min(30.0, max(1.0, (len(points) - 1) / 3.0))
    effective_perplexity = min(effective_perplexity, len(points) - 1e-3)
    tsne = TSNE(
        n_components=2,
        perplexity=effective_perplexity,
        metric="cosine",
        init="random",
        learning_rate="auto",
        random_state=random_state,
    )
    return tsne.fit_transform(x)


def build_clusters(points: list[EmbeddingPoint], requested_clusters: int | None, random_state: int) -> np.ndarray:
    if len(points) <= 1:
        return np.zeros(len(points), dtype=int)

    cluster_count = requested_clusters or automatic_cluster_count(len(points))
    cluster_count = max(1, min(cluster_count, len(points) - 1))
    if cluster_count == 1:
        return np.zeros(len(points), dtype=int)

    x = np.vstack([point.embedding for point in points])
    affinity = np.clip(cosine_similarity(x), 0.0, 1.0)
    np.fill_diagonal(affinity, 1.0)
    clustering = SpectralClustering(
        n_clusters=cluster_count,
        affinity="precomputed",
        assign_labels="kmeans",
        random_state=random_state,
    )
    return clustering.fit_predict(affinity).astype(int)


def automatic_cluster_count(n_points: int) -> int:
    if n_points < 6:
        return 2
    return min(12, max(2, round(math.sqrt(n_points / 2))))


def write_site(points: list[EmbeddingPoint], projection: np.ndarray, clusters: np.ndarray, args: argparse.Namespace) -> None:
    args.out.mkdir(parents=True, exist_ok=True)
    if args.playback == "local" and args.audio_assets != "none":
        export_audio_assets(points, args.out, args.db, args.audio_assets)
    data = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": {
            "db": str(args.db),
            "chroma_dir": str(args.chroma_dir),
            "snapshot": str(args.snapshot) if args.snapshot else None,
            "model_filter": args.model,
            "playback": args.playback,
        },
        "point_count": len(points),
        "cluster_count": int(len(set(int(value) for value in clusters.tolist()))) if len(clusters) else 0,
        "points": [
            {
                "id": point.id,
                "kind": point.kind,
                "label": point.label,
                "x": float(projection[idx, 0]),
                "y": float(projection[idx, 1]),
                "cluster": int(clusters[idx]),
                "metadata": point.metadata,
            }
            for idx, point in enumerate(points)
        ],
    }
    (args.out / "data.json").write_text(json.dumps(data, indent=2), encoding="utf-8")
    (args.out / "index.html").write_text(INDEX_HTML, encoding="utf-8")
    (args.out / "app.js").write_text(app_js(args.playback, args.start_seconds, args.start_fraction), encoding="utf-8")
    (args.out / "styles.css").write_text(STYLES_CSS, encoding="utf-8")


def app_js(playback: str, start_seconds: float | None, start_fraction: float) -> str:
    return (
        APP_JS.replace("__PLAYBACK_MODE__", playback)
        .replace("__PLAYBACK_START_SECONDS__", "null" if start_seconds is None else str(float(start_seconds)))
        .replace("__PLAYBACK_START_FRACTION__", str(float(start_fraction)))
    )


def export_audio_assets(points: list[EmbeddingPoint], output_dir: Path, db_path: Path, mode: str) -> None:
    audio_dir = output_dir / "audio"
    audio_dir.mkdir(parents=True, exist_ok=True)
    for point in points:
        metadata = point.metadata
        if point.kind == "track":
            metadata["audio_url"] = export_audio_file(
                metadata.get("path"),
                audio_dir,
                db_path,
                f"track-{metadata.get('track_id')}",
                mode,
            )
        for track in metadata.get("tracks") or []:
            track["audio_url"] = export_audio_file(
                track.get("path"),
                audio_dir,
                db_path,
                f"track-{track.get('track_id')}",
                mode,
            )


def export_audio_file(path_value: str | None, audio_dir: Path, db_path: Path, stem: str, mode: str) -> str | None:
    source = resolve_audio_path(path_value, db_path)
    if source is None:
        return None
    suffix = source.suffix if source.suffix else ".mp3"
    target = audio_dir / f"{safe_filename(stem)}{suffix}"
    if target.exists() or target.is_symlink():
        return f"audio/{target.name}"
    if mode == "copy":
        shutil.copy2(source, target)
    else:
        try:
            target.symlink_to(source.resolve())
        except OSError:
            shutil.copy2(source, target)
    return f"audio/{target.name}"


def resolve_audio_path(path_value: str | None, db_path: Path) -> Path | None:
    if not path_value:
        return None
    path = Path(path_value)
    candidates = [path]
    if not path.is_absolute():
        candidates.append(db_path.parent / path)
    for candidate in candidates:
        if candidate.exists() and candidate.is_file():
            return candidate
    return None


def safe_filename(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9_.-]+", "-", value).strip("-._") or "audio"


INDEX_HTML = """<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Street Parade Embedding Map</title>
    <link rel="stylesheet" href="styles.css" />
  </head>
  <body>
    <main class="shell">
      <section class="hero">
        <p class="eyebrow">CLAP Embeddings</p>
        <h1>Street Parade Embedding Map</h1>
        <p>t-SNE projection of track embeddings and artist centroids, colored by spectral clusters.</p>
      </section>
      <section class="workspace">
        <div class="chart-card">
          <div class="toolbar">
            <input id="search" type="search" placeholder="Filter by artist or title" />
            <label><input id="tracks-toggle" type="checkbox" checked /> Tracks</label>
            <label><input id="artists-toggle" type="checkbox" checked /> Artists</label>
            <label><input id="marked-toggle" type="checkbox" /> Marked only</label>
          </div>
          <svg id="plot" role="img" aria-label="2D embedding scatterplot"></svg>
          <div id="tooltip" class="tooltip" hidden></div>
        </div>
        <aside id="details" class="details">
          <p class="eyebrow">Selection</p>
          <h2>Click a point</h2>
          <p>Hover to preview a track or artist. Click to pin full metadata here.</p>
        </aside>
      </section>
    </main>
    <script src="https://cdn.jsdelivr.net/npm/d3@7"></script>
    <script src="https://w.soundcloud.com/player/api.js"></script>
    <script src="app.js"></script>
  </body>
</html>
"""


APP_JS = """const svg = d3.select('#plot');
const tooltip = d3.select('#tooltip');
const details = d3.select('#details');
const search = document.querySelector('#search');
const tracksToggle = document.querySelector('#tracks-toggle');
const artistsToggle = document.querySelector('#artists-toggle');
const markedToggle = document.querySelector('#marked-toggle');
const colors = d3.scaleOrdinal(d3.schemeTableau10.concat(d3.schemeSet3));
const MARKED_ARTISTS_KEY = 'streetparade.embeddingMap.markedArtistIds';
const PLAYBACK_MODE = '__PLAYBACK_MODE__';
const PLAYBACK_START_SECONDS = __PLAYBACK_START_SECONDS__;
const PLAYBACK_START_FRACTION = __PLAYBACK_START_FRACTION__;

let allPoints = [];
let selectedPoint = null;
let markedArtistIds = readMarkedArtists();
let playlist = [];
let playlistIndex = 0;
const player = new Audio();
player.controls = true;
player.preload = 'metadata';
player.addEventListener('ended', playNextInPlaylist);

function pointTitle(point) {
  if (point.kind === 'artist') return point.metadata.artist_name || point.label;
  return point.metadata.title || point.label;
}

function pointSubtitle(point) {
  if (point.kind === 'artist') return `${point.metadata.track_embedding_count || 0} track embeddings`;
  return point.metadata.artist_name || 'Unknown artist';
}

function filteredPoints() {
  const query = search.value.trim().toLowerCase();
  return allPoints.filter((point) => {
    if (point.kind === 'track' && !tracksToggle.checked) return false;
    if (point.kind === 'artist' && !artistsToggle.checked) return false;
    if (markedToggle.checked && !isPointMarked(point)) return false;
    if (!query) return true;
    const haystack = `${point.label} ${point.metadata.artist_name || ''} ${point.metadata.title || ''}`.toLowerCase();
    return haystack.includes(query);
  });
}

function render() {
  const container = svg.node().parentElement;
  const width = container.clientWidth;
  const height = Math.max(460, Math.min(760, Math.round(width * 0.62)));
  svg.attr('viewBox', `0 0 ${width} ${height}`).attr('width', width).attr('height', height);

  const points = filteredPoints();
  const margin = 34;
  const x = d3.scaleLinear().domain(d3.extent(allPoints, (d) => d.x)).nice().range([margin, width - margin]);
  const y = d3.scaleLinear().domain(d3.extent(allPoints, (d) => d.y)).nice().range([height - margin, margin]);

  svg.selectAll('*').remove();
  svg.append('rect').attr('class', 'plot-bg').attr('width', width).attr('height', height).attr('rx', 22);

  const g = svg.append('g');
  g.selectAll('path.point')
    .data(points, (d) => d.id)
    .join('path')
    .attr('class', (d) => `point ${d.kind}${isPointMarked(d) ? ' marked' : ''}`)
    .attr('transform', (d) => `translate(${x(d.x)},${y(d.y)})`)
    .attr('d', d3.symbol().type((d) => d.kind === 'artist' ? d3.symbolDiamond : d3.symbolCircle).size((d) => d.kind === 'artist' ? 135 : 58))
    .attr('fill', (d) => colors(d.cluster))
    .attr('stroke-width', (d) => selectedPoint && selectedPoint.id === d.id ? 3 : 1.25)
    .on('mouseenter', showTooltip)
    .on('mousemove', moveTooltip)
    .on('mouseleave', hideTooltip)
    .on('click', (_, d) => {
      selectedPoint = d;
      renderDetails(d);
      playPoint(d);
      render();
    });

  const legend = svg.append('g').attr('class', 'legend').attr('transform', `translate(${margin},${margin})`);
  const clusters = Array.from(new Set(allPoints.map((d) => d.cluster))).sort((a, b) => a - b);
  legend.selectAll('g').data(clusters).join('g')
    .attr('transform', (_, i) => `translate(${Math.floor(i / 2) * 118},${(i % 2) * 24})`)
    .each(function(cluster) {
      const row = d3.select(this);
      row.append('circle').attr('r', 6).attr('fill', colors(cluster));
      row.append('text').attr('x', 12).attr('y', 4).text(`Cluster ${cluster}`);
    });
}

function showTooltip(event, point) {
  tooltip.hidden = false;
  tooltip.html(`<strong>${escapeHtml(pointTitle(point))}</strong><span>${escapeHtml(pointSubtitle(point))}</span><span>Cluster ${point.cluster} · ${point.kind}</span>`);
  moveTooltip(event);
}

function moveTooltip(event) {
  tooltip.style('left', `${event.pageX + 14}px`).style('top', `${event.pageY + 14}px`);
}

function hideTooltip() {
  tooltip.hidden = true;
}

function renderDetails(point) {
  const metadata = point.metadata || {};
  const primaryUrl = metadata.url || metadata.soundcloud_url || metadata.web;
  const artistId = metadata.artist_id;
  const isMarked = artistId !== undefined && markedArtistIds.has(String(artistId));
  const playableTracks = playableTracksForPoint(point);
  const soundCloudTracks = soundCloudTracksForPoint(point);
  const rows = Object.entries(metadata)
    .filter(([key, value]) => !['tracks', 'audio_url'].includes(key) && value !== null && value !== undefined && value !== '' && !Array.isArray(value))
    .map(([key, value]) => `<dt>${escapeHtml(key.replaceAll('_', ' '))}</dt><dd>${formatValue(value)}</dd>`)
    .join('');
  details.html(`
    <p class="eyebrow">${escapeHtml(point.kind)} · Cluster ${point.cluster}</p>
    <h2>${escapeHtml(pointTitle(point))}</h2>
    <p>${escapeHtml(pointSubtitle(point))}</p>
    ${artistId !== undefined ? `<button class="mark-button ${isMarked ? 'active' : ''}" type="button" data-action="toggle-mark">${isMarked ? 'Unmark artist' : 'Mark artist'}</button>` : ''}
    ${primaryUrl ? `<a class="action" href="${escapeAttr(primaryUrl)}" target="_blank" rel="noreferrer">Open source link</a>` : ''}
    <section class="player-panel">
      <p class="eyebrow">Audio</p>
      ${PLAYBACK_MODE === 'local' ? localPlayerMarkup(playableTracks) : soundCloudPlayerMarkup(soundCloudTracks)}
    </section>
    <dl>${rows}</dl>
  `);
  details.select('#player-slot').node()?.appendChild(player);
  details.select('[data-action="toggle-mark"]').on('click', () => toggleArtistMark(artistId));
  details.selectAll('[data-play-index]').on('click', function() {
    const index = Number(this.getAttribute('data-play-index'));
    if (PLAYBACK_MODE === 'local') playTracks(playableTracks, index);
    else playSoundCloudTracks(soundCloudTracks, index);
  });
}

function localPlayerMarkup(playableTracks) {
  return `
    <div id="player-slot"></div>
    <p>${playableTracks.length ? `${playableTracks.length} cached song${playableTracks.length === 1 ? '' : 's'} available.` : 'No cached song path is available for this selection.'}</p>
    ${playableTracks.length > 1 ? `<ol class="track-list">${playableTracks.map((track, index) => `<li><button type="button" data-play-index="${index}">${escapeHtml(track.title || `Track ${index + 1}`)}</button></li>`).join('')}</ol>` : ''}
  `;
}

function soundCloudPlayerMarkup(soundCloudTracks) {
  return `
    <div id="soundcloud-slot" class="soundcloud-slot"></div>
    <p>${soundCloudTracks.length ? `${soundCloudTracks.length} SoundCloud track${soundCloudTracks.length === 1 ? '' : 's'} available.` : 'No SoundCloud track URL is available for this selection.'}</p>
    ${soundCloudTracks.length > 1 ? `<ol class="track-list">${soundCloudTracks.map((track, index) => `<li><button type="button" data-play-index="${index}">${escapeHtml(track.title || `Track ${index + 1}`)}</button></li>`).join('')}</ol>` : ''}
  `;
}

function playableTracksForPoint(point) {
  const metadata = point.metadata || {};
  if (point.kind === 'track') {
    return metadata.audio_url ? [{title: metadata.title || point.label, audio_url: metadata.audio_url}] : [];
  }
  return (metadata.tracks || [])
    .filter((track) => track.audio_url)
    .map((track) => ({title: track.title || `Track ${track.track_id}`, audio_url: track.audio_url}));
}

function soundCloudTracksForPoint(point) {
  const metadata = point.metadata || {};
  if (point.kind === 'track') {
    return isSoundCloudUrl(metadata.url)
      ? [{title: metadata.title || point.label, url: metadata.url, embed_url: metadata.soundcloud_embed_url || soundCloudEmbedUrl(metadata.url)}]
      : [];
  }
  const tracks = (metadata.tracks || [])
    .filter((track) => isSoundCloudUrl(track.url))
    .map((track) => ({
      title: track.title || `Track ${track.track_id}`,
      url: track.url,
      embed_url: track.soundcloud_embed_url || soundCloudEmbedUrl(track.url),
    }));
  if (tracks.length) return tracks;
  return isSoundCloudUrl(metadata.soundcloud_url)
    ? [{
        title: metadata.artist_name || point.label,
        url: metadata.soundcloud_url,
        embed_url: metadata.soundcloud_embed_url || soundCloudEmbedUrl(metadata.soundcloud_url),
      }]
    : [];
}

function isSoundCloudUrl(url) {
  return typeof url === 'string' && /^https?:\/\/(www\.)?soundcloud\.com\//i.test(url);
}

function soundCloudEmbedUrl(url) {
  return isSoundCloudUrl(url)
    ? `https://w.soundcloud.com/player/?url=${encodeURIComponent(url)}&auto_play=true&show_artwork=false&visual=false`
    : null;
}

function renderSoundCloudPlayer(track) {
  if (!track) return;
  player.pause();
  playlist = [];
  const slot = details.select('#soundcloud-slot');
  const embedUrl = track.embed_url || soundCloudEmbedUrl(track.url);
  if (!embedUrl) {
    slot.html('<p>No SoundCloud embed URL is available for this track.</p>');
    return;
  }
  slot.html(`
    <iframe
      title="SoundCloud player"
      width="100%"
      height="166"
      scrolling="no"
      frameborder="no"
      allow="autoplay"
      src="${escapeAttr(embedUrl)}">
    </iframe>
  `);
  const iframe = slot.select('iframe').node();
  if (!iframe || !window.SC?.Widget) return;
  const widget = window.SC.Widget(iframe);
  widget.bind(window.SC.Widget.Events.READY, () => {
    widget.getDuration((durationMs) => {
      const startMs = Math.round(playbackStartSeconds(durationMs / 1000) * 1000);
      if (startMs > 0) widget.seekTo(startMs);
      widget.play();
    });
  });
}

function playPoint(point) {
  if (PLAYBACK_MODE === 'soundcloud') {
    playSoundCloudTracks(soundCloudTracksForPoint(point), 0);
    return;
  }
  const tracks = playableTracksForPoint(point);
  if (tracks.length) playTracks(tracks, 0);
}

function playSoundCloudTracks(tracks, startIndex) {
  const track = tracks[startIndex];
  if (track) renderSoundCloudPlayer(track);
}

function playTracks(tracks, startIndex) {
  playlist = tracks;
  playlistIndex = startIndex;
  const track = playlist[playlistIndex];
  if (!track) return;
  player.src = track.audio_url;
  seekAndPlayLocal();
}

function playNextInPlaylist() {
  if (!playlist.length || playlistIndex >= playlist.length - 1) return;
  playlistIndex += 1;
  const track = playlist[playlistIndex];
  player.src = track.audio_url;
  seekAndPlayLocal();
}

function seekAndPlayLocal() {
  const play = () => player.play().catch((error) => console.warn('Audio playback failed:', error));
  const seek = () => {
    const start = playbackStartSeconds(player.duration);
    if (start > 0) player.currentTime = start;
    play();
  };
  if (Number.isFinite(player.duration) && player.duration > 0) {
    seek();
    return;
  }
  player.addEventListener('loadedmetadata', seek, {once: true});
  player.load();
}

function playbackStartSeconds(durationSeconds) {
  const duration = Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : null;
  const requested = PLAYBACK_START_SECONDS !== null ? PLAYBACK_START_SECONDS : (duration ? duration * PLAYBACK_START_FRACTION : 0);
  if (!duration) return Math.max(0, requested);
  return Math.max(0, Math.min(requested, Math.max(0, duration - 1)));
}

function artistIdForPoint(point) {
  return point.metadata?.artist_id === undefined ? null : String(point.metadata.artist_id);
}

function isPointMarked(point) {
  const artistId = artistIdForPoint(point);
  return artistId !== null && markedArtistIds.has(artistId);
}

function toggleArtistMark(artistId) {
  const key = String(artistId);
  if (markedArtistIds.has(key)) markedArtistIds.delete(key);
  else markedArtistIds.add(key);
  localStorage.setItem(MARKED_ARTISTS_KEY, JSON.stringify(Array.from(markedArtistIds)));
  if (selectedPoint) renderDetails(selectedPoint);
  render();
}

function readMarkedArtists() {
  try {
    const parsed = JSON.parse(localStorage.getItem(MARKED_ARTISTS_KEY) || '[]');
    return new Set(Array.isArray(parsed) ? parsed.map(String) : []);
  } catch {
    return new Set();
  }
}

function formatValue(value) {
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (typeof value === 'object') return `<pre>${escapeHtml(JSON.stringify(value, null, 2))}</pre>`;
  const text = String(value);
  if (/^https?:\/\//.test(text)) return `<a href="${escapeAttr(text)}" target="_blank" rel="noreferrer">${escapeHtml(text)}</a>`;
  return escapeHtml(text);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'}[char]));
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, '&#96;');
}

Promise.all([d3.json('data.json')]).then(([data]) => {
  allPoints = data.points;
  document.title = `Street Parade Embedding Map (${data.point_count})`;
  render();
  window.addEventListener('resize', render);
  [search, tracksToggle, artistsToggle, markedToggle].forEach((element) => element.addEventListener('input', render));
});
"""


STYLES_CSS = """:root {
  color-scheme: dark;
  --bg: #0d1117;
  --panel: rgba(18, 24, 34, 0.88);
  --panel-strong: #151d2b;
  --text: #edf2ff;
  --muted: #97a3b6;
  --line: rgba(255, 255, 255, 0.11);
  --accent: #9ef0c4;
}

* { box-sizing: border-box; }
body {
  margin: 0;
  min-height: 100vh;
  color: var(--text);
  background:
    radial-gradient(circle at 18% 10%, rgba(79, 209, 197, 0.18), transparent 30rem),
    radial-gradient(circle at 90% 20%, rgba(129, 140, 248, 0.16), transparent 26rem),
    var(--bg);
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

.shell { width: min(1500px, calc(100vw - 32px)); margin: 0 auto; padding: 32px 0; }
.hero { max-width: 820px; margin-bottom: 24px; }
.eyebrow { margin: 0 0 8px; color: var(--accent); font-size: 0.76rem; font-weight: 800; letter-spacing: 0.14em; text-transform: uppercase; }
h1, h2 { margin: 0; line-height: 1.02; }
h1 { font-size: clamp(2.4rem, 6vw, 5.6rem); letter-spacing: -0.07em; }
h2 { font-size: clamp(1.5rem, 3vw, 2.35rem); letter-spacing: -0.04em; }
p { color: var(--muted); }

.workspace { display: grid; grid-template-columns: minmax(0, 1fr) 390px; gap: 18px; align-items: start; }
.chart-card, .details { border: 1px solid var(--line); background: var(--panel); box-shadow: 0 24px 80px rgba(0, 0, 0, 0.28); backdrop-filter: blur(18px); }
.chart-card { position: relative; border-radius: 28px; padding: 14px; overflow: hidden; }
.details { border-radius: 28px; padding: 24px; position: sticky; top: 18px; max-height: calc(100vh - 36px); overflow: auto; }
.toolbar { display: flex; gap: 14px; align-items: center; flex-wrap: wrap; margin-bottom: 12px; }
.toolbar input[type="search"] { flex: 1 1 260px; min-width: 0; border: 1px solid var(--line); border-radius: 999px; padding: 12px 16px; color: var(--text); background: rgba(255, 255, 255, 0.07); outline: none; }
.toolbar label { color: var(--muted); font-size: 0.92rem; }
#plot { display: block; width: 100%; }
.plot-bg { fill: rgba(255, 255, 255, 0.035); }
.point { cursor: pointer; stroke: rgba(255, 255, 255, 0.88); transition: opacity 160ms ease; }
.point.artist { stroke: #ffffff; }
.point.marked { stroke: var(--accent); filter: drop-shadow(0 0 8px rgba(158, 240, 196, 0.75)); }
.point:hover { opacity: 0.78; }
.legend text { fill: var(--muted); font-size: 12px; }
.tooltip { position: absolute; z-index: 5; max-width: 290px; padding: 12px 14px; border: 1px solid var(--line); border-radius: 16px; background: #101827; pointer-events: none; box-shadow: 0 16px 40px rgba(0, 0, 0, 0.34); }
.tooltip strong, .tooltip span { display: block; }
.tooltip span { margin-top: 4px; color: var(--muted); font-size: 0.88rem; }
.action, .mark-button, .track-list button, .soundcloud-button { display: inline-flex; margin: 10px 8px 20px 0; padding: 10px 14px; border: 0; border-radius: 999px; color: #07110c; background: var(--accent); font: inherit; font-weight: 800; text-decoration: none; cursor: pointer; }
.mark-button { color: var(--text); background: rgba(255, 255, 255, 0.1); border: 1px solid var(--line); }
.mark-button.active { color: #07110c; background: var(--accent); }
.soundcloud-button { color: #fff; background: #ff5500; }
.player-panel { margin: 8px 0 20px; padding: 16px; border: 1px solid var(--line); border-radius: 20px; background: rgba(255, 255, 255, 0.045); }
.player-panel audio { width: 100%; margin-top: 8px; }
.soundcloud-slot iframe { display: block; margin-top: 8px; border-radius: 12px; }
.track-list { margin: 10px 0 0; padding-left: 20px; }
.track-list li { margin: 6px 0; color: var(--muted); }
.track-list button { margin: 0; padding: 7px 10px; color: var(--text); background: rgba(255, 255, 255, 0.1); font-size: 0.86rem; }
dl { display: grid; grid-template-columns: 120px minmax(0, 1fr); gap: 10px 14px; margin: 18px 0 0; }
dt { color: var(--muted); text-transform: capitalize; }
dd { margin: 0; overflow-wrap: anywhere; }
a { color: var(--accent); }
pre { white-space: pre-wrap; margin: 0; font-size: 0.82rem; }

@media (max-width: 980px) {
  .workspace { grid-template-columns: 1fr; }
  .details { position: static; max-height: none; }
}

@media (max-width: 560px) {
  .shell { width: min(100vw - 20px, 1500px); padding: 18px 0; }
  .chart-card, .details { border-radius: 20px; }
  dl { grid-template-columns: 1fr; }
}
"""


def main() -> None:
    args = parse_args()
    points = load_points(
        args.db,
        args.chroma_dir,
        include_artists=not args.tracks_only,
        model=args.model,
        snapshot_path=args.snapshot,
    )
    projection = build_projection(points, args.perplexity, args.random_state)
    clusters = build_clusters(points, args.clusters, args.random_state)
    write_site(points, projection, clusters, args)
    print(f"Wrote {len(points)} points to {args.out / 'index.html'}")


if __name__ == "__main__":
    main()
