# syntax=docker/dockerfile:1
# -----------------------------------------------------------------------------
# gexdis — development container image
#
# Purpose: provide an interactive development environment identical to the Linux
# runtime used in production (oven/bun:1.4-slim) so it can be driven from the
# VS Code Dev Containers extension on any host OS (incl. Windows).
#
# Differences vs. the production Dockerfile live in the same repo:
#   - production: source is COPYed in and compiled to a standalone binary.
#   - this file:  nothing is COPYed; the source tree is bind-mounted by the
#                 devcontainer/compose. node_modules is created on first boot
#                 via `bun install --frozen-lockfile` (postCreateCommand).
# -----------------------------------------------------------------------------

# Pin the exact minor the project targets (matches prod build stage oven/bun:1.4).
# Digest pinning below is optional; keep the tag readable for maintenance.
FROM oven/bun:1.4-debian AS base

# Keep in sync with the WORKDIR used by the production build stage so that
# relative node_modules lookups in src/archive.ts resolve identically.
WORKDIR /workspace

# Expose the same port as the runtime container.
EXPOSE 3000

# Run as the unprivileged bun user shipped by the image (harmonizes with the
# production runtime image which also runs as USER bun).
USER bun

# -----------------------------------------------------------------------------
# Stage: runtime-dirs
# Pre-create the directories the app writes to at runtime (mirroring the
# mkdir/chown block in the production Dockerfile). Because the host bind-mounts
# ./app/*, ownership shown here only matters for the volume mount root; the
# devcontainer post-create and compose handle per-directory permissions.
# -----------------------------------------------------------------------------
FROM base AS runtime-dirs
USER root
RUN mkdir -p /workspace/app/{config,download,log,release,bin,tmp} \
    && chown -R bun:bun /workspace/app
USER bun

# -----------------------------------------------------------------------------
# Stage: toolchain
# Global code-quality CLIs are layered on top of the runtime directories so the
# image pre-bakes editor tooling without touching the project's package.json
# or devDependencies (kept lean and identical to the production image).
# -----------------------------------------------------------------------------
FROM runtime-dirs AS toolchain
# Global installs write to bun's global bin dir which is owned by root; run as
# root to link the CLIs, then drop back to the unprivileged bun user.
USER root
# Pin major versions for reproducibility; non-frozen so no bun.lock needed here.
RUN bun add -g eslint@9 prettier@3 typescript@5 knip@5 \
    && bun pm ls --global
USER bun

# -----------------------------------------------------------------------------
# Stage: dev
# Final image. No dependency install / no COPY: the source tree is mounted and
# installed on first `docker compose run` / devcontainer start.
# -----------------------------------------------------------------------------
FROM toolchain AS dev
CMD ["bun", "run", "dev"]
