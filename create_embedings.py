"""Backward-compatible entrypoint for computing artist embeddings."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "src"))

from streetparade_embeddings.cli import main


if __name__ == "__main__":
    argv = sys.argv[1:] or ["embed"]
    raise SystemExit(main(argv))
