# Street Parade 26 Live Helm Deployment

This chart deploys the Street Parade 26 embedding visualizer as the **live**
deployment, served under `/streetparade-navigator-2026` on `magarathea.ddns.net`
(namespace `sp26-emb-live`, release `sp26-emb-live`).

`values.yaml` is self-contained for the live deployment — namespace, base path,
`fullnameOverride`, existing PVC and ingress are all baked in, so **no `-f` or
`--set` overrides are needed**. It is deployed from `deploy/helm/sp26-emb-prod`
with `publish-dockerhub-test.yml`-style releases applied manually.

It uses the path-agnostic `visualizer-*` image and the minimal `api-minimal-*`
image published by the `publish-dockerhub.yml` / `publish-dockerhub-test.yml`
workflows (same tag naming for test and prod).

It deploys:

- API deployment using the minimal backend image.
- Visualizer deployment using the path-agnostic frontend image.
- Internal API service on port `8000`.
- Visualizer service on port `80`.
- The existing PVC `sp26-emb-data` mounted at `/data` in the API pod for
  `streetparade_embeddings.sqlite3` and `vectorstore/`.

The chart does not include the SQLite database or NumPy vector store in the
image. They are provided by the `sp26-emb-data` PVC.

## Prerequisites

- Helm 3.
- `kubectl` configured for the target cluster.
- The `sp26-emb-live` namespace exists (or use `--create-namespace`).
- DockerHub images already pushed by the CI workflow.
- Runtime data on the `sp26-emb-data` PVC:
  - `streetparade_embeddings.sqlite3`
  - `vectorstore/ids.json`
  - `vectorstore/metadata.jsonl`
  - `vectorstore/vectors.npy`

## Image Tags

The workflows publish version and immutable SHA tags to the single DockerHub
repository `mylonasc/magarathea`. Both environments share the same naming:

| Component  | Tags |
|------------|------|
| API        | `api-minimal-<version>`, `api-minimal-<version>-<sha>` |
| Visualizer | `visualizer-<version>`, `visualizer-<version>-<sha>` (path-agnostic) |

Prod builds add the `<minor>` variants. The path-locked
`visualizer-minimal-*` build exists for the legacy chart and must **never** be
used here.

## Install Or Upgrade

Render first, without applying:

```bash
helm template sp26-emb-live deploy/helm/sp26-emb-prod --namespace sp26-emb-live
```

Install or upgrade (no values overrides needed — `values.yaml` is the live
deployment):

```bash
helm upgrade --install sp26-emb-live deploy/helm/sp26-emb-prod --namespace sp26-emb-live
```

A first install on a fresh cluster:

```bash
helm upgrade --install sp26-emb-live deploy/helm/sp26-emb-prod \
  --namespace sp26-emb-live --create-namespace
```

If the PVC needs data loaded before the app starts, scale the app pods down
first, load the data with a temporary loader pod, then scale back up:

```bash
helm upgrade sp26-emb-live deploy/helm/sp26-emb-prod --namespace sp26-emb-live \
  --set api.replicaCount=0 --set visualizer.replicaCount=0
# ...load data into the sp26-emb-data PVC...
helm upgrade sp26-emb-live deploy/helm/sp26-emb-prod --namespace sp26-emb-live
```

## Load Data Into The PVC

Keep the app pods scaled to zero, then start a temporary pod that mounts the
same claim. Find the claim name:

```bash
kubectl get pvc -n sp26-emb-live
```

Create a temporary loader pod:

```bash
kubectl run sp26-data-loader -n sp26-emb-live \
  --image=busybox:1.36 \
  --restart=Never \
  --overrides='{
    "spec": {
      "containers": [{
        "name": "loader",
        "image": "busybox:1.36",
        "command": ["sleep", "3600"],
        "volumeMounts": [{"name": "data", "mountPath": "/data"}]
      }],
      "volumes": [{
        "name": "data",
        "persistentVolumeClaim": {"claimName": "sp26-emb-data"}
      }]
    }
  }'
```

Copy files:

```bash
kubectl cp streetparade_embeddings.sqlite3 -n sp26-emb-live sp26-data-loader:/data/streetparade_embeddings.sqlite3
kubectl cp vectorstore -n sp26-emb-live sp26-data-loader:/data/vectorstore
```

Clean up:

```bash
kubectl delete pod sp26-data-loader -n sp26-emb-live
helm upgrade sp26-emb-live deploy/helm/sp26-emb-prod --namespace sp26-emb-live
```

## Useful Checks

```bash
kubectl get all,pvc -n sp26-emb-live
kubectl rollout status deploy/sp26-emb-visualizer -n sp26-emb-live
kubectl logs -n sp26-emb-live deploy/sp26-emb-api
kubectl logs -n sp26-emb-live deploy/sp26-emb-visualizer
```

Public checks:

```bash
curl -sS https://magarathea.ddns.net/streetparade-navigator-2026/ | head -c 200
curl -sS https://magarathea.ddns.net/streetparade-navigator-2026/api/health
curl -sS 'https://magarathea.ddns.net/streetparade-navigator-2026/api/visualization?username=demo'
```

The UI path must serve HTML (the app), never a bare `ok` body — a bare body
means a path-locked visualizer image was used.

## Uninstall

```bash
helm uninstall sp26-emb-live -n sp26-emb-live
```

The `sp26-emb-data` PVC is kept (reclaim policy dependent); check before
deleting data:

```bash
kubectl get pvc -n sp26-emb-live
```
