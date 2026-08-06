# Scripts

## GitHub Pages Data Flow

The GitHub Pages site is generated during the deployment workflow. The repository does not need to commit `site/` or `scripts/.data_cache/static_data_snapshot.json`.

The workflow in `.github/workflows/deploy-embedding-visualization.yml` does this on every push to `main`:

1. Downloads the release asset `streetparade-pages-data.tar.gz` from the GitHub release tag `embedding-visualization-data-v1`.
2. Extracts `streetparade_embeddings.sqlite3` and `chroma/` into the workflow workspace.
3. Runs `scripts/create_static_data_snapshot.py` and writes the snapshot to `/tmp/streetparade-static-data-snapshot.json`.
4. Runs `scripts/build_embedding_visualization.py` with that temporary snapshot and writes the generated site to `site/`.
5. Uploads `site/` as the GitHub Pages artifact and deploys it.

This keeps generated files out of `main`. The committed source of truth is the Python scripts plus the versioned release data artifact.

## Release Data Artifact

The Pages build needs two runtime data inputs:

- `streetparade_embeddings.sqlite3`: metadata database.
- `chroma/`: persisted ChromaDB vectors.

Package them from the repository root with:

```bash
tar -czf /tmp/streetparade-pages-data.tar.gz streetparade_embeddings.sqlite3 chroma
```

Create the first release with:

```bash
gh release create embedding-visualization-data-v1 \
  /tmp/streetparade-pages-data.tar.gz \
  --title "Embedding visualization data v1" \
  --notes "SQLite metadata and Chroma vectors used to build the GitHub Pages embedding visualization."
```

Replace the asset for the same data version with:

```bash
gh release upload embedding-visualization-data-v1 \
  /tmp/streetparade-pages-data.tar.gz \
  --clobber
```

For a new immutable data version, create a new release tag and update `DATA_RELEASE_TAG` in `.github/workflows/deploy-embedding-visualization.yml`.

## Local Snapshot And Site Build

To reproduce the GitHub Pages build locally from unpacked data:

```bash
uv run python scripts/create_static_data_snapshot.py \
  --db streetparade_embeddings.sqlite3 \
  --chroma-dir chroma \
  --out /tmp/streetparade-static-data-snapshot.json
```

```bash
uv run python scripts/build_embedding_visualization.py \
  --snapshot /tmp/streetparade-static-data-snapshot.json \
  --out site \
  --playback soundcloud \
  --audio-assets none \
  --start-fraction 0.5
```

`site/` and `scripts/.data_cache/*.json` are ignored because they are generated outputs.

## DockerHub Images

Build the test or prod DockerHub images locally with the same tags the CI
workflows publish (`publish-dockerhub.yml` for prod, `publish-dockerhub-test.yml`
for test). Versions are read from `pyproject.toml` and `fe-visualizer/package.json`;
the short SHA comes from `git rev-parse --short=12 HEAD`.

```bash
uv run python scripts/build_push_image.py --env test --dry-run   # show the commands
uv run python scripts/build_push_image.py --env prod             # build prod tags
uv run python scripts/build_push_image.py --env prod --push      # build and push
```

Options:

- `--env test|prod` (required): `test` tags `<version>` and `<version>-<sha>`;
  `prod` tags `<minor>`, `<minor>-<sha>`, `<version>` and `<version>-<sha>`
  (plus the path-locked `visualizer-minimal-*`).
- `--component api|visualizer|visualizer-minimal|all` (default `all`):
  `visualizer-minimal` is prod-only.
- `--repo USER/REPO` (default `$DOCKERHUB_REPOSITORY` or `mylonasc/magarathea`).
- `--push`: push the tags to DockerHub after building. Log in first with
  `docker login`.

Image names are exact mirrors of the CI tags — `api-minimal-<version>` /
`visualizer-<version>` for both test and prod (the `--env` only changes which
tag variants are produced). Note that test-branch pushes and main pushes both
write the mutable `<version>` tag; prefer the `<version>-<sha>` tags for an
immutable reference.
