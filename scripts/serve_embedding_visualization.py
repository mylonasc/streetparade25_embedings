from __future__ import annotations

import argparse
import mimetypes
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


DEFAULT_DIRECTORY = Path("outputs/embedding_visualization")


class RangeRequestHandler(SimpleHTTPRequestHandler):
    """Static file handler with byte-range support for seekable browser audio."""

    def send_head(self):  # type: ignore[override]
        path = Path(self.translate_path(self.path))
        if path.is_dir():
            return super().send_head()
        if not path.exists():
            self.send_error(HTTPStatus.NOT_FOUND, "File not found")
            return None

        file_size = path.stat().st_size
        range_header = self.headers.get("Range")
        if not range_header:
            response = path.open("rb")
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-type", self.guess_type(str(path)))
            self.send_header("Content-Length", str(file_size))
            self.send_header("Accept-Ranges", "bytes")
            self.end_headers()
            return response

        byte_range = parse_range(range_header, file_size)
        if byte_range is None:
            self.send_error(HTTPStatus.REQUESTED_RANGE_NOT_SATISFIABLE)
            return None

        start, end = byte_range
        response = path.open("rb")
        response.seek(start)
        self.send_response(HTTPStatus.PARTIAL_CONTENT)
        self.send_header("Content-type", self.guess_type(str(path)))
        self.send_header("Content-Range", f"bytes {start}-{end}/{file_size}")
        self.send_header("Content-Length", str(end - start + 1))
        self.send_header("Accept-Ranges", "bytes")
        self.end_headers()
        self.range = (start, end)
        return response

    def copyfile(self, source, outputfile):  # type: ignore[override]
        byte_range = getattr(self, "range", None)
        if byte_range is None:
            return super().copyfile(source, outputfile)
        start, end = byte_range
        remaining = end - start + 1
        while remaining > 0:
            chunk = source.read(min(64 * 1024, remaining))
            if not chunk:
                break
            outputfile.write(chunk)
            remaining -= len(chunk)
        self.range = None


def parse_range(header: str, file_size: int) -> tuple[int, int] | None:
    if not header.startswith("bytes="):
        return None
    first_range = header.removeprefix("bytes=").split(",", 1)[0].strip()
    if "-" not in first_range:
        return None
    start_text, end_text = first_range.split("-", 1)
    if start_text == "":
        if not end_text.isdigit():
            return None
        suffix_length = int(end_text)
        start = max(0, file_size - suffix_length)
        end = file_size - 1
    else:
        if not start_text.isdigit() or (end_text and not end_text.isdigit()):
            return None
        start = int(start_text)
        end = int(end_text) if end_text else file_size - 1
    if start < 0 or end < start or start >= file_size:
        return None
    return start, min(end, file_size - 1)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Serve the generated embedding visualization with seekable audio.")
    parser.add_argument("--directory", type=Path, default=DEFAULT_DIRECTORY, help="Generated visualization directory.")
    parser.add_argument("--host", default="127.0.0.1", help="Host to bind.")
    parser.add_argument("--port", type=int, default=8080, help="Port to bind.")
    return parser.parse_args()


def main() -> None:
    mimetypes.add_type("audio/mpeg", ".mp3")
    args = parse_args()
    if not args.directory.exists():
        raise FileNotFoundError(f"directory not found: {args.directory}")
    handler = lambda *handler_args, **handler_kwargs: RangeRequestHandler(
        *handler_args,
        directory=str(args.directory),
        **handler_kwargs,
    )
    server = ThreadingHTTPServer((args.host, args.port), handler)
    print(f"Serving {args.directory} at http://{args.host}:{args.port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
