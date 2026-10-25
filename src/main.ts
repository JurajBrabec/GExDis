import { loadConfig } from "./config.ts";
import { Logger } from "./logger.ts";
import { fetchAllowed } from "./http-client.ts";
import { processDownloads } from "./processor.ts";
import {
  loadRules,
  validateRulesText,
  expandPlaceholders,
  matchRule,
  applySetVariables,
} from "./rules.ts";
import { defaultRules, GitHubReleaseVariant, isAllowedUrl, selectVariant } from "./variants.ts";
import { JobStore } from "./jobs.ts";
import { editorPage } from "./editor-page.ts";
import {
  RuleEditError,
  addGithubRule,
  backupPathFor,
  deleteGithubRule,
  listGithubRules,
  parseGithubRuleInput,
  undoRulesFile,
  updateGithubRule,
  writeRulesFile,
} from "./rules-store.ts";

const config = loadConfig();
const logger = new Logger(
  config.logDir,
  config.logLevel,
  config.logRetentionDays,
);
const jobs = new JobStore();
await loadRules(config.rulesFile, defaultRules);
await logger.info("Rules loaded", { rulesFile: config.rulesFile });

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

async function handleStatus(id: string): Promise<Response> {
  const job = jobs.get(id);
  if (!job) {
    return json({ error: "Job not found" }, 404);
  }
  return json(job);
}

// Returns a collision-free message when the request is missing/mismatching the
// rules-edit token, or undefined when the request is authorized.
function rulesTokenError(request: Request): string | undefined {
  if (!config.rulesToken) return undefined;
  const presented =
    request.headers.get("x-rules-token") ??
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    new URL(request.url).searchParams.get("token");
  if (!presented) return "The rules API requires a token";
  if (presented !== config.rulesToken) return "The supplied token is invalid";
  return undefined;
}

function text(
  content: string,
  contentType = "text/plain; charset=utf-8",
): Response {
  return new Response(content, {
    headers: {
      "content-type": contentType,
      "cache-control": "no-store",
    },
  });
}

async function handleGetRules(): Promise<Response> {
  const file = Bun.file(config.rulesFile);
  if (!(await file.exists())) {
    return json({ error: "Rules file not found" }, 404);
  }
  return text(await file.text(), "text/yaml; charset=utf-8");
}

async function handlePutRules(request: Request): Promise<Response> {
  const body = await request.text();
  if (body.trim().length === 0) {
    return json({ error: "The request body must contain YAML" }, 400);
  }
  const fallback = defaultRules;
  try {
    validateRulesText(body, fallback);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid YAML";
    await logger.warn("Rules validation failed", { error: message });
    return json({ error: message }, 400);
  }
  await writeRulesFile(config.rulesFile, body);
  await logger.info("Rules updated", { rulesFile: config.rulesFile });
  return json({ ok: true });
}

async function readRulesText(): Promise<string> {
  const file = Bun.file(config.rulesFile);
  if (!(await file.exists())) {
    throw new RuleEditError("Rules file not found", 404);
  }
  return file.text();
}

async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new RuleEditError("The request body must be JSON", 400);
  }
}

// With ?preview=true the caller gets the resulting YAML back and nothing is written.
async function commitRulesChange(
  preview: boolean,
  next: string,
): Promise<Response> {
  if (preview) return json({ text: next });
  await writeRulesFile(config.rulesFile, next);
  await logger.info("Rules updated", { rulesFile: config.rulesFile });
  return json({ ok: true });
}

async function handleUndo(): Promise<Response> {
  if (!(await undoRulesFile(config.rulesFile))) {
    return json({ error: "No backup to restore" }, 404);
  }
  await logger.info("Rules restored from backup", {
    rulesFile: config.rulesFile,
  });
  return json({ ok: true });
}

async function handleValidate(request: Request): Promise<Response> {
  const body = await request.text();
  if (body.trim().length === 0) {
    return json({ error: "The request body must contain YAML" }, 400);
  }
  validateRulesText(body, defaultRules);
  return json({ ok: true });
}

// Authorizes the rules API, returning the rejection response when the token is wrong.
async function authorizeRules(request: Request): Promise<Response | undefined> {
  const tokenError = rulesTokenError(request);
  if (!tokenError) return undefined;
  await logger.warn("Rules API authorization failed", { error: tokenError });
  return json({ error: tokenError }, 401);
}

async function handleRulesApi(request: Request, url: URL): Promise<Response> {
  const denied = await authorizeRules(request);
  if (denied) return denied;
  const route = url.pathname.slice("/api/rules".length);
  const method = request.method;
  const preview = url.searchParams.get("preview") === "true";
  try {
    if (route === "") {
      if (method === "GET") return await handleGetRules();
      if (method === "PUT") return await handlePutRules(request);
    } else if (route === "/backup" && method === "GET") {
      const available = await Bun.file(backupPathFor(config.rulesFile)).exists();
      return json({ available });
    } else if (route === "/undo" && method === "POST") {
      return await handleUndo();
    } else if (route === "/validate" && method === "POST") {
      return await handleValidate(request);
    } else if (route === "/github" && method === "GET") {
      return json({ rules: listGithubRules(await readRulesText()) });
    } else if (route === "/github" && method === "POST") {
      const input = parseGithubRuleInput(await readJsonBody(request));
      return await commitRulesChange(
        preview,
        addGithubRule(await readRulesText(), input),
      );
    } else if (route.startsWith("/github/")) {
      const name = decodeURIComponent(route.slice("/github/".length));
      if (method === "PUT") {
        const input = parseGithubRuleInput(await readJsonBody(request));
        return await commitRulesChange(
          preview,
          updateGithubRule(await readRulesText(), name, input),
        );
      }
      if (method === "DELETE") {
        return await commitRulesChange(
          preview,
          deleteGithubRule(await readRulesText(), name),
        );
      }
    } else {
      return json({ error: "Not found" }, 404);
    }
    return json({ error: "Method not allowed" }, 405);
  } catch (error) {
    const status = error instanceof RuleEditError ? error.status : 400;
    const message = error instanceof Error ? error.message : "Invalid rules";
    await logger.warn("Rules change rejected", { error: message });
    return json({ error: message }, status);
  }
}

async function handleEditor(): Promise<Response> {
  return text(editorPage, "text/html; charset=utf-8");
}

// Lists the downloadable asset names of a GitHub release, using the same page
// fetch and link extraction as /process. Used by the editor's asset picker.
async function handleReleaseAssets(request: Request, url: URL): Promise<Response> {
  if (request.method !== "GET") {
    return json({ error: "Method not allowed" }, 405);
  }
  const repo = url.searchParams.get("repo") ?? "";
  const tag = url.searchParams.get("tag") ?? "";
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
    return json({ error: "repo must be in owner/name format" }, 400);
  }
  const page = tag
    ? `https://github.com/${repo}/releases/tag/${encodeURIComponent(tag)}`
    : `https://github.com/${repo}/releases/latest`;
  try {
    const variant = new GitHubReleaseVariant([]);
    let { response, url: resolvedUrl } = await fetchAllowed(variant.pageUrl(page));
    const transformed = variant.pageUrl(resolvedUrl);
    if (transformed !== resolvedUrl) {
      ({ response } = await fetchAllowed(transformed));
    }
    if (!response.ok) {
      return json({ error: `GitHub returned HTTP ${response.status}` }, 422);
    }
    const links = variant.extractLinks(resolvedUrl, await response.text());
    const assets = [
      ...new Set(
        links
          .filter((link) => link.path.includes("/releases/download/"))
          .map((link) => decodeURIComponent(link.path.split("/").pop() ?? ""))
          .filter((name) => name.length > 0),
      ),
    ];
    return json({ assets, release: resolvedUrl });
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : "Unable to list assets" },
      422,
    );
  }
}

export async function handleRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  await logger.info("Request received", {
    method: request.method,
    path: url.pathname,
  });

  if (url.pathname.startsWith("/status/")) {
    return handleStatus(url.pathname.slice("/status/".length));
  }

  if (url.pathname.startsWith("/api/rules")) {
    return handleRulesApi(request, url);
  }

  if (url.pathname === "/api/github/assets") {
    const denied = await authorizeRules(request);
    if (denied) return denied;
    return handleReleaseAssets(request, url);
  }

  if (url.pathname === "/editor") {
    return handleEditor();
  }

  if (url.pathname !== "/process") {
    await logger.warn("Request path not found", { path: url.pathname });
    return json({ error: "Not found" }, 404);
  }

  if (request.method !== "GET") {
    await logger.warn("Request method not allowed", { method: request.method });
    return json({ error: "Method not allowed" }, 405);
  }

  // Accept either url parameter or org+repo+tag parameters
  let source = url.searchParams.get("url");
  const org = url.searchParams.get("org");
  const repo = url.searchParams.get("repo");
  const tag = url.searchParams.get("tag") ?? "latest";

  // Validate that either url or org+repo is provided
  if (!source && !(org && repo)) {
    await logger.warn("Request missing url or org+repo parameters");
    return json(
      {
        error: "Either 'url' or both 'org' and 'repo' parameters are required",
      },
      400,
    );
  }

  if (source && (org || repo)) {
    await logger.warn("Request has both url and org/repo parameters");
    return json(
      { error: "Cannot specify both 'url' and 'org'/'repo' parameters" },
      400,
    );
  }

  // Construct URL from org/repo/tag if provided
  if (org && repo) {
    source =
      tag === "latest"
        ? `https://github.com/${org}/${repo}/releases/latest`
        : `https://github.com/${org}/${repo}/releases/tag/${tag}`;
    await logger.info("Constructed URL from org/repo/tag", {
      org,
      repo,
      tag,
      url: source,
    });
  }

  // TypeScript: source is guaranteed non-null after validation/construction
  const sourceUrl = source as string;

  try {
    const parsed = new URL(sourceUrl);
    if (!/^https?:$/.test(parsed.protocol)) {
      await logger.warn("Request URL has unsupported protocol");
      return json({ error: "The url must use HTTP or HTTPS" }, 400);
    }
  } catch {
    await logger.warn("Request URL is invalid");
    return json({ error: "The url query parameter is invalid" }, 400);
  }

  if (!isAllowedUrl(sourceUrl)) {
    await logger.warn("Request URL host is not allowed");
    return json({ error: "The supplied host is not allowed" }, 400);
  }

  const rules = await loadRules(config.rulesFile, defaultRules);
  const selected = selectVariant(sourceUrl, rules);
  if (!selected) {
    await logger.warn("No variant matched request URL");
    return json({ error: "No variant matches the supplied URL" }, 404);
  }

  try {
    let { response, url: resolvedUrl } = await fetchAllowed(
      selected.variant.pageUrl(sourceUrl),
    );
    if (!response.ok) {
      await logger.warn("Source page returned an error", {
        status: response.status,
      });
      return json(
        { error: `Source page returned HTTP ${response.status}` },
        422,
      );
    }
    // Re-derive the page URL once redirects (e.g. /releases/latest) resolve, refetching if it changed.
    // resolvedUrl is kept as the pre-transform URL so capture derivation (e.g. TAG) still applies.
    const transformedUrl = selected.variant.pageUrl(resolvedUrl);
    if (transformedUrl !== resolvedUrl) {
      ({ response } = await fetchAllowed(transformedUrl));
      if (!response.ok) {
        await logger.warn("Source page returned an error", {
          status: response.status,
        });
        return json(
          { error: `Source page returned HTTP ${response.status}` },
          422,
        );
      }
    }
    const links = selected.variant.extractLinks(
      resolvedUrl,
      await response.text(),
    );
    const captures = applySetVariables(selected.rule, {
      ...selected.captures,
      ...selected.variant.deriveCaptures(resolvedUrl),
    });
    const downloads = selected.variant.matchingDownloads(
      links,
      captures,
      selected.rule,
    );
    // A get pattern that matches no asset is a requested action that will never
    // run; surface it as a failed action instead of silently omitting it.
    const unmatchedGetPatterns = selected.rule.get.filter((pattern) => {
      const expanded = expandPlaceholders(pattern, captures);
      return (
        expanded !== undefined &&
        !links.some((link) => matchRule(expanded, link.url).matched)
      );
    });
    if (downloads.length === 0) {
      await logger.info("No actionable links found", {
        variant: selected.variant.name,
      });
      return json({ error: "No actionable links found", actions: [] }, 422);
    }

    if (
      config.dryRun ||
      url.searchParams.get("dry_run")?.toLowerCase() === "true"
    ) {
      const actions = downloads.map((link) => ({
        variant: selected.variant.name,
        url: link.url,
        status: "planned",
        captures: link.captures,
      }));
      await Promise.all(
        actions.map((action) =>
          logger.info("Dry-run action planned", {
            variant: action.variant,
            url: action.url,
            status: action.status,
          }),
        ),
      );
      await logger.info("Dry-run actions planned", {
        variant: selected.variant.name,
        count: actions.length,
      });
      return json(actions);
    }

    const job = jobs.create(selected.variant.name, sourceUrl);
    for (const pattern of unmatchedGetPatterns) {
      job.actions.push({
        variant: selected.variant.name,
        url: sourceUrl,
        status: "failed",
        error: `No asset matched get pattern: "${pattern}"`,
        captures,
      });
      await logger.warn("Get pattern matched no assets", {
        variant: selected.variant.name,
        pattern,
      });
    }
    void (async () => {
      try {
        await processDownloads(
          selected.variant,
          selected.rule,
          downloads,
          captures,
          config,
          logger,
          job.actions,
        );
        jobs.complete(job.id);
        await logger.info("Request completed", {
          variant: selected.variant.name,
          count: job.actions.length,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        jobs.fail(job.id, message);
        await logger.error("Request processing failed", { error: message });
      }
    })();
    return json(
      { id: job.id, status: job.status, statusUrl: `/status/${job.id}` },
      202,
    );
  } catch (error) {
    await logger.error("Request processing failed", {
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return json(
      {
        error:
          error instanceof Error ? error.message : "Unable to process request",
      },
      422,
    );
  }
}

export const server = Bun.serve({
  hostname: config.host,
  port: config.port,
  idleTimeout: config.idleTimeoutSeconds,
  fetch: handleRequest,
});

await logger.info("GEXDIS listening", { url: server.url.toString() });
