# ezbeq Docker

Creates and publishes Docker images for [ezbeq](https://github.com/3ll3d00d/ezbeq) to GitHub Packages (GHCR), for use with [MiniDSP](https://www.minidsp.com), [JRiver Media Center](https://www.jriver.com), or any ezBEQ-compatible DSP.

> [!NOTE]
> This image has not been tested with USB connected devices.
> There are instructions on how to mount USB devices from another legacy docker image project:
> - [General docker discussion](https://github.com/jmery/ezbeq-docker/tree/ef3f954f37b1b420e31635a699bfbb864e861ad9?tab=readme-ov-file#general-linux-docker-instructions)
> - [Synology NAS discussion](https://github.com/jmery/ezbeq-docker/tree/ef3f954f37b1b420e31635a699bfbb864e861ad9?tab=readme-ov-file#general-linux-docker-instructions)
> - [Higher privileges discussion](https://github.com/jmery/ezbeq-docker/tree/ef3f954f37b1b420e31635a699bfbb864e861ad9?tab=readme-ov-file#note-on-execute-container-using-high-privilege)

## Contents

- [Setup](#setup)
- [FAQ](#faq)
- [Running with Docker Compose](#running-with-docker-compose)
- [Running a local branch](#running-a-local-branch)
- [Running in Kubernetes](#running-in-kubernetes)
- [CI / Published Images](#ci--published-images)
- [Developer Documentation](#developer-documentation)

## Setup

- Expects a volume mapped to `/config` to allow user-supplied `ezbeq.yml`
- Supports `linux/amd64` and `linux/arm64`
- Installs the [minidsp-rs](https://github.com/mrene/minidsp-rs) binary automatically
- Exposes port 8080 by default (configurable via `port:` in `ezbeq.yml`)

Example docker compose file for your reference: [docker-compose.yaml](./docker-compose.yaml)

## FAQ

> Does this docker image work for [MiniDSP](https://www.minidsp.com) devices?

Yes.

> Does this build and publish an image for every ezBEQ release?

Yes - the `create-app.yaml` workflow builds and pushes to GHCR on every push to `main` and on tag creation (alongside the PyPI and pyinstaller release artifacts).

> What architectures are supported?

The docker image gets built to target:

- `linux/amd64`
- `linux/arm64`

## Running with Docker Compose

`docker compose up -d` works with no configuration - it pulls the published image and mounts `~/.ezbeq` as the config directory by default.

To use a different config directory, set `EZBEQ_CONFIG_HOME` in a `.env` file (copy `.env.example`):

```bash
cd docker
cp .env.example .env
# set EZBEQ_CONFIG_HOME=/path/to/your/config
docker compose up -d
```

[docker-compose.yaml](./docker-compose.yaml) also reads `EZBEQ_PORT` from `.env` if your `ezbeq.yml` uses a non-default port. To customise further (e.g. add `extra_hosts` for a MiniDSP hostname, change the user, mount USB devices), add a `docker-compose.override.yaml` alongside it - Docker Compose picks it up automatically.

See the [ezbeq documentation](https://github.com/3ll3d00d/ezbeq) for `ezbeq.yml` configuration options.

---

## Running a local branch

To build and run from a local ezbeq source tree (e.g. an unreleased branch):

**1. Copy `.env.example` to `.env`:**

```bash
cd docker
cp .env.example .env
# edit .env - set EZBEQ_CONFIG_HOME to your config dir if not using ~/.ezbeq
```

**2. Run it:**

```bash
scripts/run-local            # build image and start (detached)
scripts/run-local --logs     # start and follow logs
scripts/run-local --rebuild  # force a full image rebuild
scripts/run-local --stop     # stop and remove the container
```

`scripts/run-local` loads `.env`, auto-detects the port from your `ezbeq.yml`, extracts git branch/SHA for the UI footer, and runs:
```
docker compose -f docker-compose.yaml -f docker-compose.dev.yaml up --build
```
[docker-compose.dev.yaml](./docker-compose.dev.yaml) extends the base config with the `dev` build target, which compiles the React UI from source and installs Python deps via Poetry.

## Build targets

| Target | Purpose |
|--------|---------|
| `production` | CI/published image - installs `ezbeq` from PyPI |
| `dev` | Local dev - builds from source using Poetry + Node/Yarn, includes git build info |

---

## Running in Kubernetes

It's assumed that anyone using k8s has an idea of what they're doing and has a particular (network) architecture in their design which will be specific to their own setup.

An example of such a setup is provided by [@Frick](https://github.com/Frick) which may serve as a useful jumping-off point:

```yaml
---
apiVersion: v1
kind: Namespace
metadata:
  name: ezbeq
  labels:
    kubernetes.io/metadata.name: ezbeq
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: ezbeq-config
  namespace: ezbeq
data:
# see https://github.com/3ll3d00d/ezbeq/tree/main/examples for more
  ezbeq.yml: |
    accessLogging: false
    debugLogging: false
    devices:
      dsp1:
        channels:
          - sub1
          - sub2
        ip: 192.168.1.123:80
        type: htp1
        autoclear: true
    port: 8080
---
apiVersion: apps/v1
kind: Deployment
metadata:
  labels:
    app.kubernetes.io/instance: ezbeq
  name: ezbeq
  namespace: ezbeq
spec:
  progressDeadlineSeconds: 30
  replicas: 1
  selector:
    matchLabels:
      app.kubernetes.io/name: ezbeq
  strategy:
    type: Recreate
  template:
    metadata:
      labels:
        app.kubernetes.io/name: ezbeq
    spec:
      containers:
        - name: ezbeq
          image: ghcr.io/3ll3d00d/ezbeq:main
          imagePullPolicy: IfNotPresent
          volumeMounts:
            - mountPath: /config
              name: ezbeq-scratch
            - mountPath: /config/ezbeq.yml
              name: ezbeq-config
              subPath: ezbeq.yml
          livenessProbe:
            failureThreshold: 3
            httpGet:
              path: /api/1/version
              port: http
              scheme: HTTP
            periodSeconds: 10
            successThreshold: 1
            timeoutSeconds: 1
          ports:
            - containerPort: 8080
              name: http
              protocol: TCP
          readinessProbe:
            failureThreshold: 3
            httpGet:
              path: /api/1/version
              port: http
              scheme: HTTP
            periodSeconds: 10
            successThreshold: 1
            timeoutSeconds: 1
          resources:
            limits:
              cpu: 200m
              memory: 256Mi
            requests:
              cpu: 200m
              memory: 256Mi
          startupProbe:
            failureThreshold: 30
            httpGet:
              path: /api/1/version
              port: http
              scheme: HTTP
            periodSeconds: 10
            successThreshold: 1
            timeoutSeconds: 1
      volumes:
        - name: ezbeq-scratch
          emptyDir:
            sizeLimit: 120Mi
        - name: ezbeq-config
          configMap:
            name: ezbeq-config
      terminationGracePeriodSeconds: 30
---
apiVersion: v1
kind: Service
metadata:
  name: ezbeq
  namespace: ezbeq
spec:
  selector:
    app.kubernetes.io/name: ezbeq
  type: ClusterIP
  ports:
    - name: http
      port: 8080
      targetPort: http
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: ezbeq
  namespace: ezbeq
  annotations:
    cert-manager.io/cluster-issuer: lets-encrypt
    nginx.ingress.kubernetes.io/ssl-redirect: "true"
    nginx.ingress.kubernetes.io/websocket-services: "ezbeq"
    external-dns.alpha.kubernetes.io/hostname: ezbeq.yourdomain.dev
spec:
  ingressClassName: nginx
  rules:
    - host: ezbeq.yourdomain.dev
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: ezbeq
                port:
                  number: 8080
  tls:
    - hosts:
        - ezbeq.yourdomain.dev
      secretName: ezbeq-tls
```

---

## CI / Published Images

The `create-app.yaml` workflow publishes images to GHCR (same workflow that cuts PyPI and pyinstaller releases):

| Trigger | Image tag | What it builds |
|---------|-----------|----------------|
| Push to `main` | `:main` | Production target - ezbeq from PyPI |
| Tag push | `:<tag>` | Production target - ezbeq from PyPI |
| Manual (`workflow_dispatch`) | `:<branch>` | Production target from any branch |

To use a published image:

```yaml
# docker-compose.yaml
image: ghcr.io/<owner>/ezbeq:main
```

### Publishing manually

`scripts/publish-image` builds from the current source tree and pushes to GHCR. Useful for demo images, one-off builds, or branches without CI:

```bash
scripts/publish-image              # prompt for tag (default: demo)
scripts/publish-image demo         # build + push ghcr.io/<owner>/ezbeq:demo
scripts/publish-image demo v1.2.3  # multiple tags in one push
OWNER=3ll3d00d scripts/publish-image demo           # override the GHCR owner
PLATFORMS=linux/amd64 scripts/publish-image demo    # single-arch (faster)
```

Produces a multi-arch manifest (`linux/amd64` + `linux/arm64`) in a single buildx step, so the image runs natively on both Apple Silicon and x86_64 hosts. Requires `docker login ghcr.io` first (use a PAT with `write:packages`) and a buildx builder supporting the requested platforms — on Docker Desktop this works out of the box; elsewhere see [Docker buildx docs](https://docs.docker.com/build/building/multi-platform/). The owner is auto-detected from the `origin` remote unless `OWNER` is set. Always rebuilds — no cache shortcut. GIT_BRANCH and GIT_SHA are extracted from the local repo and baked into the image so the UI footer reflects the exact source.

---

## Developer Documentation

### Manual build

```bash
# From repo root:
docker build -f docker/Dockerfile --target production -t ezbeq .
docker build -f docker/Dockerfile --target dev -t ezbeq-dev .
```

### Multi-platform Docker image

Build for two architectures in parallel and push:

```bash
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -f docker/Dockerfile \
  -t <HUB USERNAME>/ezbeq:latest \
  --push .
```

#### Buildx setup

Requires Docker's `buildx`:

- `docker buildx create --use`
- `docker buildx inspect --bootstrap`
