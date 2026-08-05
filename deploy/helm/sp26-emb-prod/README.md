# Street Parade 26 Prod Staging Helm Deployment

This chart deploys the Street Parade 26 embedding visualizer into the `sp26-prod` namespace, served under the `/sp26-prod` path on `magarathea.ddns.net`. It is an isolated staging copy of the `sp26-emb` chart used to validate the target production configuration; it does not touch the production deployment in `sp26-dev`.

It uses the path-agnostic `visualizer-test-*` and `api-test-*` images published by the `publish-dockerhub-test.yml` workflow.

It deploys:

- API deployment using the minimal backend image.
- Visualizer deployment using the minimal frontend image.
- Internal API service on port `8000`.
- Visualizer service on port `80` plus an API proxy on port `8000`.
- A PVC mounted at `/data` in the API pod for `streetparade_embeddings.sqlite3` and `vectorstore/`.

The chart does not include the SQLite database or NumPy vector store in the image. Provide them through the PVC.

## Prerequisites

- Helm 3.
- `kubectl` configured for the target cluster.
- DockerHub images already pushed by the CI workflow.
- Runtime data prepared locally:
  - `streetparade_embeddings.sqlite3`
  - `vectorstore/ids.json`
  - `vectorstore/metadata.jsonl`
  - `vectorstore/vectors.npy`

## Image Tags

The CI workflow publishes both version and immutable SHA tags to a single DockerHub repository.

Example tags for version `0.1.0`:

```text
your-dockerhub-user/your-single-repo:api-minimal-0.1.0
your-dockerhub-user/your-single-repo:visualizer-minimal-0.1.0
```

For Kubernetes production rollouts, prefer SHA-qualified tags from CI:

```text
your-dockerhub-user/your-single-repo:api-minimal-0.1.0-<short_sha>
your-dockerhub-user/your-single-repo:visualizer-minimal-0.1.0-<short_sha>
```

## Prepare Runtime Data

If you still have Chroma data, export it to the NumPy vector store before loading data into the cluster:

```bash
docker run --rm \
  --user "$(id -u):$(id -g)" \
  -v "$PWD/chroma:/app/chroma" \
  -v "$PWD/vectorstore:/data/vectorstore" \
  streetparade-api-numpy-full-check \
  python -m streetparade_embeddings.vectorstore export-chroma \
    --chroma-dir /app/chroma \
    --out /data/vectorstore
```

Run the export with a full/local image that has `chromadb` installed. The minimal DockerHub API image is intentionally Chroma-free and cannot perform this export.

Validate the exported store locally:

```bash
test -f streetparade_embeddings.sqlite3
test -f vectorstore/ids.json
test -f vectorstore/metadata.jsonl
test -f vectorstore/vectors.npy
```

## Configure Values

Create a local values file, for example `sp26-values.yaml`:

```yaml
image:
  repository: your-dockerhub-user/your-single-repo

api:
  image:
    tag: api-minimal-0.1.0

visualizer:
  image:
    tag: visualizer-minimal-0.1.0
  service:
    type: LoadBalancer

persistence:
  storageClassName: ""
  size: 2Gi
```

Use immutable CI tags when available:

```yaml
api:
  image:
    tag: api-minimal-0.1.0-<short_sha>

visualizer:
  image:
    tag: visualizer-minimal-0.1.0-<short_sha>
```

## Install Or Upgrade

Render first, without applying:

```bash
helm template sp26-emb ./deploy/helm/sp26-emb \
  --namespace sp26-emb \
  -f deploy/helm/sp26-emb/values.yaml
```

Install or upgrade.

For a first install where the PVC still needs data, start with the app pods scaled down:

```bash
helm upgrade --install sp26-emb ./deploy/helm/sp26-emb \
  --namespace sp26-dev \
  -f deploy/helm/sp26-emb/values.yaml \
  --set api.replicaCount=0 \
  --set visualizer.replicaCount=0
```

After loading data into the PVC, scale back to normal:

```bash
helm upgrade --install sp26-emb ./deploy/helm/sp26-emb \
  --namespace sp26-dev \
  -f deploy/helm/sp26-emb/values.yaml
```

## Load Data Into The PVC

After the chart creates the PVC, copy the runtime data into it. One safe pattern is to keep the app pods scaled to zero, then start a temporary pod that mounts the same claim.

Find the claim name:

```bash
kubectl get pvc -n sp26-emb
```

Create a temporary loader pod, replacing the claim name if needed:

```bash
kubectl run sp26-data-loader -n sp26-emb \
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

# User data in sqlite:
kubectl cp streetparade_embeddings.sqlite3 -n sp26-dev sp26-data-loader:/data/streetparade_embeddings.sqlite3

# 2. The numpy vectorstore data:
kubectl cp vectorstore -n sp26-dev sp26-data-loader:/data/vectorstore
```

Clean up:

```bash
kubectl delete pod sp26-data-loader -n sp26-emb
helm upgrade --install sp26-emb ./deploy/helm/sp26-emb \
  --namespace sp26-dev \
  -f sp26-values.yaml
```

## Networking Notes

The currently published visualizer image resolves the API as:

```text
http(s)://<browser-host>:8000
```

To support that without rebuilding the frontend, the chart runs an `nginx` API-proxy sidecar in the visualizer pod and exposes port `8000` on the visualizer service. The API service itself stays internal.

Default exposure is:

```yaml
visualizer:
  service:
    type: LoadBalancer
    webPort: 80
    apiProxyPort: 8000
```

Your external load balancer or DNS must make both ports reachable on the same host/IP:

- UI: `http://<host>/`
- API proxy used by the browser: `http://<host>:8000/`

If your cluster only supports Ingress on ports `80`/`443`, rebuild and publish the visualizer with `VITE_API_BASE_URL=/api` or a fully qualified API URL, then adjust the chart accordingly. The default published minimal image does not support runtime API URL injection.

## Useful Checks

```bash
kubectl get all,pvc -n sp26-dev
kubectl logs -n sp26-dev deploy/sp26-emb-api
kubectl logs -n sp26-dev deploy/sp26-emb-visualizer -c visualizer
kubectl logs -n sp26-dev deploy/sp26-emb-visualizer -c api-proxy
```

Port-forward for local testing:

```bash
kubectl port-forward -n sp26-dev svc/sp26-emb-visualizer 8080:80 8000:8000
```

Then open:

```text
http://127.0.0.1:8080
```

## Uninstall

```bash
helm uninstall sp26-emb -n sp26-emb
```

PVCs are not always deleted automatically depending on storage class reclaim policy. Check before deleting data:

```bash
kubectl get pvc -n sp26-emb
```
