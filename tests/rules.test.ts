import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import {
  expandPlaceholders,
  deriveNameFromUrl,
  loadRules,
  matchAnyRule,
  matchRule,
  parseCopyRule,
} from '../src/rules.ts';
import { defaultRules } from '../src/variants.ts';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('rules', () => {
  test('matches case-insensitively and stores named captures', () => {
    expect(matchRule('^(?<name>.+)\\.zip$', 'Release.ZIP')).toEqual({
      matched: true,
      captures: { name: 'Release' },
    });
  });

  test('expands placeholders and rejects unresolved values', () => {
    expect(expandPlaceholders('{NAME}/file', { NAME: 'release' })).toBe(
      'release/file',
    );
    expect(expandPlaceholders('{MISSING}', {})).toBeUndefined();
  });

  test('persists captures from a matching rule', () => {
    const captures: Record<string, string> = {};
    expect(matchAnyRule(['(?<EXT>\\.zip)$'], 'archive.zip', captures)).toBe(
      true,
    );
    expect(captures.EXT).toBe('.zip');
  });

  test('splits copy rules at the first colon', () => {
    expect(parseCopyRule('^file$:/app/bin:backup')).toEqual({
      source: '^file$',
      target: '/app/bin:backup',
    });
    expect(parseCopyRule('invalid')).toBeUndefined();
  });

  test('distills a name from a url pattern', () => {
    expect(deriveNameFromUrl('^https://peeplink\\.in/(?<ID>.+)$')).toBe(
      'peeplink-in',
    );
    expect(
      deriveNameFromUrl(
        '^https://github\\.com/(?<ORG>.+)/(?<REPO>.+)/releases/tag/(?<TAG>.+)$',
      ),
    ).toBe('github-com-releases-tag');
  });

  test('writes defaults when missing and rereads changes', async () => {
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
    expect(updated.github[0].url).toBe('^https://example\\.com/.+$');
  });

  test('rejects duplicate variant URL rules', async () => {
    const directory = await mkdtemp(`${tmpdir()}/gexdis-rules-`);
    temporaryDirectories.push(directory);
    const filePath = `${directory}/rules.yml`;
    await Bun.write(
      filePath,
      'variants:\n  github:\n    - url: same\n      get: []\n      copy: []\n    - url: same\n      get: []\n      copy: []\n',
    );
    expect(loadRules(filePath, defaultRules)).rejects.toThrow(
      'Variant github contains duplicate url rules',
    );
  });
});
