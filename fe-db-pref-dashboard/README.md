# fe-db-pref-dashboard

Local PoC dashboard that reads **all users and their like/unlike preferences**
from the Street Parade embedding backend and shows them in a table.

It is decoupled from where the data lives: the data-access layer is a small
`DataBackend` interface (see `backend.py`) with two implementations, selected at
startup:

- **`sqlite`** (default) — read-only connection to a `streetparade_embeddings.sqlite3`
  file. Point it at a snapshot of the live prod DB (e.g. one produced by
  `scripts/backup_pvc_data.py`) or at the live PVC path if reachable.
- **`http`** — fetches user rows from a remote API (e.g. a future API served
  over the local DB snapshot, or a running backend server) via a base URL.

The dashboard itself is a single stdlib Python process (no dependencies, no
build step) that serves a tiny JSON API plus a static HTML/JS table.

## Quick start (SQLite — read a prod snapshot)

```bash
uv run python fe-db-pref-dashboard/server.py \
  --backend sqlite \
  --db data-snapshots/sp26-emb-live-20260808-110324/streetparade_embeddings.sqlite3
```

Open http://localhost:8765 — a table of every user with like/up, unlike/down and
cleared counts.

Get a fresh snapshot of the live prod DB first with:

```bash
uv run python scripts/backup_pvc_data.py
```

## Quick start (HTTP — consume a remote API)

```bash
uv run python fe-db-pref-dashboard/server.py \
  --backend http \
  --api-base http://localhost:8000 \
  --users-path /api/users
```

The remote API must expose `GET <users-path>` (default `/users`) returning the
same payload shape as this dashboard's own `GET /api/users`:

```json
{ "users": [ { "username": "harry", "up": 105, "down": 50, "cleared": 7 } ] }
```

This is intentionally the shape this dashboard serves, so two instances can be
chained (point one at a snapshot, the other at its `/api/users`).

## Options

| Flag | Default | Meaning |
|------|---------|---------|
| `--host` | `127.0.0.1` | Bind address. |
| `--port` | `8765` | Listen port. |
| `--backend` | `sqlite` | `sqlite` or `http`. |
| `--db` | (first snapshot found) | SQLite DB path for `--backend sqlite`. |
| `--api-base` | — | Base URL (`scheme://host[:port][/path]`) for `--backend http`. |
| `--users-path` | `/users` | Remote path for `--backend http`; defaults to `/users`, set `/api/users` when chaining to another dashboard. |

## API

- `GET /api/users` — `{ "users": [ { "username", "up", "down", "cleared" } ] }`
- `GET /api/health` — `{ "status": "ok", "backend": "sqlite" }`

Static frontend is served at `/` from `fe-db-pref-dashboard/web/`.

## Layout

- `server.py` — HTTP server (stdlib `http.server`), serves the API + static web.
- `backend.py` — `DataBackend` protocol, `SqliteBackend`, `HttpBackend`, factory.
- `web/` — static frontend (plain HTML/CSS/JS, no build step).
