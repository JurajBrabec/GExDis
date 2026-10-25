# AGENTS.md

GEXDIS: a Bun HTTP service that scrapes a release/link page, downloads matching files, unpacks archives, and copies results to target dirs. Spec: `PRD.md` (background only; code and config win).

## Commands

- Runtime is Bun 1.4 (not Node/npm). Install with `bun install --frozen-lockfile`.
- Run the server with `bun run dev` (watch mode, `src/main.ts`).
- Build the standalone binary with `bun run build` → `app/gexdis` (`app/gexdis.exe` on Windows). `bun run start` runs it.
- Full check order, as CI runs it: `bun run lint` → `bun test` → `bun run build`.
- `lint` is only `tsc --noEmit`. There is no ESLint or Prettier config in the repo.
- Single test file: `bun test tests/rules.test.ts`. Single test by name: `bun test -t "<name>"`.

## Architecture

- `src/main.ts` is the entrypoint and has top-level side effects: it loads config and rules, then calls `Bun.serve` on import. Do not import it from non-test code.
- Tests import it with a unique query suffix (`await import("../src/main.ts?tag")`) to get a fresh module and server. Tests set `PORT: "0"` and temp `APP_DIR`/`RULES_FILE` via `process.env`, and restore them afterward.
- Routes: `GET /process?url=…` or `?org=…&repo=…&tag=…` (returns 202 with a job id; `dry_run=true` plans only), `GET /status/:id`, `GET /editor`.
- Rules API, all under `/api/rules` and protected by `RULES_TOKEN` when set (accepted via `x-rules-token`, `Authorization: Bearer`, or `?token=`):
  - `GET|PUT /api/rules` raw YAML. `PUT` validates, writes `rules.yml.bak` with the previous file, then replaces `rules.yml`.
  - `POST /api/rules/validate` checks raw YAML without writing.
  - `GET /api/rules/backup` → `{available}`; `POST /api/rules/undo` swaps `rules.yml` with the backup (undoing twice returns to the newer version).
  - `GET /api/rules/github` lists GitHub rules as JSON. `POST /api/rules/github`, `PUT|DELETE /api/rules/github/:name` edit one rule and keep comments and key order (via `src/rules-store.ts`). Add `?preview=true` to get the resulting YAML back without writing.
- `src/variants.ts` holds the two variants (`github`, `peeplink`), `defaultRules`, and `allowedHosts`. A URL must match exactly one variant. Adding a new source host means editing `allowedHosts` there.
- `src/rules.ts` parses and validates rules. Patterns are case-insensitive regexes. Named groups become `{NAME}` placeholders. `{SEMVER}` is built in. Copy rules use the form `pattern:target`.
- Placeholders work in every rule field: `url`, `tag`, `org`, `repo`, `get`, `unpack`, `remove`, `copy`, and `set`. `url`, `tag`, `org`, and `repo` are expanded at load time, so they can use built-ins (`{SEMVER}`) and set variables, but not URL captures like `{TAG}`. An unknown placeholder there is a load error.
- `src/config.ts` is the env-var source of truth. Default `APP_DIR` is `${cwd}/app`, so run commands from the repo root.

## Runtime data and config

- `app/config/rules.yml` is the live ruleset. It is gitignored and machine-local. If it is missing, `defaultRules` from `src/variants.ts` apply.
- `app/download`, `app/release`, `app/bin`, `app/tmp`, `app/log`, `app/gexdis.exe` are runtime output and gitignored. Do not commit them.
- `app/log` gets the log files. `LOG_LEVEL` controls console output.

## Docker

- `Dockerfile` is the production image. It compiles `src/main.ts` with `bun build --compile`. It also copies `node-unrar-js`'s `unrar.wasm` into the runtime image explicitly; keep that COPY line when changing that dependency.
- `.dockerfile` is the devcontainer image, not production. Compose service `gexdis-dev` uses it, runs `bun run dev`, and bind-mounts the repo at `/workspace`. Compose service `gexdis` uses `Dockerfile`. Each service uses its own file, so do not change one to fix the other.
- CI (`.github/workflows/ci.yml`) runs checks on push/PR to `main`. It builds and pushes Docker only after checks pass, and only on push to `main`.

## Conventions

- `src/` mixes quote styles. Match the file you are editing.
