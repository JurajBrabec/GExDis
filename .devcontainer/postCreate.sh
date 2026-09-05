#!/usr/bin/env bash
# gexdis devcontainer post-create hook.
# Runs once after the container is created, before the workspace is handed to VS Code.
#
# Session notes/repo facts: this repo commits a bun.lock, so we always install
# frozen to guarantee the dependency tree matches the production image build.
#
# If you ever alter host bind-mount ownership, keep ./app/* writable by the
# `bun` user (see the .dockerfile runtime-dirs stage).
set -euo pipefail

echo "[postCreate] installing dependencies (frozen lockfile)…"
bun install --frozen-lockfile

echo "[postCreate] verifying unrar.wasm asset is present…"
test -f "node_modules/node-unrar-js/dist/js/unrar.wasm" || {
  echo "ERROR: node-unrar-js wasm asset missing – aborting." >&2
  exit 1
}

echo "[postCreate] typecheck (bun run lint)…"
bun run lint

echo "[postCreate] running test suite…"
bun test

echo "[postCreate] done."
