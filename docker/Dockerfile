# syntax=docker/dockerfile:1
#
# Multi-stage build with four targets:
#
#   base        – shared OS packages + minidsp binary (not used directly)
#   builder     – production Python venv with ezbeq installed from PyPI
#   production  – default; clean runtime image with non-root user.
#                 Built by CI / docker buildx bake.
#   dev         – local development; Poetry + Node/Yarn, builds React UI.
#                 Used by bin/run-local via docker-compose.dev.yaml.

# ── Base: runtime OS + minidsp binary ────────────────────────────────────────
# Shared by both the production and dev build targets.
# python:3.13-slim-trixie — Debian 13 (stable), native Python 3.13, glibc 2.40
FROM python:3.13-slim-trixie AS base

# Set the environment variable for ezbeq configuration
ENV EZBEQ_CONFIG_HOME=/config

# Install runtime-only dependencies required by the application
RUN apt-get update && apt-get install --no-install-recommends -y \
    # Utility for downloading files
    curl \
    # SQLite database command-line tool
    sqlite3 \
    # minidsp is dynamically linked against libusb-1.0.so.0 and expects it to be
    # available in the environment, even if USB communication isn't being used
    libusb-1.0-0 && \
    rm -rf /var/lib/apt/lists/*

# Dynamically download and install the correct minidsp binary based on architecture
RUN ARCH=$(dpkg --print-architecture) && \
    case "$ARCH" in \
      amd64) ARCH="x86_64-unknown-linux-gnu" ;; \
      arm64) ARCH="aarch64-unknown-linux-gnu" ;; \
      armhf) ARCH="arm-linux-gnueabihf-rpi" ;; \
      *) echo "Unsupported architecture: $ARCH"; exit 1 ;; \
    esac && \
    URL="https://github.com/mrene/minidsp-rs/releases/latest/download/minidsp.${ARCH}.tar.gz" && \
    curl -L -o minidsp.${ARCH}.tar.gz "$URL" && \
    tar -xzf minidsp.${ARCH}.tar.gz && \
    mv minidsp /usr/local/bin/minidsp && \
    chmod +x /usr/local/bin/minidsp && \
    rm minidsp.${ARCH}.tar.gz

# Set the working directory inside the container
WORKDIR /app

# Define a volume for configuration data
VOLUME ["/config"]

# Git build info - passed via --build-arg in CI, surfaced in the UI footer.
# Defaults to empty so local builds without args still work.
ARG GIT_BRANCH=""
ARG GIT_SHA=""
ENV GIT_BRANCH=${GIT_BRANCH}
ENV GIT_SHA=${GIT_SHA}

# Document the default port. The actual port is set via 'port:' in ezbeq.yml
# and must be reflected in the compose file's ports: and healthcheck: entries.
EXPOSE 8080

# ── Production builder: install Python deps into a venv ──────────────────────
# Separate stage so build tools don't end up in the final runtime image.
FROM base AS builder

# Install dependencies required for building the application
RUN apt-get update && apt-get install --no-install-recommends -y \
    # Tools for compiling and building packages
    build-essential \
    # Python virtual environment creation tool
    python3-venv && \
    python -m pip install --upgrade pip && \
    rm -rf /var/lib/apt/lists/*

# Create a Python virtual environment at /opt/venv
RUN python -m venv /opt/venv

# Add the virtual environment to the PATH
ENV PATH="/opt/venv/bin:${PATH}"

# Install ezbeq from PyPI.
# --pre allows pre-release versions (ezbeq's release cadence includes alphas).
RUN pip install --pre --no-cache-dir ezbeq

# ── Production: clean runtime image ──────────────────────────────────────────
# A clean, lightweight image for running the application.
FROM base AS production

# Copy the Python virtual environment prepared in the build stage.
# This brings only the necessary runtime dependencies, without build tools.
COPY --from=builder /opt/venv /opt/venv

# Add the virtual environment to the PATH
ENV PATH="/opt/venv/bin:${PATH}"

# Create a non-root user and group for running the application
RUN groupadd -r ezbeq && useradd -r -g ezbeq ezbeq && \
    chown -R ezbeq:ezbeq /app

# Switch to the non-root user
USER ezbeq

# Health check
HEALTHCHECK --interval=10s --timeout=2s \
    CMD curl -f -s --show-error http://localhost:8080/api/1/version || exit 1

# Define the default command to run the ezbeq application
CMD ["ezbeq"]

# ── UI builder: compile React app ────────────────────────────────────────────
# Isolated Node stage so that node_modules never enters the dev image layer.
# Only the Vite dist output (~a few MB) is copied across; the 200MB+
# node_modules is discarded after this stage completes.
FROM node:22-slim AS ui-builder

WORKDIR /app/ui

# Copy ui source — .yarnrc.yml references .yarn/releases/yarn-4.12.0.cjs so
# the whole ui/ tree is needed.  node_modules and .yarn/cache are excluded
# via .dockerignore so the build context stays small.
COPY ui/ .

# Mount the yarn cache at the location Yarn 4 uses when enableGlobalCache is
# false (i.e. the project-local .yarn/cache dir).  This persists the package
# zip archives across builds so yarn install is fast on cache hits.
RUN --mount=type=cache,target=/app/ui/.yarn/cache \
    yarn install --silent && yarn build

# ── Dev: local source build with Poetry ──────────────────────────────────────
# Build context is the repo root (set by docker-compose.dev.yaml).
# Node/Yarn are NOT needed here — the compiled UI is copied from ui-builder.
FROM base AS dev

# Install build tools needed for Poetry / native Python extensions
RUN apt-get update && apt-get install --no-install-recommends -y \
    build-essential \
    python3-venv && \
    rm -rf /var/lib/apt/lists/*

# Install Poetry; cache pip downloads across builds
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install poetry

# Keep the virtualenv inside the project directory (/app/.venv) so it ends up
# in the image layer.  Without this, Poetry stores the venv under its cache dir
# (~/.cache/pypoetry/virtualenvs/) which is a cache mount — not persisted in
# the image — so the container starts with no installed packages.
RUN poetry config virtualenvs.in-project true

# Install Python deps (without the app itself yet — better layer caching,
# this step only reruns when pyproject.toml or poetry.lock changes).
COPY pyproject.toml poetry.lock ./
RUN --mount=type=cache,target=/root/.cache/pypoetry/cache \
    poetry install --no-root

# Copy the compiled UI from the ui-builder stage (a few MB, not node_modules).
# vite.config.js sets outDir: '../ezbeq/ui' relative to ui/, so output lands
# at /app/ezbeq/ui inside the ui-builder container.
COPY --from=ui-builder /app/ezbeq/ui ./ezbeq/ui/

# Copy the full source and install the app entry point
COPY . .
RUN --mount=type=cache,target=/root/.cache/pypoetry/cache \
    poetry install

# Define the default command to run the ezbeq application via Poetry
CMD ["poetry", "run", "ezbeq"]
