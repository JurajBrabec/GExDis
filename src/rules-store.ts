import { mkdir, rename } from "node:fs/promises";
import { dirname } from "node:path";
import {
  isMap,
  isScalar,
  isSeq,
  parseDocument,
  type YAMLMap,
  type YAMLSeq,
} from "yaml";
import { validateRulesText } from "./rules.ts";
import { defaultRules } from "./variants.ts";

type RulesDocument = ReturnType<typeof parseDocument>;

export class RuleEditError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

export const RULE_FIELDS = [
  "name",
  "repo",
  "tag",
  "set",
  "get",
  "unpack",
  "remove",
  "copy",
] as const;
const TEXT_FIELDS = ["name", "repo", "tag"] as const;
const LIST_FIELDS = ["get", "unpack", "remove", "copy"] as const;

export interface GithubRuleInput {
  name?: string;
  repo?: string;
  tag?: string;
  set?: Record<string, string>;
  get?: string[];
  unpack?: string[];
  remove?: string[];
  copy?: string[];
}

export function backupPathFor(rulesFile: string): string {
  return `${rulesFile}.bak`;
}

// Writes through a temp file and rename, so a crash never leaves a half-written rules file.
async function writeAtomic(filePath: string, text: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const temp = `${filePath}.tmp`;
  await Bun.write(temp, text);
  await rename(temp, filePath);
}

// Replaces the rules file, keeping the previous version as the single backup.
export async function writeRulesFile(
  rulesFile: string,
  text: string,
): Promise<void> {
  const current = Bun.file(rulesFile);
  if (await current.exists()) {
    await Bun.write(backupPathFor(rulesFile), current);
  }
  await writeAtomic(rulesFile, text);
}

// Swaps the current file with the backup, so a second undo restores the newer version.
export async function undoRulesFile(rulesFile: string): Promise<boolean> {
  const backup = Bun.file(backupPathFor(rulesFile));
  if (!(await backup.exists())) return false;
  const current = Bun.file(rulesFile);
  const currentText = (await current.exists()) ? await current.text() : undefined;
  await writeAtomic(rulesFile, await backup.text());
  if (currentText !== undefined) {
    await writeAtomic(backupPathFor(rulesFile), currentText);
  }
  return true;
}

export function parseGithubRuleInput(value: unknown): GithubRuleInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RuleEditError("The rule must be a JSON object", 400);
  }
  const input = value as Record<string, unknown>;
  for (const key of Object.keys(input)) {
    if (!(RULE_FIELDS as readonly string[]).includes(key)) {
      throw new RuleEditError(`Unknown rule field "${key}"`, 400);
    }
  }
  const result: Record<string, unknown> = {};
  for (const field of TEXT_FIELDS) {
    if (field in input) {
      if (typeof input[field] !== "string") {
        throw new RuleEditError(`"${field}" must be a string`, 400);
      }
      result[field] = input[field];
    }
  }
  if ("set" in input) {
    const set = input.set;
    if (
      !set ||
      typeof set !== "object" ||
      Array.isArray(set) ||
      Object.values(set).some((entry) => typeof entry !== "string")
    ) {
      throw new RuleEditError(`"set" must map names to strings`, 400);
    }
    result.set = { ...(set as Record<string, string>) };
  }
  for (const field of LIST_FIELDS) {
    if (field in input) {
      const list = input[field];
      if (
        !Array.isArray(list) ||
        list.some((entry) => typeof entry !== "string")
      ) {
        throw new RuleEditError(`"${field}" must be a list of strings`, 400);
      }
      result[field] = [...list];
    }
  }
  return result as GithubRuleInput;
}

function parseRulesDocument(text: string): RulesDocument {
  const doc = parseDocument(text);
  if (doc.errors.length > 0) {
    throw new RuleEditError(doc.errors[0].message, 400);
  }
  return doc;
}

function githubSequence(
  doc: RulesDocument,
  create: boolean,
): YAMLSeq | undefined {
  let variants = doc.get("variants", true);
  if (variants === undefined || variants === null) {
    if (!create) return undefined;
    doc.set("variants", doc.createNode({}));
    variants = doc.get("variants", true);
  }
  if (!isMap(variants)) {
    throw new RuleEditError("The variants entry must be a mapping", 400);
  }
  let github = variants.get("github", true);
  if (github === undefined || github === null) {
    if (!create) return undefined;
    variants.set("github", doc.createNode([]));
    github = variants.get("github", true);
  }
  // A single rule written as a mapping is accepted by the loader; normalise it to a list.
  if (isMap(github)) {
    const list = doc.createNode([]) as YAMLSeq;
    list.add(github);
    variants.set("github", list);
    github = variants.get("github", true);
  }
  if (!isSeq(github)) {
    throw new RuleEditError("Variant github must be a list of rules", 400);
  }
  return github;
}

function findGithubItem(seq: YAMLSeq, name: string): number {
  return seq.items.findIndex(
    (item) => isMap(item) && item.get("name") === name,
  );
}

function applyRuleFields(
  doc: RulesDocument,
  item: YAMLMap,
  input: GithubRuleInput,
): void {
  const current = item.toJSON() as Record<string, unknown>;
  for (const field of RULE_FIELDS) {
    if (!(field in input)) continue;
    const value = input[field];
    if (JSON.stringify(current[field] ?? null) === JSON.stringify(value ?? null)) {
      continue;
    }
    const isEmpty =
      value === "" ||
      (Array.isArray(value) && value.length === 0) ||
      (typeof value === "object" &&
        value !== null &&
        !Array.isArray(value) &&
        Object.keys(value).length === 0);
    if (field === "name") {
      item.set(field, doc.createNode(value));
    } else if (LIST_FIELDS.includes(field as (typeof LIST_FIELDS)[number])) {
      // Explicit lists, including empty ones, are written; absent fields are never touched.
      setListItems(doc, item, field, value as string[]);
    } else if (isEmpty) {
      item.delete(field);
    } else {
      item.set(field, doc.createNode(value));
    }
  }
  // A repo written in owner/name form replaces the legacy org and url forms.
  if (typeof input.repo === "string" && input.repo.trim() !== "") {
    item.delete("org");
    item.delete("url");
  }
}

// Reuses existing scalar nodes whose text is unchanged, so their quoting survives.
function setListItems(
  doc: RulesDocument,
  item: YAMLMap,
  field: string,
  values: string[],
): void {
  const existing = item.get(field, true);
  if (!isSeq(existing)) {
    item.set(field, doc.createNode(values));
    return;
  }
  existing.items = values.map((value, index) => {
    const old = existing.items[index];
    return isScalar(old) && old.value === value
      ? old
      : doc.createNode(value);
  });
}

function finalize(doc: RulesDocument): string {
  const text = doc.toString();
  validateRulesText(text, defaultRules);
  return text;
}

export function listGithubRules(text: string): Array<Record<string, unknown>> {
  const seq = githubSequence(parseRulesDocument(text), false);
  return (seq?.toJSON() ?? []) as Array<Record<string, unknown>>;
}

export function addGithubRule(text: string, input: GithubRuleInput): string {
  const doc = parseRulesDocument(text);
  const seq = githubSequence(doc, true) as YAMLSeq;
  const item = doc.createNode({}) as YAMLMap;
  applyRuleFields(doc, item, input);
  seq.add(item);
  return finalize(doc);
}

export function updateGithubRule(
  text: string,
  name: string,
  input: GithubRuleInput,
): string {
  const doc = parseRulesDocument(text);
  const seq = githubSequence(doc, false);
  const index = seq ? findGithubItem(seq, name) : -1;
  if (!seq || index < 0) {
    throw new RuleEditError(`No GitHub rule named "${name}"`, 404);
  }
  applyRuleFields(doc, seq.items[index] as YAMLMap, input);
  return finalize(doc);
}

export function deleteGithubRule(text: string, name: string): string {
  const doc = parseRulesDocument(text);
  const seq = githubSequence(doc, false);
  const index = seq ? findGithubItem(seq, name) : -1;
  if (!seq || index < 0) {
    throw new RuleEditError(`No GitHub rule named "${name}"`, 404);
  }
  seq.items.splice(index, 1);
  return finalize(doc);
}
