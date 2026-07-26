from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from pathlib import Path


class Device(str, Enum):
    AUTO = "auto"
    CPU = "cpu"
    CUDA = "cuda"

    @classmethod
    def from_value(cls, value: "Device | str") -> "Device":
        if isinstance(value, cls):
            return value
        try:
            return cls(value)
        except ValueError as exc:
            allowed = ", ".join(device.value for device in cls)
            raise ValueError(f"device must be one of: {allowed}") from exc


@dataclass(frozen=True)
class PipelineConfig:
    """Runtime configuration for the embedding pipeline."""

    data_dir: Path = Path(".")
    cache_dir: Path | None = None
    links_file: Path = Path("artist_links.json")
    html_file: Path = Path("streetparade_data.html")
    output_dir: Path = Path("outputs")
    model_name: str = "laion/clap-htsat-unfused"
    device: Device = Device.AUTO
    sampling_rate: int = 48_000
    chunk_seconds: int = 30
    chunk_stride_seconds: int = 60
    max_chunks: int = 10
    max_tracks: int = 3

    def __post_init__(self) -> None:
        object.__setattr__(self, "data_dir", Path(self.data_dir))
        object.__setattr__(self, "cache_dir", Path(self.cache_dir) if self.cache_dir is not None else None)
        object.__setattr__(self, "links_file", Path(self.links_file))
        object.__setattr__(self, "html_file", Path(self.html_file))
        object.__setattr__(self, "output_dir", Path(self.output_dir))
        object.__setattr__(self, "device", Device.from_value(self.device))

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
