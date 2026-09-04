import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BlobWriter, TextReader, ZipWriter } from '@zip.js/zip.js';
import { extractArchive } from '../src/archive.ts';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function zipOf(entries: Record<string, string>): Promise<Blob> {
  const writer = new ZipWriter(new BlobWriter('application/zip'));
  for (const [path, content] of Object.entries(entries)) {
    await writer.add(path, new TextReader(content));
  }
  return writer.close();
}

test('flattens a single root folder (zip)', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'gexdis-archive-'));
  temporaryDirectories.push(directory);
  const archivePath = join(directory, 'single-folder.zip');
  await Bun.write(
    archivePath,
    await zipOf({ 'single-folder/file.txt': 'hello' }),
  );

  const extracted = await extractArchive(
    archivePath,
    join(directory, 'contents'),
  );

  expect(extracted.entries.map((entry) => entry.relativePath)).toEqual([
    'file.txt',
  ]);
  expect(await Bun.file(join(extracted.root, 'file.txt')).text()).toBe('hello');
});

test('keeps structure when the archive has multiple root folders (zip)', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'gexdis-archive-'));
  temporaryDirectories.push(directory);
  const archivePath = join(directory, 'texts.zip');
  await Bun.write(
    archivePath,
    await zipOf({
      'folder1/file1.txt': 'one',
      'file2.txt': 'two',
    }),
  );

  const extracted = await extractArchive(
    archivePath,
    join(directory, 'contents'),
  );

  expect(new Set(extracted.entries.map((entry) => entry.relativePath))).toEqual(
    new Set(['folder1/file1.txt', 'file2.txt']),
  );
  expect(
    await Bun.file(join(extracted.root, 'folder1', 'file1.txt')).text(),
  ).toBe('one');
  expect(await Bun.file(join(extracted.root, 'file2.txt')).text()).toBe('two');
});

test('keeps structure when the archive has a root file alongside a folder (zip)', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'gexdis-archive-'));
  temporaryDirectories.push(directory);
  const archivePath = join(directory, 'mixed.zip');
  await Bun.write(
    archivePath,
    await zipOf({
      'single-folder/file.txt': 'hello',
      'readme.txt': 'root file',
    }),
  );

  const extracted = await extractArchive(
    archivePath,
    join(directory, 'contents'),
  );

  expect(new Set(extracted.entries.map((entry) => entry.relativePath))).toEqual(
    new Set(['single-folder/file.txt', 'readme.txt']),
  );
  expect(
    await Bun.file(join(extracted.root, 'single-folder', 'file.txt')).text(),
  ).toBe('hello');
});

test('flattens a single root folder (tar)', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'gexdis-archive-'));
  temporaryDirectories.push(directory);
  const archivePath = join(directory, 'single-folder.tar');
  await Bun.Archive.write(archivePath, {
    'single-folder/file.txt': 'hello',
  });

  const extracted = await extractArchive(
    archivePath,
    join(directory, 'contents'),
  );

  expect(extracted.entries.map((entry) => entry.relativePath)).toEqual([
    'file.txt',
  ]);
  expect(await Bun.file(join(extracted.root, 'file.txt')).text()).toBe('hello');
});

test('keeps structure for a tar with multiple root entries', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'gexdis-archive-'));
  temporaryDirectories.push(directory);
  const archivePath = join(directory, 'texts.tar');
  await Bun.Archive.write(archivePath, {
    'folder1/file1.txt': 'one',
    'file2.txt': 'two',
  });

  const extracted = await extractArchive(
    archivePath,
    join(directory, 'contents'),
  );

  expect(new Set(extracted.entries.map((entry) => entry.relativePath))).toEqual(
    new Set(['folder1/file1.txt', 'file2.txt']),
  );
  expect(
    await Bun.file(join(extracted.root, 'folder1', 'file1.txt')).text(),
  ).toBe('one');
});
