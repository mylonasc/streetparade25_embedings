from __future__ import annotations

from pathlib import Path

import numpy as np

from .audio import DEFAULT_SAMPLING_RATE, preprocess_track
from .config import Device
from .models import AudioEmbedding


class ClapEmbeddingModel:
    """Lazy CLAP wrapper for track and artist embeddings."""

    def __init__(self, model_name: str = "laion/clap-htsat-unfused", device: Device | str = Device.AUTO):
        import torch
        from transformers import ClapModel, ClapProcessor

        resolved_device = Device.from_value(device)
        if resolved_device is Device.AUTO:
            device_name = "cuda" if torch.cuda.is_available() else "cpu"
        else:
            device_name = resolved_device.value
        self.device = device_name
        self.model = ClapModel.from_pretrained(model_name).to(device_name)
        self.processor = ClapProcessor.from_pretrained(model_name)
        self.model.eval()

    def embed_chunks(self, chunks: list[np.ndarray], sampling_rate: int = DEFAULT_SAMPLING_RATE) -> AudioEmbedding:
        if not chunks:
            raise ValueError("Cannot embed a track with no complete audio chunks")

        import torch

        inputs = self.processor(audio=chunks, sampling_rate=sampling_rate, return_tensors="pt").to(self.device)
        with torch.no_grad():
            audio_embed = self.model.get_audio_features(**inputs)
        return audio_embed.pooler_output.mean(0).cpu().numpy()

    def embed_track(
        self,
        track_path: str | Path,
        sampling_rate: int = DEFAULT_SAMPLING_RATE,
        chunk_seconds: int = 30,
        stride_seconds: int = 60,
        max_chunks: int = 10,
    ) -> AudioEmbedding:
        chunks = preprocess_track(
            track_path,
            sampling_rate=sampling_rate,
            chunk_seconds=chunk_seconds,
            stride_seconds=stride_seconds,
            max_chunks=max_chunks,
        )
        return self.embed_chunks(chunks, sampling_rate=sampling_rate)


def aggregate_embeddings(embeddings: list[AudioEmbedding]) -> AudioEmbedding | None:
    if not embeddings:
        return None
    return np.mean(np.vstack(embeddings), axis=0)
