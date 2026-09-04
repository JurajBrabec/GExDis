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
  rule?: string;
  captures: Record<string, string>;
}

interface ProcessorConfig {
  tempDir: string;
  appDir: string;
}

// Tracks, per link, which raw copy-rule strings were invalid, resolvable, or actually matched a file.
interface CopyRuleTracker {
  invalid: Set<string>;
  resolved: Set<string>;
  matched: Set<string>;
}

function createCopyRuleTracker(): CopyRuleTracker {
  return { invalid: new Set(), resolved: new Set(), matched: new Set() };
}

function reportUnmatchedCopyRules(
  variant: Variant,
  link: PageLink,
  rule: RuleSet,
  captures: Record<string, string>,
  tracker: CopyRuleTracker,
  actions: ActionResult[],
  logger: Logger,
): Promise<void[]> {
  return Promise.all(
    rule.copy
      .filter(
        (copyRule) =>
          tracker.resolved.has(copyRule) && !tracker.matched.has(copyRule),
      )
      .map(async (copyRule) => {
        actions.push({
          variant: variant.name,
          url: link.url,
          status: 'failed',
          error: `No file matched copy rule: "${copyRule}"`,
          captures,
        });
        await logger.warn('Copy rule matched no files', {
          variant: variant.name,
          url: link.url,
          rule: copyRule,
        });
      }),
  );
}

function safeName(link: PageLink): string {
  const name = basename(new URL(link.url).pathname);
  return name && name !== '.' && name !== '..' ? name : 'download';
}

// Temporary download artifacts are prefixed with a UUID on disk; captures such
// as {DOWNLOADED} and {UNPACKED} expose the clean names instead.
const UUID_PREFIX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/i;

function stripUuidPrefix(value: string): string {
  return value.replace(UUID_PREFIX, '');
}

// Extracted folders and their contents are matched strictly (the pattern must
// cover the whole candidate path), otherwise a folder like
// 'tool-v1.0.zip-contents' would substring-match a '{DOWNLOADED}' rule for
// 'tool-v1.0.zip' and be copied to the wrong destination. Directly downloaded
// files keep the lenient substring behavior.
function matchCandidate(
  pattern: string,
  candidate: string,
  strict: boolean,
): boolean {
  if (!strict) return matchRule(pattern, candidate).matched;
  return new RegExp(`^(?:${pattern})$`, 'i').test(candidate);
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
  tracker: CopyRuleTracker,
  directCandidate?: string,
  rootCandidate?: string,
): Promise<void> {
  const sourceIsDirectory = (await stat(sourceRoot)).isDirectory();
  // Include the extraction root itself so rules like '{UNPACKED}:...' can
  // match the whole folder, not only its children.
  const sourcePaths = sourceIsDirectory
    ? [sourceRoot, ...(await pathsUnder(sourceRoot))]
    : [sourceRoot];
  for (const sourcePath of sourcePaths) {
    const isRoot = sourceIsDirectory && sourcePath === sourceRoot;
    // Candidate names are exposed without the UUID temp prefix.
    const relativeToSource = stripUuidPrefix(
      relative(sourceRoot, sourcePath).replaceAll('\\', '/'),
    );
    const relativeToCandidate = stripUuidPrefix(
      relative(candidateRoot, sourcePath).replaceAll('\\', '/'),
    );
    // The extraction root matches by its own name ({UNPACKED}); children match
    // as plain names (e.g. 'tool.exe'), as paths relative to the temp root
    // (e.g. 'archive-contents/tool.exe'), and as '{UNPACKED}/tool.exe' so
    // rules like '^{UNPACKED}/llmfit.exe$' work.
    const unpackedName = stripUuidPrefix(rootCandidate ?? relativeToCandidate);
    let candidates = isRoot
      ? [unpackedName, stripUuidPrefix(basename(sourcePath))]
      : [
          relativeToSource,
          relativeToCandidate,
          `${unpackedName}/${relativeToSource}`,
        ];
    if (!sourceIsDirectory) {
      candidates.push(directCandidate ?? basename(sourcePath));
    }
    candidates = [...new Set(candidates.filter((c) => c && c !== '.'))];
    // Extracted folders and anything under them are matched strictly (full-path
    // anchors) so they cannot substring-match download-file rules.
    const strict = sourceIsDirectory;
    for (const copyRule of rule.copy) {
      const parsed = parseCopyRule(copyRule);
      if (!parsed) {
        if (!tracker.invalid.has(copyRule)) {
          tracker.invalid.add(copyRule);
          actions.push({
            variant: variant.name,
            url: link.url,
            status: 'failed',
            error: `Invalid copy rule format: "${copyRule}"`,
            captures,
          });
          await logger.error('Invalid copy rule format', {
            variant: variant.name,
            url: link.url,
            rule: copyRule,
          });
        }
        continue;
      }
      const sourcePattern = expandPlaceholders(parsed.source, captures);
      const destination = expandPlaceholders(parsed.target, captures);
      // Unresolved placeholders mean this rule doesn't apply given the current captures - not an error.
      if (sourcePattern === undefined || destination === undefined) continue;
      tracker.resolved.add(copyRule);
      if (
        !candidates.some((candidate) =>
          matchCandidate(sourcePattern, candidate, strict),
        )
      )
        continue;
      tracker.matched.add(copyRule);
      // For directories, copy the folder itself under its UUID-stripped name;
      // for files the name is the direct candidate (UUID prefix already
      // stripped).
      const destinationDirectory = resolve(targetPath(destination, appDir));
      const destinationName = sourceIsDirectory
        ? stripUuidPrefix(basename(sourcePath))
        : (directCandidate ?? basename(sourcePath));
      const destinationIsFile =
        !sourceIsDirectory &&
        /\.[^/]+$/.test(destinationName) &&
        /\.[^/]+$/.test(destination);
      const destinationPath = destinationIsFile
        ? destinationDirectory
        : join(destinationDirectory, destinationName);
      try {
        await mkdir(
          destinationIsFile
            ? resolve(dirname(destinationPath))
            : destinationDirectory,
          { recursive: true },
        );
        if ((await stat(sourcePath)).isDirectory()) {
          await cp(sourcePath, destinationPath, {
            recursive: true,
            force: true,
          });
        } else {
          await copyFile(sourcePath, destinationPath);
        }
        actions.push({
          variant: variant.name,
          url: link.url,
          status: 'copied',
          path: destinationPath,
          rule: copyRule,
          captures,
        });
        await logger.info('File copied', {
          variant: variant.name,
          url: link.url,
          rule: copyRule,
          source: candidates.join(', '),
          destination: destinationPath,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Copy failed';
        actions.push({
          variant: variant.name,
          url: link.url,
          status: 'failed',
          path: destinationPath,
          rule: copyRule,
          error: message,
          captures,
        });
        await logger.error('File copy failed', {
          variant: variant.name,
          url: link.url,
          rule: copyRule,
          source: candidates.join(', '),
          destination: destinationPath,
          error: message,
        });
      }
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
  tracker: CopyRuleTracker,
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
    const unpacked = stripUuidPrefix(
      relative(root, extracted.root).replaceAll('\\', '/'),
    );
    nestedCaptures.UNPACKED = unpacked;
    actions.push({
      variant: variant.name,
      url: link.url,
      status: 'unpacked',
      path: unpacked,
      captures: nestedCaptures,
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
      tracker,
      undefined,
      nestedCaptures.UNPACKED,
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
      tracker,
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
  actions: ActionResult[] = [],
): Promise<ActionResult[]> {
  await mkdir(config.tempDir, { recursive: true });

  for (const link of links) {
    const name = safeName(link);
    const temporaryPath = join(
      config.tempDir,
      `${crypto.randomUUID()}-${name}`,
    );
    const itemRoot = `${temporaryPath}-contents`;
    const copyRuleTracker = createCopyRuleTracker();
    const fileCaptures: Record<string, string> = { ...link.captures };
    try {
      if (!isAllowedUrl(link.url)) {
        throw new Error('Download host is not allowed');
      }
      const { response } = await fetchAllowed(link.url);
      if (!response.ok) {
        throw new Error(`Download returned HTTP ${response.status}`);
      }
      await Bun.write(temporaryPath, await response.arrayBuffer());
      fileCaptures.DOWNLOADED = name;
      actions.push({
        variant: variant.name,
        url: link.url,
        status: 'downloaded',
        path: name,
        captures: fileCaptures,
      });
      await logger.info('File downloaded', {
        variant: variant.name,
        url: link.url,
        file: name,
      });

      if (
        isArchive(name) &&
        rule.unpack &&
        matchAnyRule(rule.unpack, name, fileCaptures)
      ) {
        const extracted = await extractArchive(temporaryPath, itemRoot);
        const unpacked = stripUuidPrefix(
          relative(config.tempDir, extracted.root).replaceAll('\\', '/'),
        );
        if (unpacked) fileCaptures.UNPACKED = unpacked;
        actions.push({
          variant: variant.name,
          url: link.url,
          status: 'unpacked',
          path: unpacked,
          captures: fileCaptures,
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
          copyRuleTracker,
          undefined,
          fileCaptures.UNPACKED,
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
          copyRuleTracker,
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
        copyRuleTracker,
        name,
        fileCaptures.UNPACKED,
      );
      await reportUnmatchedCopyRules(
        variant,
        link,
        rule,
        fileCaptures,
        copyRuleTracker,
        actions,
        logger,
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Processing failed';
      actions.push({
        variant: variant.name,
        url: link.url,
        status: 'failed',
        error: message,
        captures: fileCaptures,
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
