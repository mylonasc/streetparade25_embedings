"""Tools for collecting SoundCloud audio and computing artist embeddings."""

from .config import PipelineConfig
from .config import Device
from .models import Artist, ArtistEmbeddingResult, MediaDownload, MediaSource, TrackDownload
from .soundcloud import DiscoveryMethod


def __getattr__(name: str):
    if name in {"ChromaVectorStore", "SimpleNumpyVectorStore"}:
        from .vectorstore import ChromaVectorStore, SimpleNumpyVectorStore

        return {"ChromaVectorStore": ChromaVectorStore, "SimpleNumpyVectorStore": SimpleNumpyVectorStore}[name]
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")

__all__ = [
    "Artist",
    "ArtistEmbeddingResult",
    "ChromaVectorStore",
    "Device",
    "DiscoveryMethod",
    "MediaDownload",
    "MediaSource",
    "PipelineConfig",
    "SimpleNumpyVectorStore",
    "TrackDownload",
]
