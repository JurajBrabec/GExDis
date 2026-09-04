import { afterEach, expect, mock, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BlobReader, BlobWriter, TextReader, ZipWriter } from '@zip.js/zip.js';
import { extractArchive } from '../src/archive.ts';
import { Logger } from '../src/logger.ts';
import { processDownloads } from '../src/processor.ts';
import { GitHubReleaseVariant, defaultRules } from '../src/variants.ts';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  mock.restore();
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

test('downloads and copies matching files, then cleans temporary files', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'gexdis-processor-'));
  temporaryDirectories.push(directory);
  const tempDir = join(directory, 'tmp');
  const appDir = join(directory, 'app');
  const logger = new Logger(join(directory, 'log'));
  const variant = new GitHubReleaseVariant(defaultRules.github);
  const link = {
    url: 'https://github.com/acme/tool/releases/download/v1/tool.exe',
    path: '/tool.exe',
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mock(() =>
    Promise.resolve(new Response('binary')),
  ) as unknown as typeof fetch;

  const actions = await processDownloads(
    variant,
    {
      name: 'test',
      url: 'url',
      get: ['\\.exe$'],
      copy: ['^tool\\.exe$:/app/bin/tool.exe'],
    },
    [{ ...link, captures: {} }],
    {},
    { tempDir, appDir },
    logger,
  );

  expect(actions.map((action) => action.status)).toEqual([
    'downloaded',
    'copied',
  ]);
  expect(await readFile(join(appDir, 'bin', 'tool.exe'), 'utf8')).toBe(
    'binary',
  );
  expect((await Array.fromAsync(new Bun.Glob('*').scan(tempDir))).length).toBe(
    0,
  );
  globalThis.fetch = originalFetch;
});

test('copies a single file to every matching copy rule destination', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'gexdis-processor-'));
  temporaryDirectories.push(directory);
  const tempDir = join(directory, 'tmp');
  const appDir = join(directory, 'app');
  const logger = new Logger(join(directory, 'log'));
  const variant = new GitHubReleaseVariant(defaultRules.github);
  const link = {
    url: 'https://github.com/acme/tool/releases/download/v1/tool.exe',
    path: '/tool.exe',
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mock(() =>
    Promise.resolve(new Response('binary')),
  ) as unknown as typeof fetch;

  const actions = await processDownloads(
    variant,
    {
      name: 'test',
      url: 'url',
      get: ['\\.exe$'],
      copy: ['^tool\\.exe$:/app/download/', '^tool\\.exe$:/app/bin/tool.exe'],
    },
    [{ ...link, captures: {} }],
    {},
    { tempDir, appDir },
    logger,
  );
  globalThis.fetch = originalFetch;

  expect(actions.map((action) => action.status)).toEqual([
    'downloaded',
    'copied',
    'copied',
  ]);
  expect(await readFile(join(appDir, 'download', 'tool.exe'), 'utf8')).toBe(
    'binary',
  );
  expect(await readFile(join(appDir, 'bin', 'tool.exe'), 'utf8')).toBe(
    'binary',
  );
});

test('reports an invalid copy rule as a failed action', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'gexdis-processor-'));
  temporaryDirectories.push(directory);
  const tempDir = join(directory, 'tmp');
  const appDir = join(directory, 'app');
  const logger = new Logger(join(directory, 'log'));
  const variant = new GitHubReleaseVariant(defaultRules.github);
  const link = {
    url: 'https://github.com/acme/tool/releases/download/v1/tool.exe',
    path: '/tool.exe',
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mock(() =>
    Promise.resolve(new Response('binary')),
  ) as unknown as typeof fetch;

  const actions = await processDownloads(
    variant,
    { name: 'test', url: 'url', get: ['\\.exe$'], copy: ['missing-colon'] },
    [{ ...link, captures: {} }],
    {},
    { tempDir, appDir },
    logger,
  );
  globalThis.fetch = originalFetch;

  expect(actions.map((action) => action.status)).toEqual([
    'downloaded',
    'failed',
  ]);
  expect(actions.at(-1)?.error).toContain('Invalid copy rule format');
});

test('reports a copy rule that matched no file as a failed action', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'gexdis-processor-'));
  temporaryDirectories.push(directory);
  const tempDir = join(directory, 'tmp');
  const appDir = join(directory, 'app');
  const logger = new Logger(join(directory, 'log'));
  const variant = new GitHubReleaseVariant(defaultRules.github);
  const link = {
    url: 'https://github.com/acme/tool/releases/download/v1/tool.exe',
    path: '/tool.exe',
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mock(() =>
    Promise.resolve(new Response('binary')),
  ) as unknown as typeof fetch;

  const actions = await processDownloads(
    variant,
    {
      name: 'test',
      url: 'url',
      get: ['\\.exe$'],
      copy: ['^does-not-exist\\.exe$:/app/bin'],
    },
    [{ ...link, captures: {} }],
    {},
    { tempDir, appDir },
    logger,
  );
  globalThis.fetch = originalFetch;

  expect(actions.map((action) => action.status)).toEqual([
    'downloaded',
    'failed',
  ]);
  expect(actions.at(-1)?.error).toContain('No file matched copy rule');
});

test('reports a copy filesystem error without aborting other copy rules', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'gexdis-processor-'));
  temporaryDirectories.push(directory);
  const tempDir = join(directory, 'tmp');
  const appDir = join(directory, 'app');
  // occupy the destination path with a file so mkdir(destinationDirectory) fails
  await Bun.write(join(appDir, 'bin'), 'blocking-file');
  const logger = new Logger(join(directory, 'log'));
  const variant = new GitHubReleaseVariant(defaultRules.github);
  const link = {
    url: 'https://github.com/acme/tool/releases/download/v1/tool.exe',
    path: '/tool.exe',
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mock(() =>
    Promise.resolve(new Response('binary')),
  ) as unknown as typeof fetch;

  const actions = await processDownloads(
    variant,
    {
      name: 'test',
      url: 'url',
      get: ['\\.exe$'],
      copy: ['^tool\\.exe$:/app/bin/tool.exe', '^tool\\.exe$:/app/download'],
    },
    [{ ...link, captures: {} }],
    {},
    { tempDir, appDir },
    logger,
  );
  globalThis.fetch = originalFetch;

  expect(actions.map((action) => action.status)).toEqual([
    'downloaded',
    'failed',
    'copied',
  ]);
  expect(await readFile(join(appDir, 'download', 'tool.exe'), 'utf8')).toBe(
    'binary',
  );
});

test('reports a failed download and continues processing other links', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'gexdis-processor-'));
  temporaryDirectories.push(directory);
  const logger = new Logger(join(directory, 'log'));
  const variant = new GitHubReleaseVariant(defaultRules.github);
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = mock(async () => {
    calls += 1;
    return calls === 1
      ? new Response(null, { status: 500 })
      : new Response('ok');
  }) as unknown as typeof fetch;

  const actions = await processDownloads(
    variant,
    { name: 'test', url: 'url', get: ['\\.exe$'], copy: [] },
    [
      {
        url: 'https://github.com/a/tool/releases/download/v1/one.exe',
        path: '/one.exe',
        captures: {},
      },
      {
        url: 'https://github.com/a/tool/releases/download/v1/two.exe',
        path: '/two.exe',
        captures: {},
      },
    ],
    {},
    { tempDir: join(directory, 'tmp'), appDir: join(directory, 'app') },
    logger,
  );
  globalThis.fetch = originalFetch;

  expect(actions.map((action) => action.status)).toEqual([
    'failed',
    'downloaded',
  ]);
});

test('flattens a single root folder when extracting a ZIP', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'gexdis-processor-'));
  temporaryDirectories.push(directory);
  const zipWriter = new ZipWriter(new BlobWriter('application/zip'));
  await zipWriter.add('package/tool.exe', new TextReader('binary'));
  const zipBlob = await zipWriter.close();
  const archivePath = join(directory, 'tool.zip');
  await Bun.write(archivePath, zipBlob);

  const extracted = await extractArchive(
    archivePath,
    join(directory, 'contents'),
  );
  expect(extracted.root.endsWith('contents')).toBe(true);
  expect(extracted.entries.map((entry) => entry.relativePath)).toEqual([
    'tool.exe',
  ]);
  expect(await Bun.file(join(extracted.root, 'tool.exe')).text()).toBe(
    'binary',
  );
});

test('copies a file extracted from a flattened single root folder', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'gexdis-processor-'));
  temporaryDirectories.push(directory);
  const zipWriter = new ZipWriter(new BlobWriter('application/zip'));
  await zipWriter.add('package/tool.exe', new TextReader('binary'));
  const zipBlob = await zipWriter.close();
  const archivePath = join(directory, 'tool.zip');
  await Bun.write(archivePath, zipBlob);
  const logger = new Logger(join(directory, 'log'));
  const variant = new GitHubReleaseVariant(defaultRules.github);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mock(() =>
    Promise.resolve(new Response(zipBlob)),
  ) as unknown as typeof fetch;

  const actions = await processDownloads(
    variant,
    {
      name: 'test',
      url: 'url',
      get: ['\\.zip$'],
      unpack: ['^.+\\.zip$'],
      copy: ['^tool\\.exe$:/app/release'],
    },
    [
      {
        url: 'https://github.com/acme/tool/releases/download/v1/tool.zip',
        path: '/tool.zip',
        captures: {},
      },
    ],
    {},
    { tempDir: join(directory, 'tmp'), appDir: join(directory, 'app') },
    logger,
  );
  globalThis.fetch = originalFetch;

  expect(actions.map((action) => action.status)).toEqual([
    'downloaded',
    'unpacked',
    'copied',
  ]);
  expect(
    await readFile(join(directory, 'app', 'release', 'tool.exe'), 'utf8'),
  ).toBe('binary');
});

test('rejects ZIP entries that escape the extraction root', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'gexdis-processor-'));
  temporaryDirectories.push(directory);
  const zipWriter = new ZipWriter(new BlobWriter('application/zip'));
  await zipWriter.add('../outside.txt', new TextReader('unsafe'));
  const archivePath = join(directory, 'unsafe.zip');
  await Bun.write(archivePath, await zipWriter.close());

  await expect(
    extractArchive(archivePath, join(directory, 'contents')),
  ).rejects.toThrow(/Unsafe (archive entry|filename)/);
});
