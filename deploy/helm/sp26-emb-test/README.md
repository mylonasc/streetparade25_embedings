# Street Parade 26 Test Helm Deployment

This chart deploys the Street Parade 26 embedding visualizer into the
`sp26-test` namespace, served under `/sp26-test` on `magarathea.ddns.net`
(release `sp26-emb-test`). It is an isolated copy of the prod chart used for
testing before releases; it does not touch the live deployment in
`sp26-emb-live`.

It uses the same image tag naming as prod — `visualizer-*` (path-agnostic) and
`api-minimal-*` — published by `publish-dockerhub-test.yml` from the
`feat/sp26-test-env` branch (or by `publish-dockerhub.yml` from `main`).

It deploys:

- API deployment using the minimal backend image.
- Visualizer deployment using the path-agnostic frontend image.
- Internal API service on port `8000`.
- Visualizer service on port `80`.
- Its own Namespace (`sp26-test`) and PVC (mounted at `/data` in the API pod).

The chart does not include the SQLite database or NumPy vector store in the
image. Provide them through the PVC.

## Prerequisites

- Helm 3.
- `kubectl` configured for the target cluster.
- DockerHub images already pushed by the CI workflow.
- A `dockerhub-regcred` pull secret in the `sp26-test` namespace (copy it from
  `sp26-emb-live` for a fresh namespace).
- Runtime data prepared locally:
  - `streetparade_embeddings.sqlite3`
  - `vectorstore/ids.json`
  - `vectorstore/metadata.jsonl`
  - `vectorstore/vectors.npy`

## Image Tags

The workflows publish version and immutable SHA tags to the single DockerHub
repository `mylonasc/magarathea`. The test chart uses the same naming as prod:

| Component  | Tags |
|------------|------|
| API        | `api-minimal-<version>`, `api-minimal-<version>-<sha>` |
| Visualizer | `visualizer-<version>`, `visualizer-<version>-<sha>` (path-agnostic) |

For a test release of a branch build, prefer the immutable `<version>-<sha>`
tag in `values.yaml` so a later main build cannot overwrite the mutable
`<version>` tag.

## Prepare Runtime Data

Copy `streetparade_embeddings.sqlite3` and `vectorstore/` from a working
checkpoint (e.g. from the live PVC) before or after installing:

```bash
test -f streetparade_embeddings.sqlite3
test -f vectorstore/ids.json
test -f vectorstore/metadata.jsonl
test -f vectorstore/vectors.npy
```

## Install Or Upgrade

Render first, without applying:

```bash
helm template sp26-emb-test deploy/helm/sp26-emb-test --namespace sp26-test
```

Install or upgrade (`values.yaml` is self-contained; the chart creates its own
Namespace and PVC):

```bash
helm upgrade --install sp26-emb-test deploy/helm/sp26-emb-test \
  --namespace sp26-test --create-namespace
```

To test a specific branch build, override the image tags:

```bash
helm upgrade sp26-emb-test deploy/helm/sp26-emb-test --namespace sp26-test \
  --set visualizer.image.tag=visualizer-0.1.4-<short_sha>
```

## Load Data Into The PVC

Keep the app pods scaled to zero, then start a temporary pod that mounts the
claim (the chart creates `sp26-emb-test-data`):

```bash
helm upgrade sp26-emb-test deploy/helm/sp26-emb-test --namespace sp26-test \
  --set api.replicaCount=0 --set visualizer.replicaCount=0
kubectl get pvc -n sp26-test
kubectl run sp26-test-data-loader -n sp26-test \
  --image=busybox:1.36 --restart=Never --overrides='{
    "spec": {
      "containers": [{
        "name": "loader",
        "image": "busybox:1.36",
        "command": ["sleep", "3600"],
        "volumeMounts": [{"name": "data", "mountPath": "/data"}]
      }],
      "volumes": [{
        "name": "data",
        "persistentVolumeClaim": {"claimName": "sp26-emb-test-data"}
      }]
    }
  }'
kubectl cp streetparade_embeddings.sqlite3 -n sp26-test sp26-test-data-loader:/data/streetparade_embeddings.sqlite3
kubectl cp vectorstore -n sp26-test sp26-test-data-loader:/data/vectorstore
kubectl delete pod sp26-test-data-loader -n sp26-test
helm upgrade sp26-emb-test deploy/helm/sp26-emb-test --namespace sp26-test
```

## Useful Checks

```bash
kubectl get all,pvc -n sp26-test
kubectl rollout status deploy/sp26-emb-test-visualizer -n sp26-test
kubectl logs -n sp26-test deploy/sp26-emb-test-api
```

Public checks:

```bash
curl -sS https://magarathea.ddns.net/sp26-test/ | head -c 200
curl -sS https://magarathea.ddns.net/sp26-test/api/health
```

The UI path must serve HTML (the app), never a bare `ok` body — a bare body
means a path-locked visualizer image was used.

## Uninstall

```bash
helm uninstall sp26-emb-test -n sp26-test
```

The PVC is not always deleted automatically depending on the storage class
reclaim policy. Check before deleting data:

```bash
kubectl get pvc -n sp26-test
```
