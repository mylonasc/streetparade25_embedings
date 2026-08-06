# Cluster setup (Street Parade 2026)

How the SP26 deployments run on the `magarathea.ddns.net` Kubernetes cluster, as of
2026-08-06.

## Overview

- GKE cluster `gke-gpu-spot-cluster`, project `gke-gpu-project-473410`,
  region `europe-west4`.
- Everything is served on one host, `magarathea.ddns.net`, routed by URL path through a
  single shared `ingress-nginx` (v1.14.1, namespace `ingress-nginx`) whose external
  load balancer IP is `34.13.231.86`.
- `magarathea.ddns.net` is kept pointing at that IP by the `noip-sync` CronJob that runs
  inside the `ingress-nginx` namespace.
- The live SP26 deployment serves **`https://magarathea.ddns.net/streetparade-navigator-2026/`**.
- A test deployment serves **`https://magarathea.ddns.net/sp26-test/`**.

## The live deployment

| Item            | Value                                                            |
|-----------------|------------------------------------------------------------------|
| Namespace       | `sp26-emb-live`                                                  |
| Helm release    | `sp26-emb-live` (chart `deploy/helm/sp26-emb-prod`, revision 2)  |
| Visualizer      | `mylonasc/magarathea:visualizer-0.1.3` (ClusterIP :80)      |
| API             | `mylonasc/magarathea:api-minimal-0.1.3` (ClusterIP :8000)           |
| PVC             | `sp26-emb-data` (2Gi, `standard-rwo`), mounted at `/data` in API |
| Ingresses       | `sp26-emb-navigator-ui`, `sp26-emb-navigator-api`, `sp26-emb-navigator-ui-redirect` |

The release was installed from `deploy/helm/sp26-emb-prod` using
`values-sp26-dev.yaml` (which sets the base path `/streetparade-navigator-2026` and
`fullnameOverride: sp26-emb`), with the namespace overridden at install time:

```bash
helm install sp26-emb-live deploy/helm/sp26-emb-prod --namespace sp26-emb-live \
  -f deploy/helm/sp26-emb-prod/values-sp26-dev.yaml \
  --set namespace.name=sp26-emb-live \
  --set persistence.existingClaim=sp26-emb-data \
  --set ingress.enabled=false
# ...copy data into the PVC, then:
helm upgrade sp26-emb-live deploy/helm/sp26-emb-prod --namespace sp26-emb-live \
  -f deploy/helm/sp26-emb-prod/values-sp26-dev.yaml \
  --set namespace.name=sp26-emb-live \
  --set persistence.existingClaim=sp26-emb-data \
  --set ingress.enabled=true
```

## The test deployment

| Item            | Value                                                            |
|-----------------|------------------------------------------------------------------|
| Namespace       | `sp26-test`                                                      |
| Helm release    | `sp26-emb-test` (chart `deploy/helm/sp26-emb-test`, revision 1)  |
| Chart version   | 0.1.4                                                            |
| Visualizer      | `mylonasc/magarathea:visualizer-test-0.1.3` (ClusterIP :80)      |
| API             | `mylonasc/magarathea:api-test-0.1.3` (ClusterIP :8000)           |
| PVC             | `sp26-emb-test-data` (2Gi, `standard-rwo`), mounted at `/data`   |
| Ingresses       | `sp26-emb-test-navigator-ui`, `sp26-emb-test-navigator-api`, `sp26-emb-test-navigator-ui-redirect` |

Serves the base path `/sp26-test`. Installed with:

```bash
helm upgrade --install sp26-emb-test deploy/helm/sp26-emb-test --namespace sp26-test --create-namespace
```

Unlike the live deployment, the test chart renders its own `Namespace` and `PersistentVolumeClaim` (create them before the app pods start, then load data with the temporary-pod procedure from the chart README). It also references the `dockerhub-regcred` pull secret in the pod specs; that secret was copied into `sp26-test` from `sp26-emb-live` because the new namespace starts without it.

## Routing and ingresses

The chart renders three ingresses on the host `magarathea.ddns.net`:

| Ingress                         | Path                                | Annotation                          |
|---------------------------------|-------------------------------------|-------------------------------------|
| `sp26-emb-navigator-ui`         | `/streetparade-navigator-2026/(.*)` | `rewrite-target: /$1`               |
| `sp26-emb-navigator-api`        | `/streetparade-navigator-2026/api(/|$)(.*)` | `rewrite-target: /$2`      |
| `sp26-emb-navigator-ui-redirect`| `/streetparade-navigator-2026` (Exact) | `permanent-redirect: /streetparade-navigator-2026/` |

The UI ingress strips the base path before reaching the visualizer; the API ingress
strips `/api` as well. The API's real routes are therefore `/health`, `/visualization`
and `/tracks` — the `/api` prefix exists only at the ingress. The bare path returns a
301 to the trailing-slash form via `permanent-redirect`.

### Path-agnostic visualizer

The visualizer is built from `fe-visualizer/Dockerfile` with `VITE_BASE_PATH=./`, and
`fe-visualizer/src/api.js` derives its API base from `location.pathname`. One image
therefore works at any base path, which is why the UI/assets use relative URLs
(`./assets/...`).

The path-locked builds (`fe-visualizer/Dockerfile.navigator2026` /
`visualizer-minimal-*`) are **not** compatible with the chart ingresses: after the
rewrite they would serve their `location = /` health response as a non-HTML body and the
browser would download it. The live deployment therefore uses the path-agnostic
`visualizer-*` image built by `publish-dockerhub.yml` from `fe-visualizer/Dockerfile`
with `VITE_BASE_PATH=./`.

## TLS

TLS is host-level and shared — there is no per-namespace certificate.

- A Let's Encrypt certificate for `magarathea.ddns.net` is issued by cert-manager as a
  `Certificate` named `magarathea-ddns-net-tls` in the `dex` and `oauth2-proxy`
  namespaces, where the corresponding ingresses reference it in their own namespace.
- ingress-nginx merges all ingresses that share the host `magarathea.ddns.net` into one
  server block, and serves the certificate obtained from those ingresses.
- The SP26 ingresses also declare `secretName: magarathea-ddns-net-tls`, but that secret
  is intentionally not replicated into `sp26-emb-live`. The controller logs
  `no object matching key "sp26-emb-live/magarathea-ddns-net-tls"` and falls back to the
  merged server-block certificate, so TLS keeps working. The cert renews automatically
  via cert-manager.
- Because the certificate is the same for the whole host, no SP26 namespace ever needs a
  copy of the TLS secret.

## Container registry and pull secrets

- Images live on Docker Hub as `mylonasc/magarathea` (private).
- Each SP26 namespace contains a `dockerhub-regcred` (`kubernetes.io/dockerconfigjson`)
  secret holding a Docker Hub personal-access token, attached to the `default` service
  account via `imagePullSecrets`.
- `publish-dockerhub.yml` builds the `api-minimal-*`, `visualizer-minimal-*`
  (path-locked) and `visualizer-*` (path-agnostic) tags; `publish-dockerhub-test.yml`
  builds the `*-test-*` tags.

## Data

- The API pod mounts PVC `sp26-emb-data` at `/data`:
  - `streetparade_embeddings.sqlite3` (SQLite)
  - `vectorstore/` (numpy: `ids.json`, `metadata.jsonl`, `vectors.npy`)
- The storage class `standard-rwo` uses `volumeBindingMode: WaitForFirstConsumer`, so a
  PVC binds only once a pod mounts it.
- There is no automated backup; data is copied between deployments with a manual
  checkpoint + `kubectl cp` procedure.

## Charts

- `deploy/helm/sp26-emb-prod/` — the active chart (used for the live deployment).
  `values-sp26-dev.yaml` is the values file for the live base path.
- `deploy/helm/sp26-emb/` — legacy original prod chart (path-locked visualizer,
  LoadBalancer service, api-proxy sidecar). No longer deployed.
- `deploy/helm/sp26-emb-test/` — the active test chart, deployed to the `sp26-test`
  namespace at `/sp26-test` (chart version 0.1.4, images `*-test-0.1.3`). The former
  `sp26-prod` namespace is gone.

## Gotchas

- ingress-nginx's admission webhook rejects a new ingress whose host+path overlaps an
  existing one. To repoint a path, delete the old ingress first, then create the new one.
- `configuration-snippet` is disabled; `redirect-regex`/`redirect-replacement` are
  ignored; `permanent-redirect` works.
- Upgrading a Helm release across charts in the same namespace orphans old resources;
  `helm rollback` does not clean them up.
- The `sp26-emb` namespace is an empty leftover and can be deleted.
