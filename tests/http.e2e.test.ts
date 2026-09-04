import { afterEach, expect, mock, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let cleanup: (() => Promise<void>) | undefined;

afterEach(async () => {
  await cleanup?.();
  cleanup = undefined;
});

interface JobResponse {
  id: string;
  status: 'running' | 'completed' | 'failed';
  actions: Array<{ status: string }>;
  error?: string;
}

async function pollJob(
  handleRequest: (request: Request) => Promise<Response>,
  statusUrl: string,
): Promise<JobResponse> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const response = await handleRequest(
      new Request(new URL(statusUrl, 'http://localhost')),
    );
    const job = (await response.json()) as JobResponse;
    if (job.status !== 'running') return job;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('Job did not complete in time');
}

test('processes a GitHub URL through the HTTP handler end to end', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'gexdis-http-'));
  const appDir = join(directory, 'app');
  const configDir = join(appDir, 'config');
  const rulesFile = join(configDir, 'rules.yml');
  await mkdir(configDir, { recursive: true });
  await Bun.write(
    rulesFile,
    `variants:\n  github:\n    - url: ^https://github\\.com/acme/tool/releases/tag/(?<TAG>.+)$\n      get:\n        - (?<NAME>[^/]+\\.exe)$\n      copy:\n        - ^{NAME}$:/app/bin\n  peeplink:\n    - url: ^https://peeplink\\.in/(?<ID>.+)$\n      get: []\n      copy: []\n`,
  );
  const environment = {
    APP_DIR: appDir,
    CONFIG_DIR: configDir,
    RULES_FILE: rulesFile,
    TMP_DIR: join(appDir, 'tmp'),
    DOWNLOAD_DIR: join(appDir, 'download'),
    RELEASE_DIR: join(appDir, 'release'),
    BIN_DIR: join(appDir, 'bin'),
    LOG_DIR: join(appDir, 'log'),
    PORT: '0',
  };
  const previousEnvironment = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(environment)) {
    previousEnvironment.set(key, process.env[key]);
    process.env[key] = value;
  }

  const originalFetch = globalThis.fetch;
  let assetFetches = 0;
  globalThis.fetch = mock(async (url: string) => {
    if (url.includes('/expanded_assets/')) {
      return new Response(
        '<a href="/acme/tool/releases/download/v1/tool.exe">asset</a>',
      );
    }
    if (url.includes('/releases/download/')) assetFetches += 1;
    return new Response('binary');
  }) as unknown as typeof fetch;

  const { handleRequest, server } = await import('../src/main.ts');
  cleanup = async () => {
    globalThis.fetch = originalFetch;
    await server.stop();
    for (const [key, value] of previousEnvironment) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(directory, { recursive: true, force: true });
  };

  const requestUrl = new URL('http://localhost/process');
  requestUrl.searchParams.set(
    'url',
    'https://github.com/acme/tool/releases/tag/v1',
  );
  requestUrl.searchParams.set('dry_run', 'true');
  const dryResponse = await handleRequest(new Request(requestUrl));
  expect(dryResponse.status).toBe(200);
  expect(
    (await dryResponse.json()).map(
      (action: { status: string }) => action.status,
    ),
  ).toEqual(['planned']);
  expect(assetFetches).toBe(0);

  requestUrl.searchParams.delete('dry_run');
  const response = await handleRequest(new Request(requestUrl));
  expect(response.status).toBe(202);
  const { statusUrl } = (await response.json()) as { statusUrl: string };
  const job = await pollJob(handleRequest, statusUrl);
  expect(job.status).toBe('completed');
  expect(job.actions.map((action) => action.status)).toEqual([
    'downloaded',
    'copied',
    'failed',
  ]);
  expect(await readFile(join(appDir, 'bin', 'tool.exe'), 'utf8')).toBe(
    'binary',
  );
});

test('resolves a /releases/latest redirect before applying the expanded_assets page', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'gexdis-http-'));
  const appDir = join(directory, 'app');
  const configDir = join(appDir, 'config');
  const rulesFile = join(configDir, 'rules.yml');
  await mkdir(configDir, { recursive: true });
  await Bun.write(
    rulesFile,
    `variants:\n  github:\n    - url: ^https://github\\.com/acme/tool/releases/(tag/.+|latest)$\n      get:\n        - (?<NAME>[^/]+\\.exe)$\n      copy:\n        - ^{NAME}$:/app/bin/{TAG}/tool.exe\n  peeplink:\n    - url: ^https://peeplink\\.in/(?<ID>.+)$\n      get: []\n      copy: []\n`,
  );
  const environment = {
    APP_DIR: appDir,
    CONFIG_DIR: configDir,
    RULES_FILE: rulesFile,
    TMP_DIR: join(appDir, 'tmp'),
    DOWNLOAD_DIR: join(appDir, 'download'),
    RELEASE_DIR: join(appDir, 'release'),
    BIN_DIR: join(appDir, 'bin'),
    LOG_DIR: join(appDir, 'log'),
    PORT: '0',
  };
  const previousEnvironment = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(environment)) {
    previousEnvironment.set(key, process.env[key]);
    process.env[key] = value;
  }

  const originalFetch = globalThis.fetch;
  globalThis.fetch = mock(async (url: string) => {
    if (url.endsWith('/releases/latest')) {
      return new Response(null, {
        status: 302,
        headers: {
          location: 'https://github.com/acme/tool/releases/tag/v2',
        },
      });
    }
    if (url.includes('/expanded_assets/')) {
      return new Response(
        '<a href="/acme/tool/releases/download/v2/tool.exe">asset</a>',
      );
    }
    return new Response('binary');
  }) as unknown as typeof fetch;

  const mainModulePath = '../src/main.ts' + '?latest-redirect';
  const { handleRequest, server } = await import(mainModulePath);
  cleanup = async () => {
    globalThis.fetch = originalFetch;
    await server.stop();
    for (const [key, value] of previousEnvironment) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(directory, { recursive: true, force: true });
  };

  const requestUrl = new URL('http://localhost/process');
  requestUrl.searchParams.set(
    'url',
    'https://github.com/acme/tool/releases/latest',
  );
  const response = await handleRequest(new Request(requestUrl));
  expect(response.status).toBe(202);
  const { statusUrl } = (await response.json()) as { statusUrl: string };
  const job = await pollJob(handleRequest, statusUrl);
  expect(job.status).toBe('completed');
  expect(job.actions.map((action) => action.status)).toEqual([
    'downloaded',
    'copied',
    'failed',
  ]);
  // TAG (v2) is only known after the /releases/latest redirect resolves, confirming it was recaptured.
  expect(await readFile(join(appDir, 'bin', 'v2', 'tool.exe'), 'utf8')).toBe(
    'binary',
  );
});
