FROM oven/bun:1.4 AS build

WORKDIR /workspace
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY src ./src
COPY tests ./tests
COPY tsconfig.json ./
RUN bun run build

FROM oven/bun:1.4-slim

WORKDIR /app
COPY --from=build /workspace/app/gexdis /app/gexdis
COPY app/config /app/config
COPY --from=build /workspace/node_modules/node-unrar-js/dist/js/unrar.wasm /app/node_modules/node-unrar-js/dist/js/unrar.wasm
RUN mkdir -p /app/download /app/log /app/release /app/bin /app/tmp \
    && mkdir -p /app/node_modules/node-unrar-js/dist/js \
    && chown -R bun:bun /app

USER bun
EXPOSE 3000
ENTRYPOINT ["/app/gexdis"]
