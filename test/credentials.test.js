import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  credentialPath,
  readStoredCredential,
  removeCredential,
  resolveTokenSync,
  storeCredential,
} from "../src/credentials.js";

test("stores credentials atomically with private filesystem permissions", () => {
  const root = mkdtempSync(join(tmpdir(), "figma-lens-auth-"));
  const env = { FIGMA_LENS_CONFIG_DIR: root };
  const path = storeCredential("figd_secret", { id: "7", handle: "designer" }, { env });

  assert.equal(path, credentialPath(env));
  assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.equal(statSync(root).mode & 0o777, 0o700);
  assert.deepEqual(readStoredCredential({ env }).account, { id: "7", handle: "designer" });
  assert.equal(removeCredential({ env }), true);
  assert.equal(removeCredential({ env }), false);
});

test("uses environment, stored login, then explicit env file without auto-loading cwd .env", () => {
  const root = mkdtempSync(join(tmpdir(), "figma-lens-precedence-"));
  const envFile = join(root, "figma.env");
  writeFileSync(envFile, "FIGMA_TOKEN=figd_file\n");
  storeCredential("figd_stored", undefined, { env: { FIGMA_LENS_CONFIG_DIR: root } });

  assert.deepEqual(resolveTokenSync({ env: { FIGMA_LENS_CONFIG_DIR: root, FIGMA_TOKEN: "figd_env" } }), {
    token: "figd_env",
    source: "FIGMA_TOKEN",
  });
  assert.equal(resolveTokenSync({ env: { FIGMA_LENS_CONFIG_DIR: root } }).token, "figd_stored");
  removeCredential({ env: { FIGMA_LENS_CONFIG_DIR: root } });
  assert.equal(resolveTokenSync({ env: { FIGMA_LENS_CONFIG_DIR: root, FIGMA_LENS_ENV_FILE: envFile } }).token, "figd_file");
  assert.equal(resolveTokenSync({ env: { FIGMA_LENS_CONFIG_DIR: root } }).token, undefined);
  assert.match(readFileSync(envFile, "utf8"), /figd_file/);
});

