import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  expandPlaceholders,
  deriveNameFromUrl,
  loadRules,
  matchAnyRule,
  matchRule,
  parseCopyRule,
} from "../src/rules.ts";
import { defaultRules } from "../src/variants.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("rules", () => {
  test("matches case-insensitively and stores named captures", () => {
    expect(matchRule("^(?<name>.+)\\.zip$", "Release.ZIP")).toEqual({
      matched: true,
      captures: { name: "Release" },
    });
  });

  test("expands placeholders and rejects unresolved values", () => {
    expect(expandPlaceholders("{NAME}/file", { NAME: "release" })).toBe(
      "release/file",
    );
    expect(expandPlaceholders("{MISSING}", {})).toBeUndefined();
  });

  test("persists captures from a matching rule", () => {
    const captures: Record<string, string> = {};
    expect(matchAnyRule(["(?<EXT>\\.zip)$"], "archive.zip", captures)).toBe(
      true,
    );
    expect(captures.EXT).toBe(".zip");
  });

  test("splits copy rules at the first colon", () => {
    expect(parseCopyRule("^file$:/app/bin:backup")).toEqual({
      source: "^file$",
      target: "/app/bin:backup",
    });
    expect(parseCopyRule("invalid")).toBeUndefined();
  });

  test("distills a name from a url pattern", () => {
    expect(deriveNameFromUrl("^https://peeplink\\.in/(?<ID>.+)$")).toBe(
      "peeplink-in",
    );
    expect(
      deriveNameFromUrl(
        "^https://github\\.com/(?<ORG>.+)/(?<REPO>.+)/releases/tag/(?<TAG>.+)$",
      ),
    ).toBe("github-com-releases-tag");
  });

  test("writes defaults when missing and rereads changes", async () => {
    const directory = await mkdtemp(`${tmpdir()}/gexdis-rules-`);
    temporaryDirectories.push(directory);
    const filePath = `${directory}/nested/rules.yml`;

    const initial = await loadRules(filePath, defaultRules);
    expect(initial.github[0].url).toBe(defaultRules.github[0].url);
    expect(await Bun.file(filePath).exists()).toBe(true);

    await Bun.write(
      filePath,
      'variants:\n  github:\n    - url: "^https://example\\\\.com/.+$"\n      get: []\n      copy: []\n',
    );
    const updated = await loadRules(filePath, defaultRules);
    expect(updated.github[0].url).toBe("^https://example\\.com/.+$");
  });

  test("rejects duplicate variant URL rules", async () => {
    const directory = await mkdtemp(`${tmpdir()}/gexdis-rules-`);
    temporaryDirectories.push(directory);
    const filePath = `${directory}/rules.yml`;
    await Bun.write(
      filePath,
      "variants:\n  github:\n    - url: same\n      get: []\n      copy: []\n    - url: same\n      get: []\n      copy: []\n",
    );
    expect(loadRules(filePath, defaultRules)).rejects.toThrow(
      "Variant github contains duplicate url rules",
    );
  });

  test("preserves remove rules through loadRules", async () => {
    const directory = await mkdtemp(`${tmpdir()}/gexdis-rules-`);
    temporaryDirectories.push(directory);
    const filePath = `${directory}/rules.yml`;
    await Bun.write(
      filePath,
      "variants:\n  github:\n    - url: \"^https://example\\\\.com/.+$\"\n      get: []\n      copy: []\n      remove:\n        - '^/app/bin/{EXE_NAME}-v[0-9]+\\.exe$'\n",
    );
    const loaded = await loadRules(filePath, defaultRules);
    expect(loaded.github[0].remove).toEqual([
      "^/app/bin/{EXE_NAME}-v[0-9]+\\.exe$",
    ]);
    // Falls back to defaults when remove is omitted; the github default has no
    // remove rules, so it becomes undefined.
    const written = await loadRules(`${directory}/omitted.yml`, defaultRules);
    expect(written.github[0].remove).toBeUndefined();
  });

  test("constructs url pattern from org/repo/tag for GitHub variant", async () => {
    const directory = await mkdtemp(`${tmpdir()}/gexdis-rules-`);
    temporaryDirectories.push(directory);
    const filePath = `${directory}/rules.yml`;
    await Bun.write(
      filePath,
      "variants:\n  github:\n    - org: acme\n      repo: tool\n      tag: v1.0.0\n      get: []\n      copy: []\n",
    );
    const loaded = await loadRules(filePath, defaultRules);
    expect(loaded.github[0].url).toBe(
      "^https://github\\.com/acme/tool/releases/tag/v1.0.0$",
    );
    expect(loaded.github[0].org).toBe("acme");
    expect(loaded.github[0].repo).toBe("tool");
    expect(loaded.github[0].tag).toBe("v1.0.0");
  });

  test("constructs url pattern with latest when tag is omitted", async () => {
    const directory = await mkdtemp(`${tmpdir()}/gexdis-rules-`);
    temporaryDirectories.push(directory);
    const filePath = `${directory}/rules.yml`;
    await Bun.write(
      filePath,
      "variants:\n  github:\n    - org: acme\n      repo: tool\n      get: []\n      copy: []\n",
    );
    const loaded = await loadRules(filePath, defaultRules);
    expect(loaded.github[0].url).toBe(
      "^https://github\\.com/acme/tool/releases/(tag/.+|latest)$",
    );
  });

  test("constructs url pattern when tag is explicitly set to latest", async () => {
    const directory = await mkdtemp(`${tmpdir()}/gexdis-rules-`);
    temporaryDirectories.push(directory);
    const filePath = `${directory}/rules.yml`;
    await Bun.write(
      filePath,
      "variants:\n  github:\n    - org: acme\n      repo: tool\n      tag: latest\n      get: []\n      copy: []\n",
    );
    const loaded = await loadRules(filePath, defaultRules);
    expect(loaded.github[0].url).toBe(
      "^https://github\\.com/acme/tool/releases/(tag/.+|latest)$",
    );
  });

  test("prefers explicit url over org/repo/tag", async () => {
    const directory = await mkdtemp(`${tmpdir()}/gexdis-rules-`);
    temporaryDirectories.push(directory);
    const filePath = `${directory}/rules.yml`;
    await Bun.write(
      filePath,
      'variants:\n  github:\n    - url: "^https://example\\\\.com/.+$"\n      org: acme\n      repo: tool\n      get: []\n      copy: []\n',
    );
    const loaded = await loadRules(filePath, defaultRules);
    expect(loaded.github[0].url).toBe("^https://example\\.com/.+$");
  });
});
