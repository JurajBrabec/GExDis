import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { parse, stringify } from 'yaml';

export interface RuleSet {
  name: string;
  url: string;
  get: string[];
  unpack?: string[];
  copy: string[];
  remove?: string[];
}

export function deriveNameFromUrl(pattern: string): string {
  const withoutAnchors = pattern.replace(/^\^/, '').replace(/\$$/, '');
  const withoutGroups = withoutAnchors.replace(
    /\(\?<[A-Za-z0-9_]+>[^)]*\)/g,
    '',
  );
  const unescaped = withoutGroups.replace(/\\(.)/g, '$1');
  const withoutProtocol = unescaped.replace(/^[a-zA-Z]+:\/\//, '');
  const slug = withoutProtocol
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'variant';
}

export interface RuleMatch {
  matched: boolean;
  captures: Record<string, string>;
}

export function matchRule(pattern: string, candidate: string): RuleMatch {
  const match = new RegExp(pattern, 'i').exec(candidate);
  if (!match) {
    return { matched: false, captures: {} };
  }

  const captures: Record<string, string> = {};
  for (const [name, value] of Object.entries(match.groups ?? {})) {
    if (value !== undefined) {
      captures[name] = value;
    }
  }
  return { matched: true, captures };
}

export function expandPlaceholders(
  value: string,
  captures: Record<string, string>,
): string | undefined {
  let unresolved = false;
  const expanded = value.replace(
    /\{([A-Za-z][A-Za-z0-9_]*)\}/g,
    (_placeholder, name: string) => {
      const replacement = captures[name];
      if (replacement === undefined) {
        unresolved = true;
        return '';
      }
      return replacement;
    },
  );
  return unresolved ? undefined : expanded;
}

export function matchAnyRule(
  patterns: string[],
  candidate: string,
  captures: Record<string, string>,
): boolean {
  for (const pattern of patterns) {
    const expanded = expandPlaceholders(pattern, captures);
    if (expanded === undefined) {
      continue;
    }
    const result = matchRule(expanded, candidate);
    if (result.matched) {
      Object.assign(captures, result.captures);
      return true;
    }
  }
  return false;
}

export function parseCopyRule(
  rule: string,
): { source: string; target: string } | undefined {
  const separator = rule.indexOf(':');
  if (separator < 1 || separator === rule.length - 1) {
    return undefined;
  }
  return {
    source: rule.slice(0, separator),
    target: rule.slice(separator + 1),
  };
}

export async function loadRules(
  filePath: string,
  fallback: Record<string, RuleSet[]>,
): Promise<Record<string, RuleSet[]>> {
  const file = Bun.file(filePath);
  if (!(await file.exists())) {
    await mkdir(dirname(filePath), { recursive: true });
    await Bun.write(filePath, stringify({ variants: fallback }));
  }
  const document = parse(await Bun.file(filePath).text()) as {
    variants?: Record<string, Partial<RuleSet>[] | Partial<RuleSet>>;
  };
  const variants = document.variants ?? {};
  return Object.fromEntries(
    Object.entries(fallback).map(([name, defaults]) => {
      const configuredValue = variants[name];
      const configured = configuredValue
        ? Array.isArray(configuredValue)
          ? configuredValue
          : [configuredValue]
        : [];
      const resolvedRules =
        configured.length > 0
          ? configured.map((rule, index) => {
              const url = rule.url ?? defaults[index]?.url ?? defaults[0].url;
              return {
                name:
                  rule.name ?? defaults[index]?.name ?? deriveNameFromUrl(url),
                url,
                get: rule.get ?? defaults[index]?.get ?? defaults[0].get,
                unpack:
                  rule.unpack ?? defaults[index]?.unpack ?? defaults[0].unpack,
                copy: rule.copy ?? defaults[index]?.copy ?? defaults[0].copy,
                remove:
                  rule.remove ?? defaults[index]?.remove ?? defaults[0].remove,
              };
            })
          : defaults;
      if (
        new Set(resolvedRules.map((rule) => rule.url)).size !==
        resolvedRules.length
      ) {
        throw new Error(`Variant ${name} contains duplicate url rules`);
      }
      return [name, resolvedRules];
    }),
  );
}
