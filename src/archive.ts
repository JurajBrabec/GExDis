import { mkdir, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { BlobReader, Uint8ArrayWriter, ZipReader } from '@zip.js/zip.js';
import { createExtractorFromData } from 'node-unrar-js';

export interface ExtractedEntry {
  path: string;
  relativePath: string;
  directory: boolean;
}

function validateEntry(entryPath: string): string {
  const normalized = entryPath.replaceAll('\\', '/');
  if (normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) {
    throw new Error(`Unsafe archive entry: ${entryPath}`);
  }
  const parts = normalized.split('/').filter(Boolean);
  if (parts.includes('..')) {
    throw new Error(`Unsafe archive entry: ${entryPath}`);
  }
  return parts.join('/');
}

function archiveKind(fileName: string): 'zip' | 'tar' | 'rar' | undefined {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.zip')) return 'zip';
  if (
    lower.endsWith('.tar') ||
    lower.endsWith('.tgz') ||
    lower.endsWith('.tar.gz')
  )
    return 'tar';
  if (lower.endsWith('.rar')) return 'rar';
  return undefined;
}

function archiveBaseName(fileName: string): string {
  return basename(fileName).replace(/\.(tar\.gz|tgz|tar|zip|rar)$/i, '');
}

function smartRoot(
  fileName: string,
  entries: ExtractedEntry[],
  output: string,
): string {
  const roots = new Set(
    entries.map((entry) => entry.relativePath.split('/')[0]).filter(Boolean),
  );
  const hasRootFile = entries.some(
    (entry) => !entry.relativePath.includes('/'),
  );
  if (!hasRootFile && roots.size === 1) return output;
  return join(output, archiveBaseName(fileName));
}

export async function extractArchive(
  filePath: string,
  output: string,
): Promise<{ root: string; entries: ExtractedEntry[] }> {
  const kind = archiveKind(filePath);
  if (!kind) throw new Error(`Unsupported archive format: ${filePath}`);
  const bytes = new Uint8Array(await Bun.file(filePath).arrayBuffer());
  const archiveBuffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const listed: ExtractedEntry[] = [];

  if (kind === 'zip') {
    const reader = new ZipReader(new BlobReader(new Blob([bytes])));
    try {
      for (const entry of await reader.getEntries()) {
        const relativePath = validateEntry(entry.filename);
        listed.push({
          path: entry.filename,
          relativePath,
          directory: Boolean(entry.directory),
        });
      }
    } finally {
      await reader.close();
    }
  } else if (kind === 'tar') {
    const archive = new Bun.Archive(bytes);
    for (const [entryPath] of await archive.files()) {
      const relativePath = validateEntry(entryPath);
      listed.push({
        path: entryPath,
        relativePath,
        directory: entryPath.endsWith('/'),
      });
    }
  } else {
    const wasmPath = join(
      process.cwd(),
      'node_modules/node-unrar-js/dist/js/unrar.wasm',
    );
    const extractor = await createExtractorFromData({
      data: archiveBuffer,
      wasmBinary: await Bun.file(wasmPath).arrayBuffer(),
    });
    const files = extractor.getFileList().fileHeaders;
    for (const entry of files) {
      const relativePath = validateEntry(entry.name);
      listed.push({
        path: entry.name,
        relativePath,
        directory: entry.flags.directory,
      });
    }
  }

  const root = smartRoot(filePath, listed, output);
  await mkdir(root, { recursive: true });

  if (kind === 'zip') {
    const reader = new ZipReader(new BlobReader(new Blob([bytes])));
    try {
      for (const entry of await reader.getEntries()) {
        const relativePath = validateEntry(entry.filename);
        if (entry.directory) {
          await mkdir(join(root, relativePath), { recursive: true });
          continue;
        }
        const target = resolve(root, relativePath);
        if (
          !target.startsWith(resolve(root) + '\\') &&
          target !== resolve(root)
        )
          throw new Error(`Unsafe archive entry: ${entry.filename}`);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, await entry.getData(new Uint8ArrayWriter()));
      }
    } finally {
      await reader.close();
    }
  } else if (kind === 'tar') {
    await new Bun.Archive(bytes).extract(root);
  } else {
    const wasmPath = join(
      process.cwd(),
      'node_modules/node-unrar-js/dist/js/unrar.wasm',
    );
    const extractor = await createExtractorFromData({
      data: archiveBuffer,
      wasmBinary: await Bun.file(wasmPath).arrayBuffer(),
    });
    for (const entry of extractor.extract().files) {
      if (entry.fileHeader.flags.encrypted)
        throw new Error('Password-protected archives are not supported');
      const relativePath = validateEntry(entry.fileHeader.name);
      if (entry.fileHeader.flags.directory) {
        await mkdir(join(root, relativePath), { recursive: true });
        continue;
      }
      const target = resolve(root, relativePath);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, entry.extraction ?? new Uint8Array());
    }
  }

  return {
    root,
    entries: listed.map((entry) => ({
      ...entry,
      path: join(root, entry.relativePath),
    })),
  };
}

export function isArchive(fileName: string): boolean {
  return archiveKind(fileName) !== undefined;
}
