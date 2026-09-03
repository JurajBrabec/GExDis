import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Logger } from '../src/logger.ts';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

test('writes structured messages to a daily log file', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'gexdis-log-'));
  temporaryDirectories.push(directory);
  await new Logger(directory, 'info').info('test event', { count: 1 });

  const files = await Array.fromAsync(
    new Bun.Glob('gexdis-*.log').scan(directory),
  );
  expect(files).toHaveLength(1);
  const content = await readFile(join(directory, files[0]), 'utf8');
  expect(JSON.parse(content).message).toBe('test event');
  expect(JSON.parse(content).count).toBe(1);
});

test('does not write below the configured log level', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'gexdis-log-'));
  temporaryDirectories.push(directory);
  await new Logger(directory, 'warn').info('ignored');
  expect((await new Bun.Glob('gexdis-*.log').scan(directory).next()).done).toBe(
    true,
  );
});

test('redacts query strings from URL fields', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'gexdis-log-'));
  temporaryDirectories.push(directory);
  await new Logger(directory).info('request', {
    url: 'https://github.com/acme/tool?token=secret#asset',
  });
  const files = await Array.fromAsync(
    new Bun.Glob('gexdis-*.log').scan(directory),
  );
  const content = await readFile(join(directory, files[0]), 'utf8');
  expect(content).toContain('https://github.com/acme/tool');
  expect(content).not.toContain('secret');
});
