import {
  matchAnyRule,
  matchRule,
  deriveNameFromUrl,
  type RuleSet,
} from './rules.ts';

export interface PageLink {
  url: string;
  path: string;
}

export interface DownloadLink extends PageLink {
  captures: Record<string, string>;
}

export abstract class Variant {
  protected constructor(
    public readonly name: string,
    protected readonly rules: RuleSet[],
  ) {}

  validateUrl(url: string): Record<string, string> | undefined {
    return this.matchingRule(url)?.captures;
  }

  matchingRule(
    url: string,
  ): { rule: RuleSet; captures: Record<string, string> } | undefined {
    for (const rule of this.rules) {
      const result = matchRule(rule.url, url);
      if (result.matched) {
        return {
          rule,
          captures: { ...this.deriveCaptures(url), ...result.captures },
        };
      }
    }
    return undefined;
  }

  // Structural captures derived from the URL itself, e.g. path segments; explicit regex captures win on conflict.
  deriveCaptures(_url: string): Record<string, string> {
    return {};
  }

  pageUrl(url: string): string {
    return url;
  }

  abstract extractLinks(pageUrl: string, html: string): PageLink[];

  matchingDownloads(
    links: PageLink[],
    captures: Record<string, string>,
    rule = this.rules[0],
  ): DownloadLink[] {
    const matches: DownloadLink[] = [];
    for (const link of links) {
      const linkCaptures = { ...captures };
      if (matchAnyRule(rule.get, link.url, linkCaptures)) {
        matches.push({ ...link, captures: linkCaptures });
      }
    }
    return matches;
  }
}

function extractAnchorLinks(pageUrl: string, html: string): PageLink[] {
  const page = new URL(pageUrl);
  const links: PageLink[] = [];
  const seen = new Set<string>();
  const anchorPattern = /<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/gi;

  for (const match of html.matchAll(anchorPattern)) {
    try {
      const resolved = new URL(match[1], page).toString();
      if (!/^https?:$/.test(new URL(resolved).protocol) || seen.has(resolved)) {
        continue;
      }
      seen.add(resolved);
      links.push({ url: resolved, path: new URL(resolved).pathname });
    } catch {
      continue;
    }
  }
  return links;
}

const githubUrlPattern =
  /^\/(?<ORG>[^/]+)\/(?<REPO>[^/]+)\/releases\/(?:tag\/(?<TAG>[^/]+)|latest)\/?$/;

export class GitHubReleaseVariant extends Variant {
  constructor(rules: RuleSet[]) {
    super('github', rules);
  }

  deriveCaptures(url: string): Record<string, string> {
    const match = githubUrlPattern.exec(new URL(url).pathname);
    if (!match?.groups) return {};
    const captures: Record<string, string> = {
      ORG: match.groups.ORG,
      REPO: match.groups.REPO,
    };
    if (match.groups.TAG) captures.TAG = match.groups.TAG;
    return captures;
  }

  pageUrl(url: string): string {
    return url.replace('/releases/tag/', '/releases/expanded_assets/');
  }

  extractLinks(pageUrl: string, html: string): PageLink[] {
    return extractAnchorLinks(pageUrl, html);
  }
}

export class PeeplinkVariant extends Variant {
  constructor(rules: RuleSet[]) {
    super('peeplink', rules);
  }

  extractLinks(pageUrl: string, html: string): PageLink[] {
    return extractAnchorLinks(pageUrl, html);
  }
}

export const defaultRules: Record<string, RuleSet[]> = {
  github: [
    {
      name: deriveNameFromUrl(
        '^https://github\\.com/[^/]+/[^/]+/releases/tag/.+$',
      ),
      url: '^https://github\\.com/[^/]+/[^/]+/releases/tag/.+$',
      get: ['(?<EXE_NAME>[^/]+\\.exe)$', '(?<ZIP_NAME>[^/]+\\.zip)$'],
      unpack: ['^{ZIP_NAME}$'],
      copy: [
        '^{EXE_NAME}$:/app/bin',
        '^{ZIP_NAME}$:/app/download',
        '^{UNPACKED}/.+\\.exe$:/app/bin',
      ],
    },
  ],
  peeplink: [
    {
      name: deriveNameFromUrl('^https://peeplink\\.in/(?<ID>.+)$'),
      url: '^https://peeplink\\.in/(?<ID>.+)$',
      get: ['^https://rg\\.to/.+', '^https://rapidgator\\.net/.+'],
      unpack: ['^{DOWNLOADED}$'],
      copy: ['^{UNPACKED}$:/app/release'],
    },
  ],
};

export function selectVariant(
  url: string,
  rules = defaultRules,
):
  | {
      variant: Variant;
      rule: RuleSet;
      captures: Record<string, string>;
    }
  | undefined {
  const candidates = [
    new GitHubReleaseVariant(rules.github),
    new PeeplinkVariant(rules.peeplink),
  ];
  const matches = candidates
    .map((variant) => ({ variant, match: variant.matchingRule(url) }))
    .filter(
      (
        entry,
      ): entry is {
        variant: Variant;
        match: { rule: RuleSet; captures: Record<string, string> };
      } => entry.match !== undefined,
    );
  if (matches.length !== 1) {
    return undefined;
  }
  const { variant, match } = matches[0];
  return {
    variant,
    rule: match.rule,
    captures: match.captures,
  };
}

const allowedHosts = [
  'github.com',
  'githubusercontent.com',
  'peeplink.in',
  'rg.to',
  'rapidgator.net',
];

export function isAllowedUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol)) {
      return false;
    }
    const hostname = url.hostname.toLowerCase();
    return allowedHosts.some(
      (host) => hostname === host || hostname.endsWith(`.${host}`),
    );
  } catch {
    return false;
  }
}
