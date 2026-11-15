import { mkdir, rename } from "node:fs/promises";
import { dirname } from "node:path";
import { parse, stringify } from "yaml";

// One downloaded file. 'tag' is set for variants with a version concept
// (currently github); variants without one (peeplink) rely on 'filename'
// alone to recognize a previously downloaded file.
export interface VersionHistoryEntry {
  timestamp: string;
  filename: string;
  tag?: string;
}

export interface VersionEntry {
  name: string;
  latest?: string;
  history: VersionHistoryEntry[];
}

export type VersionsFile = Record<string, VersionEntry[]>;

// Bounds file growth, in the same spirit as the app's other fixed resource limits.
const MAX_HISTORY_PER_RULE = 20;

async function writeAtomic(filePath: string, text: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const temp = `${filePath}.tmp`;
  await Bun.write(temp, text);
  await rename(temp, filePath);
}

export async function loadVersions(filePath: string): Promise<VersionsFile> {
  const file = Bun.file(filePath);
  if (!(await file.exists())) return {};
  const parsed = parse(await file.text()) as { variants?: VersionsFile } | null;
  return parsed?.variants ?? {};
}

function findEntry(
  entries: VersionEntry[],
  name: string,
): VersionEntry | undefined {
  return entries.find((entry) => entry.name === name);
}

export function findVersionEntry(
  versions: VersionsFile,
  variant: string,
  ruleName: string,
): VersionEntry | undefined {
  return findEntry(versions[variant] ?? [], ruleName);
}

// The most recent history entry for a given downloaded filename. Variants
// without a version concept (peeplink) use this to recognize a repeat download.
export function findDownloadedFile(
  entry: VersionEntry | undefined,
  filename: string,
): VersionHistoryEntry | undefined {
  if (!entry) return undefined;
  for (let i = entry.history.length - 1; i >= 0; i--) {
    if (entry.history[i].filename === filename) return entry.history[i];
  }
  return undefined;
}

// The history entry that recorded the currently tracked latest tag, so
// callers can report when that version was downloaded.
export function findLatestEntry(
  entry: VersionEntry | undefined,
): VersionHistoryEntry | undefined {
  if (!entry?.latest) return undefined;
  for (let i = entry.history.length - 1; i >= 0; i--) {
    if (entry.history[i].tag === entry.latest) return entry.history[i];
  }
  return undefined;
}

// Serializes reads/writes within this process so concurrent jobs recording
// downloads cannot clobber one another's updates.
let writeQueue: Promise<unknown> = Promise.resolve();

function serialize<T>(operation: () => Promise<T>): Promise<T> {
  const run = writeQueue.then(operation);
  writeQueue = run.catch(() => undefined);
  return run;
}

// Records one completed download: appends a history entry and, for variants
// that pass a tag, updates 'latest' to it.
export function recordDownload(
  filePath: string,
  variant: string,
  ruleName: string,
  download: { filename: string; tag?: string; timestamp?: string },
): Promise<void> {
  return serialize(async () => {
    const versions = await loadVersions(filePath);
    const list = versions[variant] ?? [];
    versions[variant] = list;
    let entry = findEntry(list, ruleName);
    if (!entry) {
      entry = { name: ruleName, history: [] };
      list.push(entry);
    }
    entry.history.push({
      timestamp: download.timestamp ?? new Date().toISOString(),
      filename: download.filename,
      ...(download.tag ? { tag: download.tag } : {}),
    });
    if (entry.history.length > MAX_HISTORY_PER_RULE) {
      entry.history.splice(0, entry.history.length - MAX_HISTORY_PER_RULE);
    }
    if (download.tag) entry.latest = download.tag;
    await writeAtomic(filePath, stringify({ variants: versions }));
  });
}
