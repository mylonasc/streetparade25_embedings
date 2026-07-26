from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from pathlib import Path
from typing import TypeAlias

import numpy as np
from numpy.typing import NDArray

AudioEmbedding: TypeAlias = NDArray[np.floating]


class MediaSource(str, Enum):
    SOUNDCLOUD = "soundcloud"
    YOUTUBE = "youtube"

    @classmethod
    def from_value(cls, value: "MediaSource | str") -> "MediaSource":
        if isinstance(value, cls):
            return value
        try:
            return cls(value)
        except ValueError as exc:
            allowed = ", ".join(source.value for source in cls)
            raise ValueError(f"media source must be one of: {allowed}") from exc


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

    def __post_init__(self) -> None:
        object.__setattr__(self, "path", Path(self.path))


@dataclass(frozen=True)
class MediaDownload:
    source: MediaSource
    artist: str
    title: str
    url: str
    path: Path
    downloaded: bool

    def __post_init__(self) -> None:
        object.__setattr__(self, "source", MediaSource.from_value(self.source))
        object.__setattr__(self, "path", Path(self.path))


@dataclass(frozen=True)
class ArtistEmbeddingResult:
    artist: str
    embedding: AudioEmbedding | None
    track_paths: list[Path]
    errors: list[str]

    def __post_init__(self) -> None:
        object.__setattr__(self, "track_paths", [Path(path) for path in self.track_paths])
