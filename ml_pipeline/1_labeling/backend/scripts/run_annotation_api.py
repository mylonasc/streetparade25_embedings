from __future__ import annotations

import sys
from pathlib import Path

import uvicorn


def main() -> None:
    backend_dir = Path(__file__).resolve().parents[1]
    if str(backend_dir) not in sys.path:
        sys.path.insert(0, str(backend_dir))
    uvicorn.run("app.main:app", host="0.0.0.0", port=8100, reload=False)


if __name__ == "__main__":
    main()
