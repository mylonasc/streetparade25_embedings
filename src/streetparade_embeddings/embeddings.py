from __future__ import annotations

from pathlib import Path

import numpy as np

from .audio import DEFAULT_SAMPLING_RATE, preprocess_track


class ClapEmbeddingModel:
    """Lazy CLAP wrapper for track and artist embeddings."""

    def __init__(self, model_name: str = "laion/clap-htsat-unfused", device: str = "auto"):
        import torch
        from transformers import ClapModel, ClapProcessor

        if device == "auto":
            device = "cuda" if torch.cuda.is_available() else "cpu"
        self.device = device
        self.model = ClapModel.from_pretrained(model_name).to(device)
        self.processor = ClapProcessor.from_pretrained(model_name)
        self.model.eval()

    def embed_chunks(self, chunks: list[np.ndarray], sampling_rate: int = DEFAULT_SAMPLING_RATE) -> np.ndarray:
        if not chunks:
            raise ValueError("Cannot embed a track with no complete audio chunks")

        import torch

        inputs = self.processor(audios=chunks, sampling_rate=sampling_rate, return_tensors="pt").to(self.device)
        with torch.no_grad():
            audio_embed = self.model.get_audio_features(**inputs)
        return audio_embed.mean(0).cpu().numpy()

    def embed_track(
        self,
        track_path: str | Path,
        sampling_rate: int = DEFAULT_SAMPLING_RATE,
        chunk_seconds: int = 30,
        stride_seconds: int = 60,
        max_chunks: int = 10,
    ) -> np.ndarray:
        chunks = preprocess_track(
            track_path,
            sampling_rate=sampling_rate,
            chunk_seconds=chunk_seconds,
            stride_seconds=stride_seconds,
            max_chunks=max_chunks,
        )
        return self.embed_chunks(chunks, sampling_rate=sampling_rate)


def aggregate_embeddings(embeddings: list[np.ndarray]) -> np.ndarray | None:
    if not embeddings:
        return None
    return np.mean(np.vstack(embeddings), axis=0)
