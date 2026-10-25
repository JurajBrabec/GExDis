import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let cleanup: (() => Promise<void>) | undefined;
let importCounter = 0;

afterEach(async () => {
  await cleanup?.();
  cleanup = undefined;
});

const VALID_RULES = `# example rules
variants:
  github:
    - name: tool
      url: ^https://github\\.com/acme/tool/releases/tag/(?<TAG>.+)$
      get:
        - (?<NAME>[^/]+\\.exe)$
      copy:
        - ^{NAME}$:/app/bin
`;

async function start(
  rulesText: string,
  token?: string,
): Promise<{
  appDir: string;
  rulesFile: string;
  handleRequest: (request: Request) => Promise<Response>;
  server: { stop: () => Promise<void> };
}> {
  const directory = await mkdtemp(join(tmpdir(), "gexdis-rules-"));
  const appDir = join(directory, "app");
  const configDir = join(appDir, "config");
  const rulesFile = join(configDir, "rules.yml");
  await mkdir(configDir, { recursive: true });
  await Bun.write(rulesFile, rulesText);

  const environment = {
    APP_DIR: appDir,
    CONFIG_DIR: configDir,
    RULES_FILE: rulesFile,
    TMP_DIR: join(appDir, "tmp"),
    DOWNLOAD_DIR: join(appDir, "download"),
    RELEASE_DIR: join(appDir, "release"),
    BIN_DIR: join(appDir, "bin"),
    LOG_DIR: join(appDir, "log"),
    PORT: "0",
    ...(token ? { RULES_TOKEN: token } : {}),
  };
  const previousEnvironment = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(environment)) {
    previousEnvironment.set(key, process.env[key]);
    process.env[key] = value;
  }

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response("")) as unknown as typeof fetch;

  const { handleRequest, server } = await import(
    `../src/main.ts?rules-api-${importCounter}`
  );
  importCounter += 1;
  cleanup = async () => {
    globalThis.fetch = originalFetch;
    await server.stop();
    for (const [key, value] of previousEnvironment) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(directory, { recursive: true, force: true });
  };
  return { appDir, rulesFile, handleRequest, server };
}

test("GET /api/rules returns the current YAML as raw text", async () => {
  const { handleRequest } = await start(VALID_RULES);
  const response = await handleRequest(
    new Request("http://localhost/api/rules"),
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("text/yaml");
  expect(await response.text()).toBe(VALID_RULES);
});

test("PUT /api/rules persists valid YAML verbatim", async () => {
  const { handleRequest, rulesFile } = await start(VALID_RULES);
  const updated = `variants:\n  github:\n    - name: example\n      url: ^https://example\\.com/(?<ID>.+)$\n      get: []\n      copy: []\n`;
  const response = await handleRequest(
    new Request("http://localhost/api/rules", {
      method: "PUT",
      body: updated,
    }),
  );
  expect(response.status).toBe(200);
  const fileText = await Bun.file(rulesFile).text();
  expect(fileText).toBe(updated);

  // Round-trip: GET reflects the new content.
  const getResponse = await handleRequest(
    new Request("http://localhost/api/rules"),
  );
  expect(await getResponse.text()).toBe(updated);
});

test("PUT /api/rules rejects malformed YAML with 400 and does not write", async () => {
  const { handleRequest, rulesFile } = await start(VALID_RULES);
  const before = await Bun.file(rulesFile).text();
  const badYaml = `variants:\n  github:\n    - url: [unclosed\n`;
  const response = await handleRequest(
    new Request("http://localhost/api/rules", {
      method: "PUT",
      body: badYaml,
    }),
  );
  expect(response.status).toBe(400);
  const body = (await response.json()) as { error: string };
  expect(body.error).toBeTruthy();
  expect(await Bun.file(rulesFile).text()).toBe(before);
});

test("PUT /api/rules rejects duplicate url rules with 400", async () => {
  const { handleRequest } = await start(VALID_RULES);
  const duplicate = `variants:\n  github:\n    - name: first\n      url: ^https://example\\.com$\n      get: []\n      copy: []\n    - name: second\n      url: ^https://example\\.com$\n      get: []\n      copy: []\n`;
  const response = await handleRequest(
    new Request("http://localhost/api/rules", {
      method: "PUT",
      body: duplicate,
    }),
  );
  expect(response.status).toBe(400);
  const body = (await response.json()) as { error: string };
  expect(body.error).toContain("duplicate url");
});

test("PUT /api/rules rejects invalid regexes with 400", async () => {
  const { handleRequest } = await start(VALID_RULES);
  const invalidRegex = `variants:\n  github:\n    - name: example\n      url: ^https://example\\.com$\n      get:\n        - ([unclosed\n      copy: []\n`;
  const response = await handleRequest(
    new Request("http://localhost/api/rules", {
      method: "PUT",
      body: invalidRegex,
    }),
  );
  expect(response.status).toBe(400);
  const body = (await response.json()) as { error: string };
  expect(body.error).toContain("invalid get regex");
});

test("PUT /api/rules rejects GitHub rules without a name", async () => {
  const { handleRequest } = await start(VALID_RULES);
  const response = await handleRequest(
    new Request("http://localhost/api/rules", {
      method: "PUT",
      body: `variants:\n  github:\n    - url: ^https://example\\.com$\n      get: []\n      copy: []\n`,
    }),
  );
  expect(response.status).toBe(400);
  const body = (await response.json()) as { error: string };
  expect(body.error).toContain("non-empty 'name'");
});

test("rules endpoints require the token when RULES_TOKEN is set", async () => {
  const { handleRequest } = await start(VALID_RULES, "secret");
  const get = await handleRequest(new Request("http://localhost/api/rules"));
  expect(get.status).toBe(401);

  const put = await handleRequest(
    new Request("http://localhost/api/rules", {
      method: "PUT",
      body: VALID_RULES,
    }),
  );
  expect(put.status).toBe(401);

  const goodGet = await handleRequest(
    new Request("http://localhost/api/rules", {
      headers: { "x-rules-token": "secret" },
    }),
  );
  expect(goodGet.status).toBe(200);
});

test("/editor serves the editor page HTML", async () => {
  const { handleRequest } = await start(VALID_RULES);
  const response = await handleRequest(new Request("http://localhost/editor"));
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("text/html");
  const html = await response.text();
  expect(html).toContain("rules.yml");
});

const COMMENTED_RULES = `# keep me
variants:
  github:
    # first rule
    - name: tool
      repo: acme/tool
      get:
        - (?<NAME>[^/]+\\.exe)$ # asset
      copy:
        - ^{NAME}$:/app/bin
    - name: other
      repo: acme/other
      get:
        - other\\.zip$
      copy:
        - ^{DOWNLOADED}$:/app/download
`;

test("PUT /api/rules keeps the previous file as a backup and undo swaps it back", async () => {
  const { handleRequest, rulesFile } = await start(VALID_RULES);
  const updated = `variants:\n  github:\n    - name: example\n      repo: acme/example\n      get: []\n      copy: []\n`;
  await handleRequest(
    new Request("http://localhost/api/rules", { method: "PUT", body: updated }),
  );
  expect(await Bun.file(`${rulesFile}.bak`).text()).toBe(VALID_RULES);
  const backup = await handleRequest(new Request("http://localhost/api/rules/backup"));
  expect(await backup.json()).toEqual({ available: true });

  const undo = await handleRequest(
    new Request("http://localhost/api/rules/undo", { method: "POST" }),
  );
  expect(undo.status).toBe(200);
  expect(await Bun.file(rulesFile).text()).toBe(VALID_RULES);
  expect(await Bun.file(`${rulesFile}.bak`).text()).toBe(updated);
});

test("undo without a backup returns 404 and backup reports unavailable", async () => {
  const { handleRequest } = await start(VALID_RULES);
  const backup = await handleRequest(new Request("http://localhost/api/rules/backup"));
  expect(await backup.json()).toEqual({ available: false });
  const undo = await handleRequest(
    new Request("http://localhost/api/rules/undo", { method: "POST" }),
  );
  expect(undo.status).toBe(404);
});

test("POST /api/rules/validate reports invalid YAML without writing", async () => {
  const { handleRequest, rulesFile } = await start(VALID_RULES);
  const bad = await handleRequest(
    new Request("http://localhost/api/rules/validate", {
      method: "POST",
      body: `variants:\n  github:\n    - url: [unclosed\n`,
    }),
  );
  expect(bad.status).toBe(400);
  const good = await handleRequest(
    new Request("http://localhost/api/rules/validate", {
      method: "POST",
      body: COMMENTED_RULES,
    }),
  );
  expect(good.status).toBe(200);
  expect(await Bun.file(rulesFile).text()).toBe(VALID_RULES);
});

test("GET /api/rules/github lists GitHub rules as structured JSON", async () => {
  const { handleRequest } = await start(COMMENTED_RULES);
  const response = await handleRequest(new Request("http://localhost/api/rules/github"));
  const body = (await response.json()) as { rules: Array<{ name: string; repo: string }> };
  expect(body.rules.map((rule) => [rule.name, rule.repo])).toEqual([
    ["tool", "acme/tool"],
    ["other", "acme/other"],
  ]);
});

test("PUT /api/rules/github/:name updates one rule and keeps comments and order", async () => {
  const { handleRequest, rulesFile } = await start(COMMENTED_RULES);
  const response = await handleRequest(
    new Request("http://localhost/api/rules/github/tool", {
      method: "PUT",
      body: JSON.stringify({
        name: "tool",
        repo: "acme/tool",
        tag: "cli-{SEMVER}",
        set: { PATTERN: "tool-{SEMVER}\\.exe$" },
        get: ["{PATTERN}"],
        copy: ["^{DOWNLOADED}$:/app/bin"],
      }),
    }),
  );
  expect(response.status).toBe(200);
  const text = await Bun.file(rulesFile).text();
  expect(text).toContain("# keep me");
  expect(text).toContain("# first rule");
  expect(text).toContain("other\\.zip$");
  expect(text.indexOf("name: tool")).toBeLessThan(text.indexOf("name: other"));
  expect(text).toContain("tag: cli-{SEMVER}");
  expect(text).not.toContain("(?<NAME>");
});

test("PUT /api/rules/github/:name with preview=true returns text without writing", async () => {
  const { handleRequest, rulesFile } = await start(COMMENTED_RULES);
  const response = await handleRequest(
    new Request("http://localhost/api/rules/github/other?preview=true", {
      method: "PUT",
      body: JSON.stringify({ name: "other", repo: "acme/renamed" }),
    }),
  );
  const body = (await response.json()) as { text: string };
  expect(body.text).toContain("repo: acme/renamed");
  expect(await Bun.file(rulesFile).text()).toBe(COMMENTED_RULES);
});

test("POST and DELETE /api/rules/github add and remove rules", async () => {
  const { handleRequest, rulesFile } = await start(COMMENTED_RULES);
  const added = await handleRequest(
    new Request("http://localhost/api/rules/github", {
      method: "POST",
      body: JSON.stringify({
        name: "new",
        repo: "acme/new",
        get: ["new\\.zip$"],
        copy: ["^{DOWNLOADED}$:/app/download"],
      }),
    }),
  );
  expect(added.status).toBe(200);
  expect(await Bun.file(rulesFile).text()).toContain("name: new");

  const removed = await handleRequest(
    new Request("http://localhost/api/rules/github/tool", { method: "DELETE" }),
  );
  expect(removed.status).toBe(200);
  const text = await Bun.file(rulesFile).text();
  expect(text).not.toContain("name: tool");
  expect(text).toContain("# keep me");
});

test("structured edits reject duplicate names, unknown fields and missing rules", async () => {
  const { handleRequest, rulesFile } = await start(COMMENTED_RULES);
  const duplicate = await handleRequest(
    new Request("http://localhost/api/rules/github", {
      method: "POST",
      body: JSON.stringify({ name: "tool", repo: "acme/tool" }),
    }),
  );
  expect(duplicate.status).toBe(400);
  const unknown = await handleRequest(
    new Request("http://localhost/api/rules/github", {
      method: "POST",
      body: JSON.stringify({ name: "x", repo: "a/b", org: "a" }),
    }),
  );
  expect(unknown.status).toBe(400);
  const missing = await handleRequest(
    new Request("http://localhost/api/rules/github/nope", {
      method: "PUT",
      body: JSON.stringify({ name: "nope" }),
    }),
  );
  expect(missing.status).toBe(404);
  expect(await Bun.file(rulesFile).text()).toBe(COMMENTED_RULES);
});

test("GET /api/github/assets rejects malformed repositories", async () => {
  const { handleRequest } = await start(VALID_RULES);
  const response = await handleRequest(
    new Request("http://localhost/api/github/assets?repo=not-a-repo"),
  );
  expect(response.status).toBe(400);
});

test("GET /api/github/assets lists release download names", async () => {
  const { handleRequest } = await start(VALID_RULES);
  globalThis.fetch = (async () =>
    new Response(
      '<a href="/acme/tool/releases/download/v1.2.3/tool-1.2.3-x64.exe">exe</a>' +
        '<a href="/acme/tool/releases/tag/v1.2.3">tag</a>' +
        '<a href="/acme/tool/releases/download/v1.2.3/tool%20notes.txt">notes</a>',
    )) as unknown as typeof fetch;
  const response = await handleRequest(
    new Request("http://localhost/api/github/assets?repo=acme/tool&tag=v1.2.3"),
  );
  expect(response.status).toBe(200);
  const body = (await response.json()) as { assets: string[] };
  expect(body.assets).toEqual(["tool-1.2.3-x64.exe", "tool notes.txt"]);
});

const MINIMAL_RULES = `variants:\n  github:\n    - name: min\n      repo: acme/min\n`;

test("partial PUT leaves absent get and copy absent", async () => {
  const { handleRequest, rulesFile } = await start(MINIMAL_RULES);
  const response = await handleRequest(
    new Request("http://localhost/api/rules/github/min", {
      method: "PUT",
      body: JSON.stringify({ name: "min", repo: "acme/min", tag: "v1" }),
    }),
  );
  expect(response.status).toBe(200);
  const text = await Bun.file(rulesFile).text();
  expect(text).toContain("tag: v1");
  expect(text).not.toContain("get:");
  expect(text).not.toContain("copy:");
});

test("explicit empty unpack list is persisted", async () => {
  const { handleRequest, rulesFile } = await start(MINIMAL_RULES);
  await handleRequest(
    new Request("http://localhost/api/rules/github", {
      method: "POST",
      body: JSON.stringify({ name: "x", repo: "a/b", unpack: [], get: ["x\\.exe$"], copy: [] }),
    }),
  );
  expect(await Bun.file(rulesFile).text()).toContain("unpack: []");
});

test("saving a repo removes legacy org and url keys", async () => {
  const legacy = `variants:\n  github:\n    - name: o\n      org: acme\n      repo: tool\n      url: https://example.invalid/x\n      get: []\n      copy: []\n`;
  const { handleRequest, rulesFile } = await start(legacy);
  await handleRequest(
    new Request("http://localhost/api/rules/github/o", {
      method: "PUT",
      body: JSON.stringify({ name: "o", repo: "acme/tool" }),
    }),
  );
  const text = await Bun.file(rulesFile).text();
  expect(text).toContain("repo: acme/tool");
  expect(text).not.toContain("org:");
  expect(text).not.toContain("url:");
});

test("a single github mapping is listed and normalised to a list on edit", async () => {
  const single = `variants:\n  github:\n    name: solo\n    repo: a/solo\n    get:\n      - solo\\.zip$\n    copy:\n      - ^{DOWNLOADED}$:/app/download/\n`;
  const { handleRequest, rulesFile } = await start(single);
  const list = await handleRequest(new Request("http://localhost/api/rules/github"));
  const body = (await list.json()) as { rules: Array<{ name: string }> };
  expect(body.rules.map((rule) => rule.name)).toEqual(["solo"]);

  const edit = await handleRequest(
    new Request("http://localhost/api/rules/github/solo", {
      method: "PUT",
      body: JSON.stringify({ name: "solo", repo: "a/solo", tag: "v2" }),
    }),
  );
  expect(edit.status).toBe(200);
  expect(await Bun.file(rulesFile).text()).toContain("- name: solo");
});

test("deleting the last rule leaves an empty github list", async () => {
  const { handleRequest, rulesFile } = await start(MINIMAL_RULES);
  const response = await handleRequest(
    new Request("http://localhost/api/rules/github/min", { method: "DELETE" }),
  );
  expect(response.status).toBe(200);
  expect(await Bun.file(rulesFile).text()).toContain("github: []");
});

test("concurrent structured adds are both kept", async () => {
  const { handleRequest, rulesFile } = await start(MINIMAL_RULES);
  const add = (name: string) =>
    handleRequest(
      new Request("http://localhost/api/rules/github", {
        method: "POST",
        body: JSON.stringify({ name, repo: `acme/${name}` }),
      }),
    );
  const results = await Promise.all([add("one"), add("two"), add("three")]);
  expect(results.map((result) => result.status)).toEqual([200, 200, 200]);
  const text = await Bun.file(rulesFile).text();
  for (const name of ["one", "two", "three"]) {
    expect(text).toContain(`name: ${name}`);
  }
});

test("PUT /api/rules with an empty body is rejected with 400", async () => {
  const { handleRequest } = await start(VALID_RULES);
  const response = await handleRequest(
    new Request("http://localhost/api/rules", {
      method: "PUT",
      body: "   ",
    }),
  );
  expect(response.status).toBe(400);
});
