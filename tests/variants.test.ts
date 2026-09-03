import { expect, test } from 'bun:test';
import {
  GitHubReleaseVariant,
  defaultRules,
  isAllowedUrl,
  selectVariant,
} from '../src/variants.ts';

const alternateGithubRules = [
  {
    name: 'first',
    url: '^https://github\\.com/(?<ORG>.+)/(?<REPO>.+)/releases/tag/v18\\..+$',
    get: ['first$'],
    copy: [],
  },
  {
    name: 'second',
    url: '^https://github\\.com/(?<ORG>.+)/(?<REPO>.+)/releases/tag/.+$',
    get: ['second$'],
    unpack: ['archive$'],
    copy: [],
  },
];

test('selects a GitHub release variant', () => {
  const selected = selectVariant(
    'https://github.com/acme/tool/releases/tag/v1.0.0',
  );
  expect(selected?.variant.name).toBe('github');
  expect(selected?.captures.ORG).toBe('acme');
});

test('selects the first matching rule set in order', () => {
  const selected = selectVariant(
    'https://github.com/acme/tool/releases/tag/v18.1.3',
    { github: alternateGithubRules, peeplink: defaultRules.peeplink },
  );
  expect(selected?.rule.get).toEqual(['first$']);
  expect(selected?.rule.unpack).toBeUndefined();
});

test('fetches GitHub release assets from the expanded assets endpoint', () => {
  const variant = new GitHubReleaseVariant(defaultRules.github);
  expect(
    variant.pageUrl('https://github.com/can1357/oh-my-pi/releases/tag/v18.1.3'),
  ).toBe(
    'https://github.com/can1357/oh-my-pi/releases/expanded_assets/v18.1.3',
  );
});

test('extracts and deduplicates anchor links', () => {
  const variant = new GitHubReleaseVariant(defaultRules.github);
  const links = variant.extractLinks(
    'https://github.com/acme/tool/releases/tag/v1',
    '<a href="/acme/tool/releases/download/v1/tool.exe">one</a><a href="/acme/tool/releases/download/v1/tool.exe">duplicate</a>',
  );
  expect(links).toHaveLength(1);
  expect(links[0].url).toBe(
    'https://github.com/acme/tool/releases/download/v1/tool.exe',
  );
});

test('allows variant hosts and rejects unrelated hosts', () => {
  expect(isAllowedUrl('https://github.com/acme/tool')).toBe(true);
  expect(isAllowedUrl('https://cdn.github.com/file.zip')).toBe(true);
  expect(isAllowedUrl('https://example.com/file.zip')).toBe(false);
});

test('derives ORG/REPO/TAG from the URL even without regex capture groups', () => {
  const variant = new GitHubReleaseVariant([
    {
      name: 'bare',
      url: '^https://github\\.com/.+/.+/releases/tag/.+$',
      get: [],
      copy: [],
    },
  ]);
  expect(
    variant.matchingRule('https://github.com/acme/tool/releases/tag/v1.0.0')
      ?.captures,
  ).toEqual({ ORG: 'acme', REPO: 'tool', TAG: 'v1.0.0' });
});

test('derives ORG/REPO without TAG for a /releases/latest URL', () => {
  const variant = new GitHubReleaseVariant([
    {
      name: 'bare',
      url: '^https://github\\.com/.+/.+/releases/latest$',
      get: [],
      copy: [],
    },
  ]);
  const captures = variant.matchingRule(
    'https://github.com/acme/tool/releases/latest',
  )?.captures;
  expect(captures).toEqual({ ORG: 'acme', REPO: 'tool' });
});

test('lets an explicit regex capture override the derived value', () => {
  const variant = new GitHubReleaseVariant([
    {
      name: 'custom',
      url: '^https://github\\.com/.+/.+/releases/tag/(?<ORG>.+)$',
      get: [],
      copy: [],
    },
  ]);
  const captures = variant.matchingRule(
    'https://github.com/acme/tool/releases/tag/v1',
  )?.captures;
  // the rule's own (?<ORG>...) group captures the tag segment, which must win over the derived "acme"
  expect(captures?.ORG).toBe('v1');
});
