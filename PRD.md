# GExDis product requirements

GExDis (Get, Extract, Distribute) is a self-hosted HTTP service that selects release assets or file links using configurable rules, downloads matching files, optionally extracts archives, and copies selected results to configured destinations.

This document describes the current product contract. Source code and runtime configuration are authoritative where implementation details differ. Operator setup and API examples are in [`README.md`](README.md).

## Goals

- Automate repeatable downloads from supported release and link pages.
- Let operators express selection, extraction, cleanup, and copy behavior in YAML rules.
- Provide synchronous dry-run planning and asynchronous job status for real processing.
- Offer both a browser-based rules editor and raw YAML access.
- Keep downloaded and extracted data in bounded temporary/runtime locations, with explicit network and filesystem safeguards.

## Supported sources

The current variants are implemented in `src/variants.ts`:

- **GitHub releases** — release pages/assets hosted by `github.com` and allowed GitHub asset hosts.
- **Peeplink** — `peeplink.in` pages whose matching links may use `rg.to` or `rapidgator.net`.

The HTTP client only follows HTTP(S) URLs on the host allowlist. The current allowlist is `github.com`, `githubusercontent.com`, `peeplink.in`, `rg.to`, and `rapidgator.net`, including their subdomains. Additions to supported hosts require an intentional allowlist change and tests. A page URL must select exactly one variant; the first matching rule within that variant wins.

## Processing flow

1. Validate the submitted source URL and select one matching variant/rule.
2. Fetch the page, follow only allowed redirects, and extract anchor links.
3. Match links against `get` rules. Each matching link is downloaded to `TMP_DIR`; its clean filename is available as `{DOWNLOADED}`.
4. Apply configured `remove` rules before copying new output. Remove rules are restricted to one literal direct subdirectory under `/app`.
5. Match archives against `unpack` rules and extract supported ZIP, TAR, TGZ/TAR.GZ, and RAR files. A sole top-level folder may be flattened; otherwise the archive gets a containing directory. Nested archives are processed recursively.
6. Apply `copy` rules to downloaded and extracted files/folders. `/app/...` destinations resolve beneath `APP_DIR`; other targets are interpreted as configured and must be treated as privileged filesystem paths.
7. Remove per-file temporary download/extraction artifacts, record actions, and update the job status.

Processing is sequential within one job. The service accepts at most four active jobs at once. The `/process` endpoint remains a GET endpoint for compatibility; callers should supply a token when configured and avoid triggering it via browser navigation, prefetch, or retries.

### Dry-run behavior

- `GET /process?...&dry_run=true` fetches and inspects the source page, returning a plan without downloading assets or changing target files.
- `DRY_RUN=true` also prevents real processing. The service returns its plan with a disabled status rather than creating a job.

## Rules

Rules live in `app/config/rules.yml` (or `RULES_FILE`). If the file is absent, `defaultRules` from `src/variants.ts` are written and used. The tracked `app/config/default.rules.yml` is an example/reference file, not the runtime fallback.

The YAML document has a top-level `variants` mapping. A variant may contain one rule or an ordered list of rules. GitHub structured editing uses `name` and `repo: owner/name`; custom rules may specify a `url` regex instead. Common fields:

| Field | Purpose |
| --- | --- |
| `name` | Stable display/API name for a GitHub rule. |
| `url` | Case-insensitive regular expression matching the source URL. |
| `repo`, `org`, `tag` | GitHub rule inputs used to construct a source URL pattern when `url` is omitted. |
| `set` | Named string variables, resolved in declaration order. |
| `get` | Regex patterns; a link is downloaded if a pattern matches. Named groups become placeholders. |
| `unpack` | Patterns selecting archives for extraction. |
| `remove` | Regex patterns over virtual `/app/...` paths, scoped to one literal `/app/{subdir}/`. |
| `copy` | `source-pattern:target` entries for matching downloaded/extracted paths. The first colon separates source and target. |

Regexes are case-insensitive. Named capture groups such as `(?<ASSET>...)` are available as `{ASSET}`. Built-ins include `{SEMVER}`, `{DOWNLOADED}`, and `{UNPACKED}`. URL-derived captures such as `{TAG}` are not available while static `url`, `org`, `repo`, and `tag` fields are expanded at load time. Unknown static placeholders and invalid regex syntax are rejected.

Example:

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
      copy:
        - '^{UNPACKED}/.+\.exe$:/app/bin'
        - '^{ZIP}$:/app/download'

  peeplink:
    - name: default
      url: '^https://peeplink\.in/(?<ID>.+)$'
      get:
        - '^https://rg\.to/.+'
        - '^https://rapidgator\.net/.+'
      unpack:
        - '^{DOWNLOADED}$'
      copy:
        - '^{UNPACKED}$:/app/release'
```

Structured GitHub rule edits preserve comments/order where possible. Raw YAML editing supports the complete rules document.

## HTTP interface

| Method and path | Behavior |
| --- | --- |
| `GET /process?url=...` | Validate a source URL and create a job (`202`). |
| `GET /process?org=...&repo=...[&tag=...]` | Construct a GitHub release URL; omitted tag defaults to `latest`. |
| `GET /status/:id` | Return job status, progress, and action results. Completed jobs are retained for 30 minutes. Inspect each action; an outer completed job can contain failed actions. |
| `GET /editor` | Serve the static rules editor. |
| `GET|PUT /api/rules` | Read or validate-and-replace raw YAML. Replacements retain one swappable backup. |
| `POST /api/rules/validate` | Validate YAML without writing it. |
| `GET /api/rules/backup`, `POST /api/rules/undo` | Check/restore the single backup; repeated undo swaps the two versions. |
| `GET|POST /api/rules/github` | List or add structured GitHub rules. |
| `PUT|DELETE /api/rules/github/:name` | Update or remove one structured GitHub rule. |
| `GET /api/github/assets?repo=owner/name[&tag=...]` | List a GitHub release's asset names for the editor. |

Structured GitHub mutations accept `?preview=true` to return the resulting YAML without writing it. Rules changes are serialized to prevent concurrent edits from overwriting one another. Error responses are JSON.

## Security and resource limits

- Default `HOST` is `localhost`. Binding to a non-loopback host requires `RULES_TOKEN` at startup.
- When set, the token protects the rules API, asset picker endpoint, processing endpoint, and job status endpoint. Send it as `x-rules-token` or `Authorization: Bearer ...`; query-string tokens are not accepted.
- `/editor` serves static HTML; its API requests use the token entered in the editor. A configured reverse proxy must not expose a tokenless loopback instance without adding its own access control.
- `/app/...` copy targets are contained under `APP_DIR`; remove scopes and all archive entry paths are checked. Non-`/app/` copy targets are intentionally left as configured, so rules are privileged filesystem configuration.
- Upstream requests time out after 30 seconds; redirects are limited to ten. Release-page bodies are capped at 10 MiB and downloaded files at 512 MiB.
- Archives are capped at 512 MiB compressed input, 20,000 entries, and 1 GiB expanded output.
- Limits are implementation constants, not environment settings. TAR/RAR libraries may use transient memory while decoding before output limits are applied.
- GExDis does not verify release signatures or checksums. Operators should only use trusted sources/rules and should validate downloaded artifacts according to their deployment's supply-chain requirements.

## Runtime and operations

Runtime files default beneath `APP_DIR` (normally `<working-directory>/app`): `config/rules.yml`, `tmp`, and `log`. `/app/...` copy paths map into `APP_DIR`. `DOWNLOAD_DIR`, `RELEASE_DIR`, and `BIN_DIR` are legacy config values and currently do not determine processor destinations; configure destinations in `copy` rules.

Logs are daily `gexdis-YYYY-MM-DD.log` files under `LOG_DIR`. `LOG_LEVEL` filters logged levels; `LOG_RETENTION_DAYS` defaults to 30. Temporary per-file artifacts are removed after processing.

Production uses `Dockerfile` and a compiled Bun executable. Development uses `.dockerfile` or the VS Code devcontainer. Compose publishes port 3000 for both services, so run one service at a time unless you change a host port. Compose and the devcontainer bind to `0.0.0.0` and therefore require a `RULES_TOKEN`.

## Acceptance criteria

- Invalid source URLs, unsupported hosts, and unmatched variants are rejected before asset downloads begin.
- Dry-run plans the same matching work without asset downloads or file changes.
- Valid jobs report progress/actions and clean temporary files.
- Rule writes validate before replacing the live file and preserve a restorable backup.
- Remote binds fail closed without an API token; path and archive writes remain within their intended roots.
- CI runs lint, tests, and build for changes targeting `main`; Docker publishing occurs only after checks pass on a push to `main`.
