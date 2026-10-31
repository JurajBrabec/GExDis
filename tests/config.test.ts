import { expect, test } from "bun:test";
import { loadConfig } from "../src/config.ts";

test("allows the default loopback binding without an API token", () => {
  expect(loadConfig({}).host).toBe("localhost");
  expect(loadConfig({ HOST: "127.0.0.1" }).rulesToken).toBeUndefined();
  expect(loadConfig({ HOST: "::1" }).host).toBe("::1");
});

test("requires a rules token for non-loopback bindings", () => {
  expect(() => loadConfig({ HOST: "0.0.0.0" })).toThrow("RULES_TOKEN");
  expect(() => loadConfig({ HOST: "192.168.1.20" })).toThrow("RULES_TOKEN");
  expect(loadConfig({ HOST: "0.0.0.0", RULES_TOKEN: "secret" }).rulesToken).toBe(
    "secret",
  );
});
