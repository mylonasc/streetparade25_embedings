# Updating the Production Deployment (`sp26-dev`)

This runbook migrates the live production deployment in namespace `sp26-dev` from the
manually-managed setup to the aligned Helm chart. It was validated against the permanent
staging environment in namespace `sp26-prod` (served at `/sp26-prod`), which runs the same
chart (`deploy/helm/sp26-emb-prod`) with real production data.

## Current state of production (`sp26-dev`)

- Two Helm releases exist that overlap:
  - `sp26-emb` (revision 17) in namespace `sp26-dev` — the live release.
  - `sp26-dev` (revision 1) in namespace `sp26-emb` — a stale/leftover release that also
    created resources inside `sp26-dev` (`sp26-dev-sp26-emb-*` services, PVC and ConfigMap).
- The ingresses `sp26-emb-navigator-ui-public` and `sp26-emb-navigator-api-public` are
  **manually created** (no Helm ownership) and must be removed in favour of chart-managed ones.
- The visualizer service is `LoadBalancer` with an `nginx` sidecar proxy
  (`visualizer.apiProxy.enabled: true`). The aligned chart uses `ClusterIP` and routes `/api`
  through the ingress instead.
- Images are the path-locked `visualizer-minimal-0.1.2` (built from
  `Dockerfile.navigator2026`). The aligned chart uses the path-agnostic build
  (`fe-visualizer/Dockerfile`, `VITE_BASE_PATH=./`).
- No `imagePullSecrets` (`image.pullSecrets: []`). The chart sets
  `pullSecrets: [dockerhub-regcred]` and `pullPolicy: Always`.

## Prerequisites

- `helm` CLI and `kubectl` configured for the cluster.
- The `deploy/helm/sp26-emb-prod` chart exists in the repository (it is a copy of the
  staging chart, with helpers renamed to `sp26-emb-prod.*`).
- A `values-sp26-dev.yaml` file exists next to the chart (see below). If it does not exist,
  create it from the template in this document.

## Target configuration (`values-sp26-dev.yaml`)

Place this next to the chart as `deploy/helm/sp26-emb-prod/values-sp26-dev.yaml`:

```yaml
namespace:
  create: false
  name: sp26-dev

# Keep the existing resource names (sp26-emb-api, sp26-emb-visualizer, sp26-emb-data)
# so the upgrade updates the live objects in place.
fullnameOverride: sp26-emb

image:
  repository: mylonasc/magarathea
  pullPolicy: Always
  pullSecrets:
    - name: dockerhub-regcred

api:
  image:
    tag: api-test-0.1.2
  service:
    type: ClusterIP
    port: 8000
  env:
    STREETPARADE_DB: /data/streetparade_embeddings.sqlite3
    STREETPARADE_VECTOR_STORE: numpy
    STREETPARADE_NUMPY_VECTOR_DIR: /data/vectorstore
    ENABLE_SONG_DL_AND_EMBEDINGS: "0"
    STREETPARADE_CORS_ORIGINS: ""
    STREETPARADE_CORS_ORIGIN_REGEX: "https?://.*"

visualizer:
  image:
    tag: visualizer-test-0.1.2
  service:
    type: ClusterIP
  apiProxy:
    enabled: false

persistence:
  enabled: true
  existingClaim: ""
  keep: true
  size: 2Gi

ingress:
  enabled: true
  host: magarathea.ddns.net
  basePath: /streetparade-navigator-2026
  trailingSlashRedirect: true
  annotations:
    kubernetes.io/ingress.class: nginx
    nginx.ingress.kubernetes.io/use-regex: "true"
  tls:
    - hosts:
        - magarathea.ddns.net
      secretName: magarathea-ddns-net-tls
```

> **Important:** the visualizer image MUST be the path-agnostic build
> (`fe-visualizer/Dockerfile`, `VITE_BASE_PATH=./`). The chart's UI ingress rewrites the
> base path away, so the path-locked `visualizer-minimal-*` build (from
> `Dockerfile.navigator2026`) would serve its `location = /` "ok" health response as a
> non-HTML body — the browser would offer to download it. Until
> `publish-dockerhub.yml` is changed to build the visualizer from
> `fe-visualizer/Dockerfile`, use the proven `*-test-*` tags (as in the snippet above).
> The API `*-test-*` build is identical to the prod minimal build.

## Steps

### 1. Pre-flight checks

```bash
kubectl get pods -n sp26-dev
curl -sS -o /dev/null -w '%{http_code}\n' https://magarathea.ddns.net/streetparade-navigator-2026/
curl -sS -o /dev/null -w '%{http_code}\n' https://magarathea.ddns.net/streetparade-navigator-2026/api/health
```

### 2. Ensure the pull secret exists in `sp26-dev`

```bash
kubectl get secret dockerhub-regcred -n sp26-dev >/dev/null 2>&1 || \
  kubectl create secret docker-registry dockerhub-regcred -n sp26-dev \
    --from-file=.dockerconfigjson=<(kubectl get secret dockerhub-regcred -n sp26-prod \
      -o jsonpath='{.data.\.dockerconfigjson}' | base64 -d)
kubectl patch serviceaccount default -n sp26-dev -p '{"imagePullSecrets":[{"name":"dockerhub-regcred"}]}'
```

### 3. Dry-run the upgrade

```bash
helm template sp26-emb deploy/helm/sp26-emb-prod \
  --namespace sp26-dev \
  -f deploy/helm/sp26-emb-prod/values-sp26-dev.yaml > /tmp/sp26-emb-render.yaml
grep -E 'name:|image:|path:' /tmp/sp26-emb-render.yaml
```

Confirm the rendered resource names are `sp26-emb-*` (deployment, services, PVC,
`sp26-emb-navigator-ui` / `sp26-emb-navigator-api` / `sp26-emb-navigator-ui-redirect`).

### 4. Delete the manual ingresses FIRST

The chart declares the same host+paths as the manual ingresses
(`sp26-emb-navigator-ui-public`, `sp26-emb-navigator-api-public`). The ingress-nginx
admission webhook rejects a second ingress defining the same host/path, so the manual
ingresses must be removed **before** the upgrade:

```bash
kubectl delete ingress sp26-emb-navigator-ui-public sp26-emb-navigator-api-public -n sp26-dev
```

The upgrade in step 5 recreates routing through the chart-managed ingresses.

### 5. Perform the upgrade

```bash
helm upgrade sp26-emb deploy/helm/sp26-emb-prod \
  --namespace sp26-dev \
  -f deploy/helm/sp26-emb-prod/values-sp26-dev.yaml
kubectl rollout status deploy/sp26-emb-api -n sp26-dev --timeout=180s
kubectl rollout status deploy/sp26-emb-visualizer -n sp26-dev --timeout=180s
kubectl get pods -n sp26-dev
```

### 6. Remove the stale release and duplicate resources

```bash
helm uninstall sp26-dev --namespace sp26-emb
# Then confirm nothing remains in the sp26-emb namespace:
kubectl get all,pvc,cm -n sp26-emb
```

The duplicate objects created by that release inside `sp26-dev`
(`sp26-dev-sp26-emb-api`, `sp26-dev-sp26-emb-visualizer`,
`sp26-dev-sp26-emb-data`, `sp26-dev-sp26-emb-api-proxy`) are owned by the uninstalled
release and should be deleted with it. Verify:

```bash
kubectl get svc,pvc,cm -n sp26-dev | grep -E 'sp26-dev-sp26-emb|sp26-emb'
```

Remove the unrelated `rbac-test` service if it is confirmed unused:

```bash
kubectl delete svc rbac-test -n sp26-dev   # only if confirmed unused
```

### 7. Verify production

```bash
# UI (must be text/html, NOT application/octet-stream)
curl -sS -D - -o /dev/null https://magarathea.ddns.net/streetparade-navigator-2026/ | grep -iE 'HTTP/|content-type'
curl -sS https://magarathea.ddns.net/streetparade-navigator-2026/ | grep -o 'src="[^"]*"' | head -1
# API
curl -sS -o /dev/null -w '%{http_code}\n' https://magarathea.ddns.net/streetparade-navigator-2026/api/health
# Data parity with staging
curl -sS https://magarathea.ddns.net/streetparade-navigator-2026/api/visualization | \
  python3 -c "import sys,json; print('prod points:', len(json.load(sys.stdin)['points']))"
curl -sS https://magarathea.ddns.net/sp26-prod/api/visualization | \
  python3 -c "import sys,json; print('staging points:', len(json.load(sys.stdin)['points']))"
```

## Rollback

If the UI or API regresses:

1. `helm rollback sp26-emb <previous-revision> --namespace sp26-dev`.
2. Re-create the manual ingresses (`sp26-emb-navigator-ui-public`,
   `sp26-emb-navigator-api-public`) from the original manifests or the saved versions
   below. A rollback removes the chart-managed ingresses, so routing is restored only
   once the manual ones are back.
3. Verify `kubectl get pods -n sp26-dev` and the endpoints above.
4. Do **not** delete the stale `sp26-dev` release or the chart-managed ingresses until the
   new configuration is confirmed working.

### Save the manual ingress manifests before upgrading

To make rollback easy, export the manual ingresses to a file before deleting them in
step 4:

```bash
kubectl get ingress sp26-emb-navigator-ui-public sp26-emb-navigator-api-public \
  -n sp26-dev -o yaml > /tmp/sp26-manual-ingresses.yaml
```

## Refreshing the staging data (`sp26-prod`)

To copy the current production database and vector store into the staging PVC:

```bash
# checkpoint WAL on prod
kubectl exec -n sp26-dev deploy/sp26-emb-api -- \
  python3 -c "import sqlite3; c=sqlite3.connect('/data/streetparade_embeddings.sqlite3'); c.execute('PRAGMA wal_checkpoint(TRUNCATE)'); c.close()"

PROD_POD=$(kubectl get pods -n sp26-dev -o name | grep api | head -1 | cut -d/ -f2)
mkdir -p /tmp/sp26-data
kubectl cp -n sp26-dev "$PROD_POD:/data/streetparade_embeddings.sqlite3" /tmp/sp26-data/
kubectl cp -n sp26-dev "$PROD_POD:/data/vectorstore" /tmp/sp26-data/

kubectl scale deploy sp26-emb-prod-api -n sp26-prod --replicas=0
cat <<'EOF' | kubectl apply -f -
apiVersion: v1
kind: Pod
metadata:
  name: sp26-prod-data-copy
  namespace: sp26-prod
spec:
  restartPolicy: Never
  containers:
    - name: copy
      image: busybox
      command: ["/bin/sh", "-c", "sleep 300"]
      volumeMounts:
        - name: data
          mountPath: /data
  volumes:
    - name: data
      persistentVolumeClaim:
        claimName: sp26-emb-prod-data
EOF
kubectl wait --for=condition=Ready pod/sp26-prod-data-copy -n sp26-prod --timeout=120s
kubectl cp /tmp/sp26-data/streetparade_embeddings.sqlite3 sp26-prod/sp26-prod-data-copy:/data/
kubectl cp /tmp/sp26-data/vectorstore sp26-prod/sp26-prod-data-copy:/data/
kubectl exec -n sp26-prod sp26-prod-data-copy -- \
  rm -f /data/streetparade_embeddings.sqlite3-shm /data/streetparade_embeddings.sqlite3-wal
kubectl delete pod sp26-prod-data-copy -n sp26-prod
kubectl scale deploy sp26-emb-prod-api -n sp26-prod --replicas=1
kubectl rollout status deploy/sp26-emb-prod-api -n sp26-prod --timeout=180s
rm -rf /tmp/sp26-data
```
