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
  const updated = `variants:\n  github:\n    - url: ^https://example\\.com/(?<ID>.+)$\n      get: []\n      copy: []\n`;
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
  const duplicate = `variants:\n  github:\n    - url: ^https://example\\.com$\n      get: []\n      copy: []\n    - url: ^https://example\\.com$\n      get: []\n      copy: []\n`;
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
  const invalidRegex = `variants:\n  github:\n    - url: ^https://example\\.com$\n      get:\n        - ([unclosed\n      copy: []\n`;
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
