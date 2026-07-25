from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np


@dataclass(frozen=True)
class Artist:
    name: str
    links: list[str]
    images: list[str]
    soundcloud_url: str | None = None


@dataclass(frozen=True)
class TrackDownload:
    artist: str
    url: str
    path: Path
    downloaded: bool


@dataclass(frozen=True)
class MediaDownload:
    source: str
    artist: str
    title: str
    url: str
    path: Path
    downloaded: bool


@dataclass(frozen=True)
class ArtistEmbeddingResult:
    artist: str
    embedding: np.ndarray | None
    track_paths: list[Path]
    errors: list[str]
