import { afterEach, expect, mock, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let cleanup: (() => Promise<void>) | undefined;

afterEach(async () => {
  await cleanup?.();
  cleanup = undefined;
});

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
  const actions = (await response.json()) as Array<{ status: string }>;
  expect(response.status).toBe(200);
  expect(actions.map((action) => action.status)).toEqual([
    'downloaded',
    'copied',
  ]);
  expect(await readFile(join(appDir, 'bin', 'tool.exe'), 'utf8')).toBe(
    'binary',
  );
});
