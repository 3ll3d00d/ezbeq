#!/usr/bin/env bash
# Shared helpers for scripts under docker/scripts. Source from another script:
#     source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"
#
# Exports DOCKER_DIR, REPO_ROOT.
# Provides ezbeq::* functions for help, env loading, config + git + owner.

# Derive paths from this file's location, independent of caller's CWD.
_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOCKER_DIR="$(cd "$_LIB_DIR/.." && pwd)"
REPO_ROOT="$(cd "$DOCKER_DIR/.." && pwd)"

# Caller script path captured at source time so print_help survives later cd's.
_CALLER_PATH="$(cd "$(dirname "${BASH_SOURCE[1]}")" && pwd)/$(basename "${BASH_SOURCE[1]}")"

# Print the caller's top comment block as usage. Stops at the first line that
# isn't a `#` comment, so help output stays in sync as the header changes.
ezbeq::print_help() {
    awk 'NR == 1 { next } /^#/ { sub(/^# ?/, ""); print; next } { exit }' "$_CALLER_PATH"
}

# Source docker/.env into the environment if present.
ezbeq::load_env() {
    local env_file="$DOCKER_DIR/.env"
    [[ -f "$env_file" ]] || return 0
    set -o allexport
    # shellcheck disable=SC1090
    source "$env_file"
    set +o allexport
}

# Resolve config path, auto-detect EZBEQ_PORT from its `port:` key if unset,
# export EZBEQ_CONFIG_HOME + EZBEQ_PORT for docker-compose interpolation.
#
# Resolution order: explicit EZBEQ_CONFIG > EZBEQ_CONFIG_HOME/ezbeq.yml > $HOME/.ezbeq/ezbeq.yml
# A user-set EZBEQ_CONFIG_HOME (the public knob documented in .env.example) is
# preserved and used for the compose volume mount; we only auto-derive it from
# EZBEQ_CONFIG when neither is explicitly set.
ezbeq::resolve_config() {
    if [[ -z "${EZBEQ_CONFIG:-}" ]]; then
        if [[ -n "${EZBEQ_CONFIG_HOME:-}" ]]; then
            EZBEQ_CONFIG="$EZBEQ_CONFIG_HOME/ezbeq.yml"
        else
            EZBEQ_CONFIG="$HOME/.ezbeq/ezbeq.yml"
        fi
    fi
    [[ -f "$EZBEQ_CONFIG" ]] || {
        echo "Error: ezbeq.yml not found at $EZBEQ_CONFIG" >&2
        echo "       Create it, or set EZBEQ_CONFIG_HOME in docker/.env." >&2
        exit 1
    }
    if [[ -z "${EZBEQ_PORT:-}" ]]; then
        EZBEQ_PORT=$(awk -F: '/^[[:space:]]*port[[:space:]]*:/ {gsub(/[ \t\r#].*/,"",$2); gsub(/[ \t\r]/,"",$2); print $2; exit}' "$EZBEQ_CONFIG")
        EZBEQ_PORT="${EZBEQ_PORT:-8080}"
    fi
    export EZBEQ_CONFIG_HOME="${EZBEQ_CONFIG_HOME:-$(dirname "$EZBEQ_CONFIG")}"
    export EZBEQ_PORT
}

# Validate an OCI image tag: non-empty and no slashes.
ezbeq::validate_tag() {
    local tag="$1"
    [[ -n "$tag" ]] || { echo "Error: image tag is empty." >&2; exit 2; }
    [[ "$tag" != */* ]] || {
        echo "Error: image tag '$tag' contains '/' which is not valid in an OCI tag." >&2
        echo "       Try '${tag//\//-}' instead." >&2
        exit 2
    }
}

# Populate GIT_BRANCH and GIT_SHA. Silent empty strings on failure.
ezbeq::resolve_git_info() {
    GIT_BRANCH=$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
    GIT_SHA=$(git -C "$REPO_ROOT" rev-parse --short HEAD 2>/dev/null || echo "")
}

# Resolve GHCR owner: OWNER env wins, else parse `origin` remote.
ezbeq::resolve_owner() {
    [[ -n "${OWNER:-}" ]] && return 0
    local origin
    origin=$(git -C "$REPO_ROOT" remote get-url origin 2>/dev/null || true)
    OWNER=$(echo "$origin" | sed -nE 's#.*[:/]([^/]+)/ezbeq(\.git)?$#\1#p')
    [[ -n "$OWNER" ]] || {
        echo "Error: could not determine GHCR owner from origin remote." >&2
        echo "       origin url: ${origin:-<unset>}" >&2
        echo "       Set OWNER=<github-user-or-org> and rerun." >&2
        exit 1
    }
}
