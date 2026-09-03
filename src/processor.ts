import { copyFile, cp, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { extractArchive, isArchive } from './archive.ts';
import {
  expandPlaceholders,
  matchAnyRule,
  matchRule,
  parseCopyRule,
  type RuleSet,
} from './rules.ts';
import type { DownloadLink, PageLink, Variant } from './variants.ts';
import { isAllowedUrl } from './variants.ts';
import { Logger } from './logger.ts';
import { fetchAllowed } from './http-client.ts';

export interface ActionResult {
  variant: string;
  url: string;
  status: 'downloaded' | 'unpacked' | 'copied' | 'failed';
  path?: string;
  error?: string;
}

interface ProcessorConfig {
  tempDir: string;
  appDir: string;
}

function safeName(link: PageLink): string {
  const name = basename(new URL(link.url).pathname);
  return name && name !== '.' && name !== '..' ? name : 'download';
}

function targetPath(target: string, appDir: string): string {
  return target.startsWith('/app/')
    ? join(appDir, target.slice('/app/'.length))
    : target;
}

async function filesUnder(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const paths: string[] = [];
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) paths.push(...(await filesUnder(path)));
    else paths.push(path);
  }
  return paths;
}

async function pathsUnder(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const paths: string[] = [];
  for (const entry of entries) {
    const path = join(root, entry.name);
    paths.push(path);
    if (entry.isDirectory()) paths.push(...(await pathsUnder(path)));
  }
  return paths;
}

async function copyMatching(
  variant: Variant,
  link: PageLink,
  sourceRoot: string,
  candidateRoot: string,
  rule: RuleSet,
  captures: Record<string, string>,
  appDir: string,
  actions: ActionResult[],
  logger: Logger,
  directCandidate?: string,
): Promise<void> {
  const sourceIsDirectory = (await stat(sourceRoot)).isDirectory();
  const sourcePaths = sourceIsDirectory
    ? await pathsUnder(sourceRoot)
    : [sourceRoot];
  for (const sourcePath of sourcePaths) {
    const candidate = (
      sourceIsDirectory
        ? relative(candidateRoot, sourcePath)
        : (directCandidate ?? basename(sourcePath))
    ).replaceAll('\\', '/');
    for (const copyRule of rule.copy) {
      const parsed = parseCopyRule(copyRule);
      if (!parsed) continue;
      const sourcePattern = expandPlaceholders(parsed.source, captures);
      const destination = expandPlaceholders(parsed.target, captures);
      if (
        sourcePattern === undefined ||
        destination === undefined ||
        !matchRule(sourcePattern, candidate).matched
      )
        continue;
      const destinationDirectory = resolve(targetPath(destination, appDir));
      const destinationName = sourceIsDirectory
        ? basename(sourcePath)
        : (directCandidate ?? basename(sourcePath));
      const destinationIsFile =
        !sourceIsDirectory &&
        /\.[^/]+$/.test(destinationName) &&
        /\.[^/]+$/.test(destination);
      const destinationPath = destinationIsFile
        ? destinationDirectory
        : join(destinationDirectory, destinationName);
      await mkdir(
        destinationIsFile
          ? resolve(dirname(destinationPath))
          : destinationDirectory,
        { recursive: true },
      );
      if ((await stat(sourcePath)).isDirectory()) {
        await cp(sourcePath, destinationPath, { recursive: true, force: true });
      } else {
        await copyFile(sourcePath, destinationPath);
      }
      actions.push({
        variant: variant.name,
        url: link.url,
        status: 'copied',
        path: destinationPath,
      });
      await logger.info('File copied', {
        variant: variant.name,
        url: link.url,
        source: candidate,
        destination: destinationPath,
      });
    }
  }
}

async function unpackNested(
  variant: Variant,
  link: DownloadLink,
  root: string,
  rule: RuleSet,
  captures: Record<string, string>,
  config: ProcessorConfig,
  actions: ActionResult[],
  logger: Logger,
): Promise<void> {
  if (!rule.unpack) return;
  const nestedArchives = (await filesUnder(root)).filter((path) =>
    isArchive(path),
  );
  for (const archivePath of nestedArchives) {
    const candidate = relative(root, archivePath).replaceAll('\\', '/');
    const nestedCaptures: Record<string, string> = {
      ...captures,
      DOWNLOADED: basename(archivePath),
    };
    if (!matchAnyRule(rule.unpack, candidate, nestedCaptures)) continue;
    const nestedRoot = `${archivePath}-contents`;
    const extracted = await extractArchive(archivePath, nestedRoot);
    const unpacked = relative(root, extracted.root).replaceAll('\\', '/');
    nestedCaptures.UNPACKED = unpacked;
    actions.push({
      variant: variant.name,
      url: link.url,
      status: 'unpacked',
      path: unpacked,
    });
    await logger.info('Nested archive unpacked', {
      variant: variant.name,
      url: link.url,
      archive: candidate,
      root: extracted.root,
    });
    await copyMatching(
      variant,
      link,
      extracted.root,
      root,
      rule,
      nestedCaptures,
      config.appDir,
      actions,
      logger,
    );
    await unpackNested(
      variant,
      link,
      extracted.root,
      rule,
      nestedCaptures,
      config,
      actions,
      logger,
    );
  }
}

export async function processDownloads(
  variant: Variant,
  rule: RuleSet,
  links: DownloadLink[],
  captures: Record<string, string>,
  config: ProcessorConfig,
  logger: Logger,
): Promise<ActionResult[]> {
  const actions: ActionResult[] = [];
  await mkdir(config.tempDir, { recursive: true });

  for (const link of links) {
    const name = safeName(link);
    const temporaryPath = join(
      config.tempDir,
      `${crypto.randomUUID()}-${name}`,
    );
    const itemRoot = `${temporaryPath}-contents`;
    try {
      if (!isAllowedUrl(link.url)) {
        throw new Error('Download host is not allowed');
      }
      const { response } = await fetchAllowed(link.url);
      if (!response.ok) {
        throw new Error(`Download returned HTTP ${response.status}`);
      }
      await Bun.write(temporaryPath, await response.arrayBuffer());
      actions.push({
        variant: variant.name,
        url: link.url,
        status: 'downloaded',
        path: name,
      });
      await logger.info('File downloaded', {
        variant: variant.name,
        url: link.url,
        file: name,
      });

      const fileCaptures: Record<string, string> = { ...link.captures };
      fileCaptures.DOWNLOADED = name;
      if (
        isArchive(name) &&
        rule.unpack &&
        matchAnyRule(rule.unpack, name, fileCaptures)
      ) {
        const extracted = await extractArchive(temporaryPath, itemRoot);
        const roots = new Set(
          extracted.entries
            .map((entry) => entry.relativePath.split('/')[0])
            .filter(Boolean),
        );
        const unpacked =
          relative(itemRoot, extracted.root).replaceAll('\\', '/') ||
          [...roots][0] ||
          '';
        if (unpacked) fileCaptures.UNPACKED = unpacked;
        actions.push({
          variant: variant.name,
          url: link.url,
          status: 'unpacked',
          path: relative(config.tempDir, extracted.root),
        });
        await logger.info('Archive unpacked', {
          variant: variant.name,
          url: link.url,
          root: extracted.root,
        });
        await copyMatching(
          variant,
          link,
          extracted.root,
          itemRoot,
          rule,
          fileCaptures,
          config.appDir,
          actions,
          logger,
        );
        await unpackNested(
          variant,
          link,
          extracted.root,
          rule,
          fileCaptures,
          config,
          actions,
          logger,
        );
      }
      await copyMatching(
        variant,
        link,
        temporaryPath,
        config.tempDir,
        rule,
        fileCaptures,
        config.appDir,
        actions,
        logger,
        name,
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Processing failed';
      actions.push({
        variant: variant.name,
        url: link.url,
        status: 'failed',
        error: message,
      });
      await logger.error('File processing failed', {
        variant: variant.name,
        url: link.url,
        error: message,
      });
    } finally {
      await rm(temporaryPath, { force: true });
      await rm(itemRoot, { recursive: true, force: true });
      await logger.info('Temporary files cleaned', {
        variant: variant.name,
        url: link.url,
      });
    }
  }
  return actions;
}
