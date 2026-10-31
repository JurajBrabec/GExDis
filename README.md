# GExDis

GExDis (Get, Extract, Distribute) is a self-hosted Bun HTTP service for selecting release assets or page links, downloading matches, optionally unpacking archives, and copying results to configured destinations.

## What it does

1. Fetches a supported release/link page and extracts its anchor links.
2. Selects files with configurable, case-insensitive regular-expression rules.
3. Downloads matching files to a temporary directory.
4. Optionally extracts ZIP, TAR, TGZ/TAR.GZ, or RAR archives (including nested archives).
5. Removes matching older files and copies selected results to target paths.
6. Reports a job ID, progress, and per-action results for real processing; supports dry-run planning.

Supported variants and the upstream host allowlist are defined in [`src/variants.ts`](src/variants.ts). The allowlisted hostnames are `github.com`, `githubusercontent.com`, `peeplink.in`, `rg.to`, and `rapidgator.net` (including subdomains). A source URL must select one variant; within it, the first matching rule wins. The current product behavior is also summarized in [`PRD.md`](PRD.md).

## Requirements

- Bun **1.4** (Node.js/npm are not the supported runtime).
- Git for source checkout.
- Optional: Docker Compose for containerized production/development, or VS Code Dev Containers for the devcontainer workflow.

## Run locally

```sh
git clone https://github.com/JurajBrabec/GExDis.git
cd GExDis
bun install --frozen-lockfile
bun run dev
```

The default server listens on `http://localhost:3000`. Because the default bind is loopback, `RULES_TOKEN` is optional for this local-only setup. Open the rules editor at <http://localhost:3000/editor>.

If `app/config/rules.yml` does not exist, the service writes the fallback rules from `src/variants.ts`. That live rules file and runtime output are gitignored. The tracked `app/config/default.rules.yml` is **not** loaded automatically.

To test a source without downloading assets, pass `dry_run=true`:

```text
http://localhost:3000/process?url=https%3A%2F%2Fgithub.com%2Fowner%2Frepo%2Freleases%2Ftag%2Fv1.2.3&dry_run=true
```

The default coded GitHub rule is for tagged release URLs; configure a GitHub rule in the editor or YAML for the repositories/tags you use. The peeplink fallback matches `peeplink.in` pages and links on the allowed file hosts.

## Build and run the standalone executable

```sh
bun run build
bun run start
```

The build produces `app/gexdis` (or `app/gexdis.exe` on Windows). The executable is ignored by Git. Run commands from the repository root so default `APP_DIR` and relative runtime paths are predictable.

## Docker Compose

Both Compose services bind to `0.0.0.0`, so **set a secret `RULES_TOKEN` before starting either service**. Keep the token out of tracked files.

PowerShell:

```powershell
$env:RULES_TOKEN = [guid]::NewGuid().ToString("N") + [guid]::NewGuid().ToString("N")
docker compose up --build gexdis-dev
```

Linux/macOS:

```sh
export RULES_TOKEN="$(openssl rand -hex 32)"
docker compose up --build gexdis
```

Use the development Compose service instead with `docker compose up --build gexdis-dev`. The devcontainer also reads `RULES_TOKEN` from the environment of the process that launches VS Code/Dev Containers; set it before opening the repository.

The `gexdis` service builds the production [`Dockerfile`](Dockerfile), runs the compiled binary, and mounts `app/config`, `app/tmp`, `app/download`, `app/release`, `app/bin`, and `app/log`. The `gexdis-dev` service uses [`.dockerfile`](.dockerfile), runs `bun run dev`, and bind-mounts the checkout at `/workspace`. Both publish host port 3000; run only one at a time unless you change a host-port mapping. Production Compose uses `${UID}:${GID}` as the container user; set those to an account that can access the mounted directories. On Windows, the dev service avoids this UID/GID override.

## GitHub userscript

[`user-script/gexdis-github.js`](user-script/gexdis-github.js) adds a GExDis button to GitHub release pages. It checks matching assets with a dry run, starts a download job, and polls its status. When the server requires authentication, click the **🔑** button, enter the API token, and retry. The token is saved in userscript-manager storage and sent in the `x-rules-token` header for the dry-run, process, and status requests; it is never added to the URL. The userscript currently targets `http://nas.home:10203`; if you change `API_BASE`, update the matching `@connect` metadata too.

## Security model

- `HOST` defaults to `localhost`. If `HOST` is anything other than `localhost`, `127.0.0.1`, or `::1`, startup requires `RULES_TOKEN`.
- When configured, the token protects `/process`, `/status/:id`, `/api/rules`, and `/api/github/assets`. Send it in `x-rules-token` or `Authorization: Bearer ...`. Tokens in query strings are not accepted.
- `/editor` serves static HTML. Enter the token in the editor's Rules token field to use its API. The editor saves it in this browser's `localStorage`, sends it in a request header, and reconnects automatically on later visits. Clear the field and connect to remove the saved token.
- A local loopback bind without a token is convenient for development, not a safe setting to expose through a reverse proxy or other network forwarding. Configure a token whenever access could be remote.
- `/app/...` copy targets resolve under `APP_DIR`, and remove rules are scoped to one literal direct child directory under `/app`. Non-`/app/` copy targets are used as configured, so rule files and rule-edit credentials are privileged.
- GExDis downloads files but does not validate release signatures or checksums. Configure trusted sources and add artifact verification appropriate to your deployment.

## HTTP API

All API responses use JSON except raw YAML from `GET /api/rules` and the HTML page at `/editor`. If a token is configured, include it in a header on every protected request.

### Process a release/link page

The `GET /process` endpoint accepts either a URL or GitHub `org` and `repo` parameters. `tag` is optional and defaults to `latest`; do not combine `url` with `org`/`repo`.

```sh
curl --get http://localhost:3000/process \
  -H "x-rules-token: $RULES_TOKEN" \
  --data-urlencode "url=https://github.com/owner/repo/releases/tag/v1.2.3"
```

A valid request with actionable links returns `202 Accepted` with a job ID and relative `statusUrl`:

```json
{
  "id": "…",
  "status": "running",
  "progress": { "phase": "queued", "current": 0, "total": 0, "message": "Job queued" },
  "statusUrl": "/status/…"
}
```

Poll the status endpoint with the same token:

```sh
curl http://localhost:3000/status/JOB_ID \
  -H "x-rules-token: $RULES_TOKEN"
```

The status object contains `running`, `completed`, or `failed`, progress, and an `actions` array. Inspect individual action statuses: the job may be `completed` even when a particular file action failed. Terminal jobs are kept for 30 minutes.

Add `dry_run=true` to plan without downloading assets or changing destination files:

```sh
curl --get http://localhost:3000/process \
  -H "x-rules-token: $RULES_TOKEN" \
  --data-urlencode "url=https://github.com/owner/repo/releases/tag/v1.2.3" \
  --data-urlencode "dry_run=true"
```

The plan includes matching asset URLs and captures. Setting `DRY_RUN=true` in the environment also disables real downloads; in that mode the service returns the plan with a disabled status.

### Rules endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/rules` | Read the live YAML as raw text. |
| `PUT` | `/api/rules` | Validate and replace the whole YAML file; keeps the previous version as the single backup. |
| `POST` | `/api/rules/validate` | Validate submitted YAML without writing. |
| `GET` | `/api/rules/backup` | Return `{ "available": boolean }`. |
| `POST` | `/api/rules/undo` | Swap live rules and backup. |
| `GET` | `/api/rules/github` | List structured GitHub rules as JSON. |
| `POST` | `/api/rules/github` | Add a structured GitHub rule. |
| `PUT` | `/api/rules/github/:name` | Update a structured GitHub rule. |
| `DELETE` | `/api/rules/github/:name` | Delete a structured GitHub rule. |
| `GET` | `/api/github/assets?repo=owner/name[&tag=...]` | List a release's downloadable assets for the editor. |

Structured GitHub add/update/delete operations accept `?preview=true` and return the proposed YAML without writing it. Raw YAML is the way to edit peeplink rules and fields not supported by the structured GitHub editor. Rule mutations are serialized. `POST /api/rules/undo` swaps the two versions, so calling it twice restores the newer version.

## Rules and destinations

Rules are YAML under a top-level `variants` mapping. Each variant can contain one rule or an ordered list. If the live file is missing, `defaultRules` in `src/variants.ts` are written to `app/config/rules.yml`.

| Field | Meaning |
| --- | --- |
| `name` | GitHub rule name used by the editor and structured API. |
| `url` | Case-insensitive regex for a source page. |
| `repo` | GitHub repository in `owner/name` form; generates the source URL regex when `url` is omitted. |
| `tag` | Optional GitHub tag regex/value; defaults to `latest` when constructing a repository rule. |
| `set` | Reusable string variables resolved in declaration order. |
| `get` | Regex list used to select page links for download. Named groups are captured as placeholders. |
| `unpack` | Regex list selecting downloaded archive names for extraction. |
| `remove` | Regex list matching older virtual `/app/...` paths before copying. The first path segment after `/app/` must be a literal direct child directory. |
| `copy` | `source-regex:target` list for downloaded or extracted files/folders. |

Regex matching is case-insensitive. Named groups such as `(?<ASSET>...)` are exposed as `{ASSET}`. Built-ins include `{SEMVER}`, `{DOWNLOADED}`, and `{UNPACKED}`. Set variables can refer to earlier variables and captures. Static `url`, `tag`, `org`, and `repo` values are expanded when rules load; they cannot use URL captures such as `{TAG}`. Invalid regexes and unresolved static placeholders are rejected.

Example GitHub rule:

```yaml
variants:
  github:
    - name: acme-tool
      repo: acme/tool
      tag: v{SEMVER}
      get:
        - '(?<ZIP>tool-[^/]+\.zip)$'
      unpack:
        - '^{ZIP}$'
      remove:
        - '^/app/bin/acme-tool-old\.exe$'
      copy:
        - '^{UNPACKED}/.+\.exe$:/app/bin'
        - '^{ZIP}$:/app/download'
```

For `copy` rules, `/app/...` maps to a path beneath `APP_DIR`; for example `/app/bin` uses `<APP_DIR>/bin`. A target without a filename is treated as a destination directory. A target filename with an extension can be used to rename a copied file. Other absolute or relative targets are passed through as configured and are not restricted to `APP_DIR`.

## Configuration

Configuration is read from environment variables by `src/config.ts`:

| Variable | Default | Description |
| --- | --- | --- |
| `HOST` | `localhost` | Bind address. Non-loopback values require `RULES_TOKEN`. |
| `PORT` | `3000` | HTTP port. |
| `APP_DIR` | `<cwd>/app` (`/app` if cwd is `/app`) | Runtime root; `/app/...` copy targets are mapped under it. |
| `CONFIG_DIR` | `${APP_DIR}/config` | Directory used to derive the default rules path. |
| `RULES_FILE` | `${CONFIG_DIR}/rules.yml` | Live rules file. |
| `TMP_DIR` | `${APP_DIR}/tmp` | Temporary downloads and extraction directories. |
| `LOG_DIR` | `${APP_DIR}/log` | Daily log output. |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, or `error`; filters file and console logs. Invalid values fall back to `info`. |
| `LOG_RETENTION_DAYS` | `30` | Age threshold for daily log cleanup. |
| `IDLE_TIMEOUT_SECONDS` | `60` | Bun server idle timeout, clamped to 0–255; `0` disables it. |
| `DRY_RUN` | `false` | Truthy values `1`, `true`, `yes`, or `on` disable real downloads. |
| `RULES_TOKEN` | unset | Required for non-loopback binds; when set, protects the listed APIs and process/status endpoints. |

`DOWNLOAD_DIR`, `RELEASE_DIR`, and `BIN_DIR` are legacy config values and currently do not control processor destinations. Configure destinations in the rules instead.

## Resource and storage limits

The current implementation uses fixed limits (not environment variables):

| Resource | Limit |
| --- | ---: |
| Upstream request timeout | 30 seconds |
| Redirects per request | 10 |
| Release page body | 10 MiB |
| Download / compressed archive | 512 MiB |
| Archive entries | 20,000 |
| Expanded archive output | 1 GiB |
| Active processing jobs | 4 |
| Terminal job retention | 30 minutes |

Runtime paths and generated files under `app/` are generally gitignored. Logs are written as `app/log/gexdis-YYYY-MM-DD.log` by default; temporary per-file artifacts are deleted after processing. TAR/RAR decoders may use transient memory while decoding, even though output size is bounded.

## Development and checks

```sh
bun install --frozen-lockfile
bun run dev
```

Run the same checks as CI:

```sh
bun run lint   # TypeScript check (tsc --noEmit)
bun test
bun run build
```

Useful focused test commands:

```sh
bun test tests/rules.test.ts
bun test -t "rejects"
```

`src/main.ts` starts the HTTP server on import. Tests that need a fresh server use a unique query suffix when importing it and isolate environment variables/runtime files in temporary directories. Do not import `src/main.ts` from ordinary non-test modules.

CI runs checks on pushes and pull requests targeting `main`. The Docker image is published only on pushes to `main`, after checks pass.
