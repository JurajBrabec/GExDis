import { loadConfig } from './config.ts';
import { Logger } from './logger.ts';
import { fetchAllowed } from './http-client.ts';
import { processDownloads } from './processor.ts';
import { loadRules } from './rules.ts';
import { defaultRules, isAllowedUrl, selectVariant } from './variants.ts';
import { JobStore } from './jobs.ts';

const config = loadConfig();
const logger = new Logger(
  config.logDir,
  config.logLevel,
  config.logRetentionDays,
);
const jobs = new JobStore();
await loadRules(config.rulesFile, defaultRules);
await logger.info('Rules loaded', { rulesFile: config.rulesFile });

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { 'cache-control': 'no-store' },
  });
}

async function handleStatus(id: string): Promise<Response> {
  const job = jobs.get(id);
  if (!job) {
    return json({ error: 'Job not found' }, 404);
  }
  return json(job);
}

export async function handleRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  await logger.info('Request received', {
    method: request.method,
    path: url.pathname,
  });

  if (url.pathname.startsWith('/status/')) {
    return handleStatus(url.pathname.slice('/status/'.length));
  }

  if (url.pathname !== '/process') {
    await logger.warn('Request path not found', { path: url.pathname });
    return json({ error: 'Not found' }, 404);
  }

  if (request.method !== 'GET') {
    await logger.warn('Request method not allowed', { method: request.method });
    return json({ error: 'Method not allowed' }, 405);
  }

  const source = url.searchParams.get('url');
  if (!source) {
    await logger.warn('Request missing url parameter');
    return json({ error: 'The url query parameter is required' }, 400);
  }

  try {
    const parsed = new URL(source);
    if (!/^https?:$/.test(parsed.protocol)) {
      await logger.warn('Request URL has unsupported protocol');
      return json({ error: 'The url must use HTTP or HTTPS' }, 400);
    }
  } catch {
    await logger.warn('Request URL is invalid');
    return json({ error: 'The url query parameter is invalid' }, 400);
  }

  if (!isAllowedUrl(source)) {
    await logger.warn('Request URL host is not allowed');
    return json({ error: 'The supplied host is not allowed' }, 400);
  }

  const rules = await loadRules(config.rulesFile, defaultRules);
  const selected = selectVariant(source, rules);
  if (!selected) {
    await logger.warn('No variant matched request URL');
    return json({ error: 'No variant matches the supplied URL' }, 404);
  }

  try {
    let { response, url: resolvedUrl } = await fetchAllowed(
      selected.variant.pageUrl(source),
    );
    if (!response.ok) {
      await logger.warn('Source page returned an error', {
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
        await logger.warn('Source page returned an error', {
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
    const captures = {
      ...selected.captures,
      ...selected.variant.deriveCaptures(resolvedUrl),
    };
    const downloads = selected.variant.matchingDownloads(
      links,
      captures,
      selected.rule,
    );
    if (downloads.length === 0) {
      await logger.info('No actionable links found', {
        variant: selected.variant.name,
      });
      return json({ error: 'No actionable links found', actions: [] }, 422);
    }

    if (
      config.dryRun ||
      url.searchParams.get('dry_run')?.toLowerCase() === 'true'
    ) {
      const actions = downloads.map((link) => ({
        variant: selected.variant.name,
        url: link.url,
        status: 'planned',
      }));
      await Promise.all(
        actions.map((action) =>
          logger.info('Dry-run action planned', {
            variant: action.variant,
            url: action.url,
            status: action.status,
          }),
        ),
      );
      await logger.info('Dry-run actions planned', {
        variant: selected.variant.name,
        count: actions.length,
      });
      return json(actions);
    }

    const job = jobs.create(selected.variant.name, source);
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
        await logger.info('Request completed', {
          variant: selected.variant.name,
          count: job.actions.length,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown error';
        jobs.fail(job.id, message);
        await logger.error('Request processing failed', { error: message });
      }
    })();
    return json(
      { id: job.id, status: job.status, statusUrl: `/status/${job.id}` },
      202,
    );
  } catch (error) {
    await logger.error('Request processing failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return json(
      {
        error:
          error instanceof Error ? error.message : 'Unable to process request',
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

await logger.info('GEXDIS listening', { url: server.url.toString() });
