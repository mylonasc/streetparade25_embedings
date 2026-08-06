---
name: fe-visualizer-ui
description: Use when implementing or changing UI in fe-visualizer — the React + TypeScript Street Parade embedding visualizer. Covers the mobile-first layout (bottom sheet, selection panel, side tabs, training panel, artist favorites), the d3/canvas map, styling conventions, the path-agnostic API/base-URL rules, backend (FastAPI) endpoint integration and the data flow, and the full test stack (typecheck, vitest, Playwright e2e, phone-local Docker). Trigger on any UI change, layout fix, new panel/modal/button, or "update the visualizer" request.
---

# fe-visualizer UI development

Everything needed to implement and verify a UI change or new UI feature for the
embedding visualizer. All paths are relative to `fe-visualizer/` unless noted.

## Dynamic context — run this first

The code drifts. Before implementing or reviewing anything, regenerate the
current facts instead of trusting the prose below:

```bash
python3 .opencode/skills/fe-visualizer-ui/scripts/extract_visualizer_context.py
```

The script prints Markdown with everything dynamic: frontend package/scripts,
entry chain, **component inventory**, **App state** (`useState` with line
numbers), **frontend API calls**, the **api.ts base-URL resolution**, the full
**backend endpoint surface** (`routes/*.py`), feature flags, the **Point
contract**, styles/z-index/breakpoints, storage keys + cache version, the unit
and e2e test inventory, and build ARGs. Treat its output as the source of truth
for anything this skill marks as *derived*.

It runs from any cwd (repo root is auto-detected as the nearest `.git`
ancestor; override with `--repo PATH`).

### Drift protocol (mandatory)

The script reads every expected source defensively and validates it against
anchors from its `REQUIRED_SOURCES` manifest. Two failure classes:

- `MISSING` — the file is gone/unreadable/invalid
- `ANCHOR_LOST` — the file exists but lost an expected pattern (e.g. a renamed
  export, a moved component, a changed route file)

Both mean **skill-to-repo drift**: the skill's assumptions no longer match the
code. When the script prints a DRIFT REPORT or exits non-zero:

1. Update `extract_visualizer_context.py` — fix the `REQUIRED_SOURCES` manifest
   (paths + anchors) and any extraction regex that no longer matches.
2. Re-run until it exits 0 and reports "all required sources healthy".
3. Update the matching prose in this SKILL.md (file map, endpoint table, state
   list, breakpoints, test list) so it agrees with the script again.

Never "fix" drift by deleting anchors or hardcoding over the script to force a
green run. The anchor list is the contract that tells you when this skill needs
maintenance.

## Architecture overview

- Stack: React 19 + TypeScript (strict) + Vite 8 + d3 7 (map) + TensorFlow.js
  (browser-local preference model). No CSS framework; one global `styles.css`.
- **`App.tsx` is the single orchestrator** — it holds nearly all state and all
  API calls, and passes state/callbacks down to presentational components. When
  adding a feature, add state and handlers here, then wire the UI.
- Entry chain: `index.html` → `src/main.tsx` → `App.tsx` (imports `styles.css`).
- Components are function components with props typed in each file. Pure helpers
  (search, selection targets, layout payloads, tooltip math) live in plain `.ts`
  modules that are unit-tested.

### File map

*Derived — regenerate with the script if a file/role looks off; the script's
component inventory reports which files currently exist and who imports them.*

| File | Role |
|------|------|
| `src/main.tsx` | mounts `<App />` into `#root` |
| `src/App.tsx` | all state, data loading, preferences, training, selection history, polling, shortcuts, layout of every screen section |
| `src/components/Visualizer.tsx` | the `<canvas class="plot">` map: d3 zoom/pan, hit-testing, edges, tooltip, focus pan/zoom, loading animation |
| `src/components/Selection.tsx` | selection sheet body: undo/redo, actions, SoundCloud/YouTube audio players, artist playlist, metadata `<dl>` |
| `src/components/Panels.tsx` | `PreferenceTrainingPanel`, `ArtistFavoritesPanel`, `TrackRow`, `UsernameGate` |
| `src/components/Modals.tsx` | `LayoutModal`, `HelpModal`, `SavedModelPrompt`, `TrainModelPrompt` (all in `.modal-backdrop`) |
| `src/BottomSheet.tsx` | selection panel wrapper: fixed bottom sheet on mobile, static panel on desktop, grip drag + prominent left-side minimize toggle |
| `src/Tooltip.tsx` + `src/tooltipPosition.ts` | hover tooltip content + edge/point variants; pure position math (unit-tested) |
| `src/api.ts` | `request()` fetch helper + path-agnostic base-URL resolution |
| `src/responsive.ts` | `useMobileViewport`, `isMobileViewport`, `isCoarsePointer`, `isFinePointer`, `useFinePointer` |
| `src/search.ts` | point search index + substring matching (unit-tested) |
| `src/selection.ts` | `preferenceTarget`, `preferenceKeyForPoint`, `playlistForPoint`, `markKey`, `visibleMetadataEntries` (unit-tested) |
| `src/layoutOptions.ts` | layout option types, defaults, `layoutPayload()` (unit-tested) |
| `src/storage.ts` | `safeGetItem`/`safeSetItem` (never throw), `USERNAME_KEY`, `MARKS_KEY`, `readMarks` |
| `src/preferenceTraining.ts` | TF.js model: dataset build, train/eval/predict/save/load, metrics |
| `src/types.ts` | shared types: `Point`, `PointLike`, `PointKind`, `PreferenceValue`, `VisualizationPayload`, `Stats`, `SimilarityEdge`, `UserTrack`, `Job`, `ArtistSummary` |
| `src/styles.css` | global styles, CSS variables, breakpoints, z-index scale |
| `index.html` | loads SoundCloud widget API `<script>` + app module |

## The mobile-first layout

Everything is designed for phones first, then widens at breakpoints.

- **Mobile = `max-width: 979px`** (matches `useMobileViewport()`). Desktop = `min-width: 980px`.
  Keep the 979px/980px boundary consistent between JS (`responsive.ts`) and CSS.
- On mobile the `aside.side` is reordered **above** the map (`.workspace .side { order: -1 }`),
  with sticky tabs. On desktop the workspace is two columns: map + 390px side rail.
- The **selection panel** (`BottomSheet`) is `position: fixed` at the bottom on
  mobile (z-index 30) and a static panel under the map on desktop.
- `.shell` reserves bottom padding (`--sheet-peek`) so the fixed sheet never
  covers page content.
- Touch targets: buttons min-height 44px on coarse pointers
  (`@media (pointer: coarse)`); 40px otherwise. The e2e suite asserts 44px.

### Z-index scale (keep this ordering)

`map-toolbar:6` < `map-search:5` < `empty-warning:4` (inside map) · `tooltip:10` ·
`sticky side-tabs:20` · `selection-panel:30` · `modal-backdrop:40`.
The sheet must sit above the sticky tabs but below any modal backdrop.

### BottomSheet / selection panel behavior

- Visible only when a point is selected → class `has-selection`; minimize sets
  `is-minimized` (`max-height: 78px` on mobile). 
- Header is a `.sheet-minimize-toggle` button (accent pill with a
  ChevronDown/ChevronUp SVG icon) on the **left** of the header with
  `aria-label` "Minimize"/"Expand" and `aria-expanded`, next to a
  `.selection-title` heading and the quick actions. On desktop the toggle is
  hidden (`display: none`).
- The grip + header drag-to-minimize logic lives in `BottomSheet.tsx`
  (pointer capture; a `button` inside the header cancels the drag).
- When `is-minimized`, content like `.selection-actions`, `.selection-history`,
  `.shortcut-hint`, `dl`, `.model-note`, `.playlist` is hidden via CSS, and
  iframes/audio collapse to 1px.

### Side tabs

`Tracks` / `Training` / `Artists` (`sideTab` state). Switching tabs minimizes the
sheet. On mobile the tabs are sticky with `top: calc(env(safe-area-inset-top) + 6px)`.
Respect `env(safe-area-inset-*)` for anything near screen edges.

### Modals

All modals render a `.modal-backdrop` (z-index 40) with a `.layout-modal`
dialog. Backdrop click closes when `event.target === event.currentTarget`.
Add new modals to `Modals.tsx` and render them at the end of `App.tsx`'s JSX.

## The map (Visualizer.tsx)

- A single `<canvas>` redrawn imperatively. `useLayoutEffect` re-runs the whole
  draw/hit-test setup whenever any relevant prop changes (it depends on
  `sizeVersion` bumped by a `ResizeObserver`).
- d3 zoom: `scaleExtent([0.55, 10])`, dblclick resets to identity.
  `transformRef` holds the current zoom transform.
- Hit-testing: points are registered into a d3 **quadtree**; nearest point within
  radius+6px wins; edges via `distanceToSegment <= 8`.
- **Tooltips only on fine pointers** (`isFinePointer()` guard in JS AND
  `@media (pointer: coarse) .tooltip { display: none }` in CSS). Do not surface
  hover tooltips on touch.
- `focusRequest` (pointId + nonce) animates a pan/zoom to a point; selection also
  calls `ensurePointVisible` with mobile-aware margins.
- Color rules in `pointFill`: up `#85f5c4`, down `#ff5c35`, user_track `#ff5c35`,
  artist `#85f5c4`, predicted up `#b7ffd9`, predicted down `#ff9a7f`,
  else cluster color (`d3.schemeTableau10` + `schemeSet3`).
- When the map shows no points it draws the loading animation
  (`drawLoadingMap`) and the `.empty-warning` about the Chroma vector store.

## API layer and the path-agnostic rule (critical)

`resolveApiBaseUrl()` in `src/api.ts`:
- Loopback host (localhost/127.0.0.1) → `http://<host>:8000` unless
  `VITE_API_BASE_URL` is set.
- Any other host → **`location.pathname + '/api'`** at runtime.

This is why **one image works at any base path** (`/streetparade-navigator-2026/`,
`/sp26-test/`, LAN phone test). Consequences:
- Never hardcode an absolute API URL in frontend code. Use `request()`.
- Keep the build path-agnostic: `vite.config.ts` uses
  `base: process.env.VITE_BASE_PATH || './'`; the published image builds with
  `VITE_BASE_PATH=./` and no `VITE_API_BASE_URL`. A path-locked build breaks the
  ingress deployments.
- Same-origin `/api` is expected when deployed behind the nginx proxy / Helm
  ingress; locally the dev server proxies via `VITE_API_BASE_URL` or the
  phone-local nginx config.

Env flag: `VITE_ENABLE_SONG_DL_AND_EMBEDINGS` — code treats it as enabled unless
it is exactly `'false'`. Builds set it to `false`; the full local compose allows it.

## The larger app: how the UI gets data from the backend

The visualizer is one half of a FastAPI (Python) backend + React frontend split.
All data the UI shows comes from JSON endpoints served by
`src/streetparade_embeddings/api.py` (`src/streetparade_embeddings/routes/*`),
reached through `request()` in `src/api.ts`.

### Backend storage & config

- **SQLite** at `STREETPARADE_DB` (default `/data/streetparade_embeddings.sqlite3`):
  tracks, artists, users, preferences, user tracks, jobs, layouts, shares.
- **Vector store**: `STREETPARADE_VECTOR_STORE=numpy` with
  `STREETPARADE_NUMPY_VECTOR_DIR` (`ids.json`, `metadata.jsonl`, `vectors.npy`).
  Used by `/similarity/track-embeddings` and by `/visualization` when it embeds
  a fresh layout. The minimal DockerHub API image is deliberately Chroma-free;
  the local dev image mounts `./chroma`.
- **Feature flag `ENABLE_SONG_DL_AND_EMBEDINGS`** (backend env, default "1";
  "0"/"false"/"off" disables). When off: the per-user song download/embedding
  routes return 403, `features.song_downloads_and_embeddings` is `false`, and
  user tracks are not computed. The frontend mirrors this with
  `VITE_ENABLE_SONG_DL_AND_EMBEDINGS` — **keep both flags aligned** or "Add a
  track" / "My songs" silently disappear.
- **CORS**: `STREETPARADE_CORS_ORIGINS` (comma list) + optional
  `STREETPARADE_CORS_ORIGIN_REGEX` (used for LAN phone testing).

### Endpoint surface the visualizer uses (base path `/api` in prod)

*Derived — the script prints the current frontend `request()` calls and the full
backend route list; this table is the subset the visualizer depends on.*

| Purpose | Endpoint | Response shape |
|---------|----------|----------------|
| Full map | `GET /visualization?username=<u>` | `{signature, points[], point_count, base_point_count, artist_point_count, user_point_count, features}` |
| Change check | `GET /visualization/status?username=<u>` | `{signature, features}` (cheap; drives the cache) |
| Preferences | `GET/POST /users/{u}/preferences` | `{preferences: {"<kind>:<id>": "up"\|"down"}}`; POST body = `PreferenceTarget` + `value` (`"clear"` removes) |
| Username | `POST /users` | `{username}` |
| User tracks | `GET/POST /users/{u}/tracks`, `GET /users/{u}/tracks/{id}/audio` | list of `UserTrack`; audio stream for local playback |
| Job polling | `GET /user-track-jobs/{id}` | `Job {id, status: queued\|running\|completed\|failed, ...}` |
| Layout | `POST /layouts/recompute` (body from `layoutPayload()`), `GET /layout-jobs/{id}` | `LayoutJob`; poll until `completed` then reload the map |
| Shares | `POST /shares`, `GET /shares/{token}` | `{token}`, `{payload: {username, marked[]}}` |
| Training data | `GET /tracks?page=N&page_size=500&include_embedding=true` | `{tracks: EmbeddedTrack[], has_next}` (paginated; loops until `has_next` false) |
| Similarity edges | `POST /similarity/track-embeddings` | `{results: [{vector_id, similarity, distance, track_embedding?, metadata?}]}` |

### Point shape (`/visualization` → `types.ts Point`)

`{id, kind: 'track'|'user_track'|'artist', label, x, y, cluster, metadata}` where
`metadata` is a free-form map (`artist_name`, `title`, `track_id`, `vector_id`,
`tracks[]`, `embedding_model`, …). The UI's `Point` type is the contract between
the two — if the backend adds a metadata field, no frontend change is needed; if
it changes the point structure or adds top-level visualization fields, bump
`VISUALIZATION_CACHE_VERSION` in `App.tsx` so stale cached payloads are discarded.

### The cache/signature handshake

`loadAll()` reads `streetparade-visualization-v<N>:<user>` from localStorage,
fetches `/visualization/status`, and only refetches the full `/visualization`
when the server signature changed. This keeps map loads cheap across navigation
and re-login. UI code that depends on the *full* payload (not just new metadata
fields) must invalidate that cache.

## State flows to reuse

- **Preferences / thumbs**: `toggleThumb` / `setArtistPreference` optimistically
  update `thumbPreferences`, call `setUserPreference(username, target, value|'clear')`
  (`target` from `preferenceTarget(point)`, key from `preferenceKeyForPoint`),
  and call `registerPreference()` on a new value. On failure revert via `loadAll()`.
- **Train prompt**: `registerPreference()` bumps `preferenceCountRef` and shows
  `TrainModelPrompt` every 10th registration. "Train model" switches to the
  training tab and calls `trainPreferenceColorModel()`.
- **Training tab**: auto-loads embedded tracks on first entry
  (`sideTab === 'training' && !embeddedTracks.length`). Training is fully
  browser-local (TF.js + IndexedDB), saved under
  `streetparade-visualizer:preference-model-meta` (localStorage) + an
  `indexeddb://` model.
- **Map loading**: `loadAll()` reads a per-username localStorage cache keyed by
  signature (`streetparade-visualization-v1:<user>`); fetches
  `/visualization/status` and only re-fetches `/visualization` when the signature
  changes. Polls jobs/layout every 3s.
- **Selection history**: undo/redo stacks (max 50), keyboard Ctrl+Z / Ctrl+R
  (ignored while editing inputs).
- **Username**: gated until a username is chosen; stored in localStorage.

## Styling conventions

- All theme values are CSS variables in `:root` (`--accent` `#85f5c4`,
  `--warm` `#ff5c35`, `--bg`, `--panel`, `--line`, `--text`, `--muted`,
  `--sheet-peek`, `--space`, `--dock-height`). Reuse them.
- Buttons are pills (`border-radius: 999px`); `.secondary` for subtle actions;
  `.icon-button` for icon-only; `.toggle-button.active` for toggle state.
- Breakpoints in `styles.css`: `max-width: 979px` (mobile layout), `min-width: 640px`,
  `min-width: 980px` (desktop), `@media (pointer: coarse)` (touch sizing).
- Text in tight lists needs `overflow-wrap: anywhere` — the e2e suite rejects
  clipped text. Avoid `white-space: nowrap` on mobile.
- Every interactive element gets an accessible name (text content, `aria-label`,
  or `aria-pressed`) so `getByRole`/`getByLabel` selectors work.
- No code comments in this codebase unless the user asks for them.

## Implementing a new UI feature (checklist)

0. **Run the extraction script** and read its output — it gives the current
   components, state, endpoints, styles, and test inventory to work from.
1. Add shared types to `src/types.ts` if the API/data shapes are new.
2. Add state + handlers in `App.tsx`; keep components presentational.
3. Put pure logic (derivation, string building, math) in a `.ts` helper with a
   `.test.ts` — it is much easier to verify than component internals.
4. Add markup + a dedicated class(es) in `styles.css`; follow the breakpoint and
   z-index rules above.
5. If you add a flex/grid row whose children must not overlap, add its selector
   to `OVERLAP_GROUPS` in `e2e/streetparade-quality.spec.js`.
6. Add `aria-*` labels for every new button/control.
7. Verify: typecheck → unit tests → e2e (below). If behavior is mobile-specific,
   run the mobile spec too.
8. Re-run the extraction script once before finishing — a clean exit confirms
   no new drift (e.g. a moved file or renamed export) was introduced.

## Testing

All commands run from `fe-visualizer/` unless noted.

### Typecheck + unit tests

```bash
npm run typecheck      # tsc --noEmit (strict)
npm run test:run       # vitest run (layoutOptions, search, selection, tooltipPosition)
```

Expected: typecheck clean, 16/16 unit tests.

### Dev server

```bash
npm run dev            # vite on :5174, host 0.0.0.0
```

Needs the API reachable at `http://localhost:8000` (loopback auto-detected).
Start it via the repo docker compose (`docker compose up api`), or directly with
uvicorn from the repo `.venv`:

```bash
STREETPARADE_DB=/tmp/dev.sqlite3 STREETPARADE_VECTOR_STORE=numpy \
STREETPARADE_NUMPY_VECTOR_DIR=$PWD/vectorstore ENABLE_SONG_DL_AND_EMBEDINGS=0 \
.venv/bin/python -m uvicorn streetparade_embeddings.api:app --port 8000
```

### Playwright e2e (repo `e2e/`)

Three specs, 10 tests total, all must pass:
- `streetparade-quality.spec.js` — one test × 5 devices (Pixel 7/10, iPhone SE/13/16):
  full flow with screenshot snapshots and structural checks: no horizontal
  overflow, no clipped text, no element past the right edge, no sibling overlap
  in the `OVERLAP_GROUPS` containers, at stages username gate → map → search →
  selection sheet → training → artists → help modal → layout modal.
- `streetparade-mobile.spec.js` (iPhone 13) — viewport containment, 44px toolbar
  targets, hover tooltip hidden on touch, tapping a search result opens the sheet.
- `streetparade-layout.spec.js` — recompute flow: 7 seeded clusters → request 5 →
  assert `/visualization` has exactly 5 distinct clusters and the UI dropdown matches.

Prerequisites: backend deps in repo `.venv`; `cd e2e && npm install` and
`npx playwright install chromium`.

```bash
cd e2e
npx playwright test                 # all specs
npx playwright test streetparade-mobile.spec.js   # subset
npx playwright test --headed        # watch the browser
```

`playwright.config.js` auto-starts two servers: the API on `127.0.0.1:8000`
(`e2e/seed-layout.py` copies the repo DB to `/tmp/sp26-e2e.sqlite3` and seeds 7
clusters so no initial t-SNE runs) and `npm run dev` on `localhost:5174`. Set
`baseURL: http://localhost:5174` in tests (already configured). Screenshots go to
`e2e/screenshots/` (gitignored).

### Phone / LAN manual test

```bash
docker compose -f docker-compose.yml -f docker-compose.phone-local.yml up -d
```

`nginx.phone.conf` reverse-proxies same-origin `/api/*` to the `api` service,
mirroring the deployed topology. Open `http://<lan-ip>:3001` on the phone.

## Build / deploy context

- `fe-visualizer/Dockerfile` (node build → nginx runtime) takes args
  `VITE_API_BASE_URL` (default empty), `VITE_BASE_PATH` (default `/`; the
  published path-agnostic image overrides to `./`), `VITE_ENABLE_SONG_DL_AND_EMBEDINGS`
  (default `false`).
- Image tags on DockerHub `mylonasc/magarathea` (private repo, pulls need the
  `dockerhub-regcred` secret): `visualizer-minimal-*`/`api-minimal-*` from
  `publish-dockerhub.yml` and `*-test-*` from `publish-dockerhub-test.yml`.
- The deployed Helm charts (`deploy/helm/sp26-emb-prod`, `sp26-emb-test`) serve
  the **`*-test-*`** visualizer image on purpose: it is the path-agnostic build
  (`VITE_BASE_PATH=./`), which the path-locked `visualizer-minimal-*` image is not.
  Do not point the charts at a path-locked image.
- When you change frontend code that should reach the deployed sites, the
  `*-test-*` image is built by `publish-dockerhub-test.yml` on push to branch
  `feat/sp26-test-env` (or manual `workflow_dispatch`); then bump the chart
  version + image tag and `helm upgrade` per `docs/cluster-setup.md`.

## Gotchas (learned the hard way)

- **Expanded sheet intercepts clicks.** With a point selected, the fixed sheet
  covers the bottom of the screen and can swallow clicks on underlying UI (e.g.
  the Help button). In e2e flows, minimize the sheet before interacting with
  anything underneath it; also prefer hitting "Minimize" rather than toggling.
- **Mobile viewport is a hard 979px line** — the map toolbar, search, and side
  rail change radically across it. Test at both widths (quality spec devices
  cover <400px; desktop viewport is 1440×900).
- **Keep z-index order**: new overlays must slot into the existing scale
  (toolbar 6 / tooltip 10 / tabs 20 / sheet 30 / modal 40). The sheet at 30 was
  raised over the tabs at 20; the backdrop at 40 was raised over the sheet.
- **Never ship hover-only affordances for touch** (tooltip is hidden on coarse
  pointers; taps must have their own path — e.g. clicking a search result opens
  the sheet).
- **Do not add runtime absolute API URLs.** Every feature that talks to the
  backend goes through `request()` and must work with the derived `/api` base.
- **e2e depends on seeded data**: `seed-layout.py` requires a valid
  `streetparade_embeddings.sqlite3` and `vectorstore/` at the repo root; missing
  or stale vectors make the visualization empty and the specs fail at the
  "must expose points to search" assertion.
- **Lockfile invariant for the Docker build.** The container runs
  `npm ci --omit=dev` with npm 10.9.8 (`node:22-alpine`). npm ≥11 can silently
  drop the `@emnapi/core`/`@emnapi/runtime` entries from
  `fe-visualizer/package-lock.json` (transitive optional deps of Vite 8's
  rolldown `wasm32-wasi` binding) while keeping the dependency edges, which
  makes the container's `npm ci` abort with "Missing: @emnapi/… from lock file".
  They are pinned as direct `dependencies` so the entries must always exist —
  after adding any dependency, run `npm run check:lock` (from `fe-visualizer/`)
  before building the image; it reproduces the container step with the exact npm
  version and is non-destructive (`--dry-run`).
- **Screenshots change on every run** — `e2e/screenshots/` is gitignored; never
  commit them.
