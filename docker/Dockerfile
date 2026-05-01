# syntax=docker/dockerfile:1
#
# Multi-stage build with four build targets:
#
#   base        – shared OS packages + minidsp binary (not used directly)
#   ui-builder  – compiles the React UI via Yarn/Vite. Feeds both production
#                 and dev builder stages.
#   builder     – production Python venv: builds a wheel from local source
#                 and installs it into /opt/venv. No PyPI fetch; the image
#                 reflects exactly the source at build time.
#   production  – default; clean runtime image with non-root user. Built by
#                 CI / `scripts/publish-image` / `docker buildx bake`.
#   dev         – local development; Poetry-managed venv, source mounted in
#                 via docker-compose.dev.yaml so edits take effect on restart.

# ── Base: runtime OS + minidsp binary ────────────────────────────────────────
# Shared by both the production and dev build targets.
# python:3.13-slim-trixie: Debian 13 (stable), native Python 3.13, glibc 2.40
FROM python:3.13-slim-trixie AS base

ENV EZBEQ_CONFIG_HOME=/config

# Install runtime-only dependencies required by the application.
# BuildKit cache mounts persist /var/cache/apt and /var/lib/apt across builds
# so repeat builds don't re-download .deb files. The default
# /etc/apt/apt.conf.d/docker-clean auto-wipes these after every install, so we
# remove it first to keep the cache effective.
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    rm -f /etc/apt/apt.conf.d/docker-clean && \
    apt-get update && apt-get install --no-install-recommends -y \
    curl \
    sqlite3 \
    # minidsp is dynamically linked against libusb-1.0.so.0 and expects it to be
    # available in the environment, even if USB communication isn't being used
    libusb-1.0-0

# Always pull the latest minidsp-rs release. Matches upstream author intent
# and picks up new device support automatically on every image rebuild,
# without a manual version bump. Dependabot's docker ecosystem can't track
# `curl`-based downloads from GitHub releases, so a pin would mean recurring
# manual SHA-256 work; the supply-chain risk from mrene/minidsp-rs (stable
# repo, no compromise history) doesn't justify that ongoing cost. Revisit
# if that trust assumption changes.
RUN ARCH=$(dpkg --print-architecture) && \
    case "$ARCH" in \
      amd64) ARCH="x86_64-unknown-linux-gnu" ;; \
      arm64) ARCH="aarch64-unknown-linux-gnu" ;; \
      armhf) ARCH="arm-linux-gnueabihf-rpi" ;; \
      *) echo "Unsupported architecture: $ARCH"; exit 1 ;; \
    esac && \
    URL="https://github.com/mrene/minidsp-rs/releases/latest/download/minidsp.${ARCH}.tar.gz" && \
    curl -fL --retry 3 --retry-delay 5 --max-time 120 -o "minidsp.${ARCH}.tar.gz" "$URL" && \
    tar -xzf "minidsp.${ARCH}.tar.gz" && \
    mv minidsp /usr/local/bin/minidsp && \
    chmod +x /usr/local/bin/minidsp && \
    rm "minidsp.${ARCH}.tar.gz"

WORKDIR /app

VOLUME ["/config"]

# Git build info - passed via --build-arg in CI, surfaced in the UI footer.
# Defaults to empty so local builds without args still work.
ARG GIT_BRANCH=""
ARG GIT_SHA=""
ENV GIT_BRANCH=${GIT_BRANCH}
ENV GIT_SHA=${GIT_SHA}

# OCI image annotations. image.source lets GHCR auto-link the package to its
# GitHub repo on push (unblocking CI write access and surfacing repo info on
# the package page). image.description populates the package summary.
# Both default to empty for local builds; publish-image and CI's
# docker/metadata-action fill them in.
ARG REPO_URL=""
ARG REPO_DESCRIPTION="ezbeq: BEQ management for MiniDSP, JRiver, CamillaDSP and other DSPs"
LABEL org.opencontainers.image.source=$REPO_URL \
      org.opencontainers.image.description=$REPO_DESCRIPTION

# Document the default port. The actual port is set via 'port:' in ezbeq.yml
# and must be reflected in the compose file's ports: and healthcheck: entries.
EXPOSE 8080

# ── UI builder: compile React app ────────────────────────────────────────────
# Isolated Node stage so node_modules never enters the final image layers.
# Only the Vite dist output (~a few MB) is copied across; the 200MB+
# node_modules is discarded after this stage completes.
# Declared before `builder` because both the production and dev targets copy
# the compiled UI from here.
FROM node:22-slim AS ui-builder

WORKDIR /app/ui

# Copy ui source. .yarnrc.yml references .yarn/releases/yarn-4.12.0.cjs so
# the whole ui/ tree is needed.  node_modules and .yarn/cache are excluded
# via .dockerignore so the build context stays small.
COPY ui/ .

# Mount the yarn cache at the location Yarn 4 uses when enableGlobalCache is
# false (i.e. the project-local .yarn/cache dir).  This persists the package
# zip archives across builds so yarn install is fast on cache hits.
RUN --mount=type=cache,target=/app/ui/.yarn/cache \
    yarn install --silent && yarn build

# ── Production builder: build a wheel from local source + install it ─────────
# Produces /opt/venv containing ezbeq + runtime deps + the compiled UI. No
# PyPI fetch; the image reflects exactly the source at build time. On tag
# builds, CI writes ezbeq/VERSION before `docker build`; that file is included
# in the wheel via pyproject.toml's `include` list, so the image carries the
# released version. On branch builds with no VERSION file, config.version
# falls back to pyproject.toml's declared version.
FROM base AS builder

RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    rm -f /etc/apt/apt.conf.d/docker-clean && \
    apt-get update && apt-get install --no-install-recommends -y \
    build-essential \
    python3-venv && \
    python -m pip install --upgrade pip

RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:${PATH}"

# Source layout needed for `pip install .` to build a wheel:
# - pyproject.toml + poetry.lock: build-system config and deps.
# - README.md: referenced by pyproject.toml's `readme` field.
# - ezbeq/: the Python package source (including VERSION when CI wrote it).
# - ezbeq/ui/: compiled UI from the ui-builder stage, included as package data.
COPY pyproject.toml poetry.lock README.md ./
COPY ezbeq/ ./ezbeq/
COPY --from=ui-builder /app/ezbeq/ui ./ezbeq/ui/

RUN pip install --no-cache-dir .

# ── Production: clean runtime image ──────────────────────────────────────────
FROM base AS production

COPY --from=builder /opt/venv /opt/venv
ENV PATH="/opt/venv/bin:${PATH}"

RUN groupadd -r ezbeq && useradd -r -g ezbeq ezbeq && \
    chown -R ezbeq:ezbeq /app
USER ezbeq

# Health check. Reads EZBEQ_PORT from the container env so users with a
# non-default `port:` in ezbeq.yml get a working healthcheck without a
# Dockerfile rebuild. Set EZBEQ_PORT in compose's `environment:` block.
HEALTHCHECK --interval=10s --timeout=2s --start-period=20s \
    CMD curl -f -s --show-error "http://localhost:${EZBEQ_PORT:-8080}/api/1/version" || exit 1

CMD ["ezbeq"]

# ── Dev: local source build with Poetry ──────────────────────────────────────
# Build context is the repo root (set by docker-compose.dev.yaml).
# Node/Yarn are NOT needed here; the compiled UI is copied from ui-builder.
FROM base AS dev

# Install build tools needed for Poetry / native Python extensions
# (apt cache mounted so .deb downloads persist across rebuilds).
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    rm -f /etc/apt/apt.conf.d/docker-clean && \
    apt-get update && apt-get install --no-install-recommends -y \
    build-essential \
    python3-venv

# Install Poetry; cache pip downloads across builds
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install poetry

# Keep the virtualenv inside the project directory (/app/.venv) so it ends up
# in the image layer.  Without this, Poetry stores the venv under its cache dir
# (~/.cache/pypoetry/virtualenvs/) which is a cache mount, not persisted in
# the image, so the container starts with no installed packages.
RUN poetry config virtualenvs.in-project true

# Install Python deps (without the app itself yet, for better layer caching:
# this step only reruns when pyproject.toml or poetry.lock changes).
COPY pyproject.toml poetry.lock ./
RUN --mount=type=cache,target=/root/.cache/pypoetry/cache \
    poetry install --no-root

# Copy the compiled UI from the ui-builder stage (a few MB, not node_modules).
# vite.config.js sets outDir: '../ezbeq/ui' relative to ui/, so output lands
# at /app/ezbeq/ui inside the ui-builder container.
COPY --from=ui-builder /app/ezbeq/ui ./ezbeq/ui/

COPY . .
RUN --mount=type=cache,target=/root/.cache/pypoetry/cache \
    poetry install

CMD ["poetry", "run", "ezbeq"]
