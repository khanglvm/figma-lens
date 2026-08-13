import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

const TOKEN_NAMES = ["FIGMA_TOKEN", "FIGMA_ACCESS_TOKEN"];

export function configDirectory(env = process.env, platform = process.platform) {
  if (env.FIGMA_LENS_CONFIG_DIR) return resolve(env.FIGMA_LENS_CONFIG_DIR);
  if (platform === "darwin") return join(homedir(), "Library", "Application Support", "figma-lens");
  if (platform === "win32") return join(env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "figma-lens");
  return join(env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "figma-lens");
}

export function credentialPath(env = process.env, platform = process.platform) {
  return join(configDirectory(env, platform), "credentials.json");
}

function parseEnvFile(path) {
  if (!path) return undefined;
  const source = readFileSync(resolve(path), "utf8");
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?(FIGMA_(?:ACCESS_)?TOKEN)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (value) return value;
  }
  return undefined;
}

export function readStoredCredential(options = {}) {
  try {
    const data = JSON.parse(readFileSync(options.path ?? credentialPath(options.env, options.platform), "utf8"));
    return data?.figmaToken ? data : undefined;
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw new Error(`Could not read figma-lens credentials: ${error.message}`);
  }
}

export function resolveStoredToken(options = {}) {
  return readStoredCredential(options)?.figmaToken;
}

export function resolveTokenSync(options = {}) {
  const env = options.env ?? process.env;
  if (options.token) return { token: options.token, source: options.source ?? "explicit" };
  for (const name of TOKEN_NAMES) {
    if (env[name]) return { token: env[name], source: name };
  }
  const stored = resolveStoredToken({ ...options, env });
  if (stored) return { token: stored, source: "stored" };
  if (env.FIGMA_LENS_ENV_FILE) {
    const token = parseEnvFile(env.FIGMA_LENS_ENV_FILE);
    if (token) return { token, source: "FIGMA_LENS_ENV_FILE" };
  }
  return { token: undefined, source: undefined };
}

export function storeCredential(token, account, options = {}) {
  if (!token || !String(token).trim()) throw new Error("A non-empty Figma token is required");
  const path = options.path ?? credentialPath(options.env, options.platform);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  chmodSync(dirname(path), 0o700);
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  const payload = {
    version: 1,
    figmaToken: String(token).trim(),
    savedAt: new Date().toISOString(),
    account: account ? { id: account.id, handle: account.handle } : undefined,
  };
  writeFileSync(temporary, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  chmodSync(temporary, 0o600);
  renameSync(temporary, path);
  chmodSync(path, 0o600);
  return path;
}

export function removeCredential(options = {}) {
  const path = options.path ?? credentialPath(options.env, options.platform);
  try {
    rmSync(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

