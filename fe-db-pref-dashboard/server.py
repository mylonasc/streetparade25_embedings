"""Local preference dashboard server.

Serves the static frontend from ``web/`` plus a tiny JSON API backed by a
decoupled :class:`~backend.DataBackend`. Stdlib only — no dependencies, no
build step.

Run from the repo root::

    uv run python fe-db-pref-dashboard/server.py \
      --backend sqlite --db <path-to-snapshot.sqlite3>
"""

from __future__ import annotations

import argparse
import json
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from backend import build_backend

WEB_DIR = Path(__file__).resolve().parent / "web"

MIME_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
}


def serve_backend_dispatch(backend):
    """Return a request handler bound to a specific backend instance."""

    class DashboardHandler(BaseHTTPRequestHandler):
        server_version = "fe-db-pref-dashboard/0.1"

        def _send_json(self, payload: object, status: int = 200) -> None:
            body = json.dumps(payload).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _send_file(self, path: Path) -> None:
            if not path.exists() or not path.is_file():
                self._send_json({"error": "not found"}, status=404)
                return
            body = path.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", MIME_TYPES.get(path.suffix, "application/octet-stream"))
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self) -> None:
            if self.path == "/api/users":
                try:
                    users = [u.as_dict() for u in backend.list_user_summaries()]
                    self._send_json({"users": users})
                except Exception as error:
                    self._send_json({"error": str(error)}, status=500)
                return

            if self.path == "/api/health":
                self._send_json({"status": "ok", "backend": backend.describe()})
                return

            # Static files from web/; "/" maps to index.html.
            relative = "index.html" if self.path in ("/", "") else self.path.lstrip("/")
            target = (WEB_DIR / relative).resolve()
            if not str(target).startswith(str(WEB_DIR.resolve())):
                self._send_json({"error": "forbidden"}, status=403)
                return
            self._send_file(target)

        def log_message(self, fmt: str, *args) -> None:
            print(f"[dashboard] {self.address_string()} - {fmt % args}", file=sys.stderr)

    return DashboardHandler


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Local preference dashboard: reads all users and their like/unlike "
            "preferences from a decoupled backend and shows them in a table."
        ),
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument("--host", default="127.0.0.1", help="Bind address.")
    parser.add_argument("--port", type=int, default=8765, help="Listen port.")
    parser.add_argument("--backend", choices=["sqlite", "http"], default="sqlite", help="Data backend to use.")
    parser.add_argument("--db", default=None, help="SQLite DB path for --backend sqlite.")
    parser.add_argument("--api-base", default=None, help="Base URL for --backend http.")
    parser.add_argument("--users-path", default="/users", help="Remote users path for --backend http.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    backend = build_backend(args.backend, db_path=args.db, api_base=args.api_base, users_path=args.users_path)
    handler = serve_backend_dispatch(backend)
    server = ThreadingHTTPServer((args.host, args.port), handler)
    print(f"[dashboard] serving {backend.describe()}")
    print(f"[dashboard] http://{args.host}:{args.port}/")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        backend.close()
        server.server_close()


if __name__ == "__main__":
    try:
        main()
    except ValueError as error:
        print(f"error: {error}", file=sys.stderr)
        sys.exit(2)
