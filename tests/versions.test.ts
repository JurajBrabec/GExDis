import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  findDownloadedFile,
  findLatestEntry,
  findVersionEntry,
  loadVersions,
  recordDownload,
} from "../src/versions.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

test("returns an empty versions file when none exists yet", async () => {
  const directory = await mkdtemp(join(tmpdir(), "gexdis-versions-"));
  temporaryDirectories.push(directory);
  const versionsFile = join(directory, "versions.yml");

  expect(await loadVersions(versionsFile)).toEqual({});
});

test("records a github download, tracking tag history and latest", async () => {
  const directory = await mkdtemp(join(tmpdir(), "gexdis-versions-"));
  temporaryDirectories.push(directory);
  const versionsFile = join(directory, "versions.yml");

  await recordDownload(versionsFile, "github", "acme-tool", {
    filename: "tool-v1.0.0.exe",
    tag: "v1.0.0",
    timestamp: "2026-01-01T00:00:00.000Z",
  });
  await recordDownload(versionsFile, "github", "acme-tool", {
    filename: "tool-v1.1.0.exe",
    tag: "v1.1.0",
    timestamp: "2026-02-01T00:00:00.000Z",
  });

  const versions = await loadVersions(versionsFile);
  const entry = findVersionEntry(versions, "github", "acme-tool");
  expect(entry?.latest).toBe("v1.1.0");
  expect(entry?.history).toEqual([
    {
      timestamp: "2026-01-01T00:00:00.000Z",
      filename: "tool-v1.0.0.exe",
      tag: "v1.0.0",
    },
    {
      timestamp: "2026-02-01T00:00:00.000Z",
      filename: "tool-v1.1.0.exe",
      tag: "v1.1.0",
    },
  ]);

  const latestEntry = findLatestEntry(entry);
  expect(latestEntry?.timestamp).toBe("2026-02-01T00:00:00.000Z");

  const downloaded = findDownloadedFile(entry, "tool-v1.0.0.exe");
  expect(downloaded?.timestamp).toBe("2026-01-01T00:00:00.000Z");
  expect(findDownloadedFile(entry, "unknown.exe")).toBeUndefined();
});

test("records a peeplink download without a tag, relying on filename history", async () => {
  const directory = await mkdtemp(join(tmpdir(), "gexdis-versions-"));
  temporaryDirectories.push(directory);
  const versionsFile = join(directory, "versions.yml");

  await recordDownload(versionsFile, "peeplink", "default", {
    filename: "archive.rar",
    timestamp: "2026-03-01T00:00:00.000Z",
  });

  const versions = await loadVersions(versionsFile);
  const entry = findVersionEntry(versions, "peeplink", "default");
  expect(entry?.latest).toBeUndefined();
  expect(entry?.history).toEqual([
    { timestamp: "2026-03-01T00:00:00.000Z", filename: "archive.rar" },
  ]);
  expect(findDownloadedFile(entry, "archive.rar")?.timestamp).toBe(
    "2026-03-01T00:00:00.000Z",
  );
  expect(findDownloadedFile(entry, "other.rar")).toBeUndefined();
});

test("bounds history length per rule", async () => {
  const directory = await mkdtemp(join(tmpdir(), "gexdis-versions-"));
  temporaryDirectories.push(directory);
  const versionsFile = join(directory, "versions.yml");

  for (let i = 0; i < 25; i++) {
    await recordDownload(versionsFile, "github", "acme-tool", {
      filename: `tool-v${i}.exe`,
      tag: `v${i}`,
      timestamp: `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00.000Z`,
    });
  }

  const versions = await loadVersions(versionsFile);
  const entry = findVersionEntry(versions, "github", "acme-tool");
  expect(entry?.history.length).toBe(20);
  expect(entry?.history[0].filename).toBe("tool-v5.exe");
  expect(entry?.latest).toBe("v24");
});

test("keeps separate history per rule name within a variant", async () => {
  const directory = await mkdtemp(join(tmpdir(), "gexdis-versions-"));
  temporaryDirectories.push(directory);
  const versionsFile = join(directory, "versions.yml");

  await recordDownload(versionsFile, "github", "rule-a", {
    filename: "a.exe",
    tag: "v1",
  });
  await recordDownload(versionsFile, "github", "rule-b", {
    filename: "b.exe",
    tag: "v2",
  });

  const versions = await loadVersions(versionsFile);
  expect(findVersionEntry(versions, "github", "rule-a")?.latest).toBe("v1");
  expect(findVersionEntry(versions, "github", "rule-b")?.latest).toBe("v2");
});

test("writes a human-readable versions.yml structure", async () => {
  const directory = await mkdtemp(join(tmpdir(), "gexdis-versions-"));
  temporaryDirectories.push(directory);
  const versionsFile = join(directory, "versions.yml");

  await recordDownload(versionsFile, "github", "acme-tool", {
    filename: "tool.exe",
    tag: "v1.0.0",
    timestamp: "2026-01-01T00:00:00.000Z",
  });

  const text = await readFile(versionsFile, "utf8");
  expect(text).toContain("variants:");
  expect(text).toContain("github:");
  expect(text).toContain("name: acme-tool");
  expect(text).toContain("latest: v1.0.0");
  expect(text).toContain("history:");
});
