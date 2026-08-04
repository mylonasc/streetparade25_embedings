# Street Parade e2e suite

Playwright tests that drive the real visualizer UI against the minimal
(deployed) backend configuration.

## What it covers

`streetparade-layout.spec.js` reproduces the PCA / t-SNE / spectral-clustering
recompute flow:

1. Logs in with a throwaway username.
2. Reads the baseline cluster count from the map's cluster dropdown (a seeded
   anonymous layout with 7 clusters, so no initial t-SNE is needed).
3. Recomputes the layout with 5 clusters.
4. Asserts the refreshed `/visualization` payload contains exactly 5 distinct
   clusters and that the UI dropdown updates to match.

It fails on the pre-fix backend (recompute is stored under the user scope while
the visualization reads the anonymous scope) and passes after the fix.

## Prerequisites

- Node + npm.
- Playwright Chromium browser:
  `cd e2e && npx playwright install chromium`
- Backend deps already installed in the repo `.venv` (numpy, scikit-learn,
  uvicorn).

## Run

```bash
cd e2e
npm install
npx playwright test
```

The `webServer` config starts the API on `127.0.0.1:8000` (isolated temp DB,
numpy vector store, `ENABLE_SONG_DL_AND_EMBEDINGS=0`) and the visualizer dev
server on `localhost:5174`, then shuts them down after the run. The temp DB at
`/tmp/sp26-e2e.sqlite3` is re-seeded on every run.

Headed run (watch the browser):

```bash
npx playwright test --headed
```
