from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class PipelineConfig:
    """Runtime configuration for the embedding pipeline."""

    data_dir: Path = Path(".")
    cache_dir: Path | None = None
    links_file: Path = Path("artist_links.json")
    html_file: Path = Path("streetparade_data.html")
    output_dir: Path = Path("outputs")
    model_name: str = "laion/clap-htsat-unfused"
    device: str = "auto"
    sampling_rate: int = 48_000
    chunk_seconds: int = 30
    chunk_stride_seconds: int = 60
    max_chunks: int = 10
    max_tracks: int = 3

    @property
    def resolved_cache_dir(self) -> Path:
        return self.cache_dir or self.data_dir / ".songs_cache"

    @property
    def resolved_links_file(self) -> Path:
        return self.links_file if self.links_file.is_absolute() else self.data_dir / self.links_file

    @property
    def resolved_html_file(self) -> Path:
        return self.html_file if self.html_file.is_absolute() else self.data_dir / self.html_file

    @property
    def resolved_output_dir(self) -> Path:
        return self.output_dir if self.output_dir.is_absolute() else self.data_dir / self.output_dir
