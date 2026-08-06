---
name: helm-release-test
description: Use when creating or running a Street Parade 2026 Helm release — bumping image or chart versions (visualizer-0.1.4, api-minimal-0.1.3, sp26-emb-prod, sp26-emb-test), testing the remote GitHub DockerHub publish pipelines (publish-dockerhub.yml, publish-dockerhub-test.yml, CI, deploy-embedding-visualization.yml), pushing images locally via scripts/build_push_image.py, or verifying a deployment is correct with the release diagnostics (helm lint/template, DockerHub tag checks, kubectl rollout/pods, curl of /streetparade-navigator-2026/ and /sp26-test/).
---

# Helm release & test workflow (Street Parade 2026)

How to release and verify the SP26 Helm deployments. The cluster facts (release
names, namespaces, base paths, image tags, install commands) drift with every
deploy, so **treat `docs/cluster-setup.md` and the chart files as the source of
truth** and re-read them before acting instead of trusting the numbers below.

## Release setup

Everything is served on one host, `magarathea.ddns.net`, routed by URL path through a
single shared `ingress-nginx`. Images live on Docker Hub in the **private**
`mylonasc/magarathea` repository; each SP26 namespace has a `dockerhub-regcred`
pull secret attached via `imagePullSecrets`. `pullPolicy: Always`.

### Charts, releases, base paths

| Chart                     | Release name        | Namespace       | Base path                      | Notes |
|---------------------------|---------------------|-----------------|--------------------------------|-------|
| `deploy/helm/sp26-emb-prod` | `sp26-emb-live`     | `sp26-emb-live` | `/streetparade-navigator-2026` | live deployment; `values.yaml` is self-contained (no overrides needed) |
| `deploy/helm/sp26-emb-test` | `sp26-emb-test`     | `sp26-test`     | `/sp26-test`                   | test env; renders its own Namespace + PVC |
| `deploy/helm/sp26-emb`      | —                   | —               | —                              | legacy path-locked chart, not deployed |

The charts render `api-deployment.yaml` (SQLite + NumPy vector store on a PVC at
`/data`, `/health` probe) and `visualizer-deployment.yaml` (nginx on :80, `/`
probe, optional api-proxy sidecar). Ingresess: `<release>-navigator-ui`,
`<release>-navigator-api`, `<release>-navigator-ui-redirect`.

### Image tag naming (must match the committed workflows exactly)

| Env   | Component         | Tag pattern                                       | Built by |
|-------|-------------------|---------------------------------------------------|----------|
| prod  | API               | `api-minimal-<minor>[-<sha>]`, `api-minimal-<version>[-<sha>]` | `publish-dockerhub.yml` |
| prod  | Visualizer        | `visualizer-<minor>[-<sha>]`, `visualizer-<version>[-<sha>]` (path-agnostic) | `publish-dockerhub.yml` |
| prod  | Visualizer (locked) | `visualizer-minimal-*` (path-locked navigator2026, **never in the charts**) | `publish-dockerhub.yml` |
| test  | API               | `api-minimal-<version>`, `api-minimal-<version>-<sha>` | `publish-dockerhub-test.yml` |
| test  | Visualizer        | `visualizer-<version>`, `visualizer-<version>-<sha>` (path-agnostic) | `publish-dockerhub-test.yml` |

Prod and test share the same tag naming; `--env`/workflow only change the tag
variants (prod adds the `<minor>` tags and the legacy `visualizer-minimal-*`).

`<minor>` = first two segments of the version (`0.1`), `<version>` = full version
(`0.1.4`), `<sha>` = `git rev-parse --short=12 HEAD`.

**Critical invariant:** the charts must use a **path-agnostic** visualizer
(`fe-visualizer/Dockerfile`, `VITE_BASE_PATH=./`, API base derived from
`location.pathname`). The path-locked `visualizer-minimal-*` build serves its
`location = /` health response after the ingress rewrite, so the browser would
download it instead of rendering the app. Never point a chart at a path-locked
image.

### GitHub workflows

| Workflow | Triggers | Does |
|----------|----------|------|
| `CI` | push to `main` + pull_request; skipped (via `paths-ignore`) when only `docs/**`, `deploy/**`, `.opencode/**`, `site/**` or `*.md` change; `concurrency` cancels superseded runs | backend pytest, media fixture tests, fe-admin build, fe-visualizer `npm run test:run` + default build, docker smoke tests (Buildx with GHA layer cache). **Never pushes images or deploys.** |
| `publish-dockerhub.yml` | `workflow_run` of CI **on `main`** (success) OR `workflow_dispatch` | builds+pushes `api-minimal-*`, `visualizer-minimal-*` (locked), `visualizer-*` (path-agnostic). env `dockerhub-push`. |
| `publish-dockerhub-test.yml` | push to branch `feat/sp26-test-env` with paths `fe-visualizer/**`, `src/**`, `Dockerfile`, or the workflow file itself; OR `workflow_dispatch` | builds+pushes `api-minimal-<version>[-<sha>]`, `visualizer-<version>[-<sha>]`. |
| `deploy-embedding-visualization.yml` | push to `main` OR `workflow_dispatch` | **GitHub Pages static site** (from release asset `embedding-visualization-data-v1`). Unrelated to the Docker/Helm deployment. |

**No workflow deploys to the cluster.** Every Helm release is applied manually
with `helm upgrade`. Neither the CI on a feature branch nor pushing to
`feat/sp26-test-env` deploys anything by itself.

### Version sources

- Backend: `pyproject.toml` → `[project] version`
- Frontend: `fe-visualizer/package.json` → `version`
- These are what the workflows AND `scripts/build_push_image.py` read.

## Release flow (the order matters)

1. **Bump versions** in `pyproject.toml` (backend) and/or `fe-visualizer/package.json` (frontend).
   Sync the lockfile: `cd fe-visualizer && npm install --package-lock-only`.
2. **Push the images** (either via the GitHub pipelines or locally — see below).
   Confirm the new tags exist on Docker Hub before step 3.
3. **Bump the chart**: `Chart.yaml` `version` +1 per deploy, `appVersion` = app
   version, and point `values.yaml` (both charts; no env-specific values files
   anymore) `api.image.tag` / `visualizer.image.tag` at the tags from step 2.
4. **Pre-flight diagnostics** (below), then `helm upgrade`.
5. **Post-deploy diagnostics** (below).

## Diagnostics

### Pre-flight (before pushing images / before helm upgrade)

```bash
# versions as the pipelines see them
node -p "require('./fe-visualizer/package.json').version"
grep -A1 '^version' pyproject.toml | head -2

# visualizer Docker build lockfile invariant (container runs npm 10.9.8)
cd fe-visualizer && npm run check:lock

# render both charts and eyeball image + basePath
helm lint deploy/helm/sp26-emb-prod
helm template sp26-emb-live deploy/helm/sp26-emb-prod --namespace sp26-emb-live \
  | grep -E 'image:|rewrite-target'

# preview the tags the local script would produce
python3 scripts/build_push_image.py --env test --dry-run
python3 scripts/build_push_image.py --env prod --dry-run

# confirm a tag really exists on Docker Hub (must pass before helm upgrade)
docker buildx imagetools inspect mylonasc/magarathea:visualizer-0.1.4
```

Every tag referenced by the chart must exist on Docker Hub, or pods will sit in
`ImagePullBackOff`.

### Post-deploy

```bash
helm status sp26-emb-live -n sp26-emb-live
helm list -A
kubectl get pods -n sp26-emb-live
kubectl rollout status deploy/sp26-emb-visualizer -n sp26-emb-live
kubectl get pods -n sp26-test

# curl the public endpoints (should return HTML / JSON, not a raw "ok" body)
curl -sS https://magarathea.ddns.net/streetparade-navigator-2026/ | head -c 200
curl -sS https://magarathea.ddns.net/streetparade-navigator-2026/api/health
curl -sS 'https://magarathea.ddns.net/streetparade-navigator-2026/api/visualization?username=demo'
curl -sS https://magarathea.ddns.net/sp26-test/
```

A UI path that serves a bare `ok`/`<html>…</html>`-less body means a path-locked
visualizer image got in. On failure: `helm rollback sp26-emb-live <prev-revision>`.

## Testing the remote GitHub pipelines

Use `gh`:

```bash
gh workflow list
gh run list --workflow=publish-dockerhub.yml --limit 10
gh run watch <run-id>            # tail until done
gh run view <run-id> --log-failed
```

- **Prod images on demand**: `gh workflow run publish-dockerhub.yml --ref <branch>`.
  On `workflow_dispatch`, `SOURCE_SHA` is the branch HEAD, so versions are read
  from that branch. The workflow_run path (CI success on `main`) is automatic.
- **Test images on demand**: `gh workflow run "Publish Test DockerHub Images" --ref feat/sp26-test-env`.
  On a real push, only changes under the workflow's `paths` trigger a build —
  pushing only chart files to `feat/sp26-test-env` will **not** rebuild images.
- **Pages site**: `gh workflow run deploy-embedding-visualization.yml`.
- The publish workflows run in the `dockerhub-push` **environment** — a run
  failing at "Check DockerHub configuration" means `DOCKERHUB_REPOSITORY`
  (var/secret), `DOCKERHUB_USERNAME` or `DOCKERHUB_TOKEN` is missing.
- Concurrency groups cancel in-progress runs on the same ref
  (`dockerhub-<ref>`, `dockerhub-test-<ref>`).

## Pushing from local if needed

`scripts/build_push_image.py` mirrors the CI tag naming:

```bash
docker login                        # user mylonasc
python3 scripts/build_push_image.py --env test --component visualizer --push
python3 scripts/build_push_image.py --env prod --component visualizer --push
python3 scripts/build_push_image.py --env prod --push        # all prod images
```

- `--env test|prod`; `--component api|visualizer|visualizer-minimal|all`
  (`visualizer-minimal` is prod-only); `--repo` overrides
  `$DOCKERHUB_REPOSITORY` / `mylonasc/magarathea`; `--dry-run` prints commands.
- Versions are per-component: `api` uses the backend version, `visualizer`/
  `visualizer-minimal` use the frontend version, `<sha>` is the current `HEAD`.
- It uses plain `docker build` + `docker tag` + `docker push`; log in first.

## Version bumps (where each lives)

| Thing to bump | File | When |
|---------------|------|------|
| Backend image version | `pyproject.toml` `project.version` | backend code changed |
| Frontend image version | `fe-visualizer/package.json` `version` (+ lockfile via `npm install --package-lock-only`) | frontend code changed |
| Chart version | `deploy/helm/sp26-emb-prod/Chart.yaml` and `sp26-emb-test/Chart.yaml` `version` | every deploy (convention: +1 patch, e.g. 0.1.5 → 0.1.6) |
| `appVersion` | same `Chart.yaml` | mirror the app version |
| Chart image tags | `values.yaml` (both charts) `api.image.tag` / `visualizer.image.tag` | must match tags already pushed to Docker Hub |

If only the `package.json` version changes, the built bundle is usually
byte-identical to the previous version — the tag carries the version, the app
does not. That is expected.

## Gotchas

- **Never** point the charts at `visualizer-minimal-*` (path-locked).
- Prod and test share mutable `<version>` tags: a main build overwrites a test
  branch's `<version>` tag. In the **test** chart prefer the immutable
  `<version>-<sha>` tag so a later main build cannot silently repoint it.
- `pullPolicy: Always` re-pulls on pod start, but an already-running pod keeps
  its image until a rollout; prefer immutable `<version>-<sha>` tags and a fresh
  `helm upgrade` over overwriting a mutable tag.
- ingress-nginx's admission webhook rejects a new ingress whose host+path
  overlaps an existing one — delete the old ingress before repointing a path.
- `helm upgrade` across charts in the same namespace orphans old resources;
  `helm rollback` does not clean them up.
- The Pages deployment is a separate static site and has nothing to do with the
  Helm releases; don't conflate "deployed" with "Pages updated".
- After editing anything under `deploy/helm/`, verify with `helm template` —
  the values files encode the base-path/fullname logic that is easy to break.
