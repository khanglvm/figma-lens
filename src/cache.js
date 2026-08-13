import { randomUUID } from "node:crypto";
import { access, mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { safeTargetName } from "./ref.js";

export function cacheDirectory(ref, { cacheRoot, depth, output } = {}) {
  if (output) return resolve(output);
  const root = resolve(cacheRoot ?? process.env.FIGMA_LENS_CACHE_DIR ?? ".figma-lens");
  return resolve(root, ref.fileKey, safeTargetName(ref.nodeIds, depth));
}

export async function resolveOfflineCache(ref, options = {}) {
  const exact = cacheDirectory(ref, options);
  if (await exists(join(exact, "raw.json"))) return { directory: exact, depth: options.depth };
  if (options.output || options.depth !== undefined) return { directory: exact, depth: options.depth };

  const root = resolve(options.cacheRoot ?? process.env.FIGMA_LENS_CACHE_DIR ?? ".figma-lens", ref.fileKey);
  const prefix = safeTargetName(ref.nodeIds, undefined).replace(/all$/, "");
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return { directory: exact, depth: options.depth };
    throw error;
  }

  const candidates = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith(prefix)) continue;
    const suffix = entry.name.slice(prefix.length);
    const depth = suffix === "all" ? undefined : Number.parseInt(suffix, 10);
    if (suffix !== "all" && (!Number.isInteger(depth) || String(depth) !== suffix)) continue;
    const directory = join(root, entry.name);
    if (await exists(join(directory, "raw.json"))) {
      candidates.push({ directory, depth, score: suffix === "all" ? Number.POSITIVE_INFINITY : depth });
    }
  }
  candidates.sort((left, right) => right.score - left.score || left.directory.localeCompare(right.directory));
  return candidates[0] ?? { directory: exact, depth: options.depth };
}

export async function projectNodeFromBatchCache(ref, options = {}) {
  if (options.output || ref.nodeIds.length !== 1 || options.depth === undefined) return undefined;

  const root = resolve(options.cacheRoot ?? process.env.FIGMA_LENS_CACHE_DIR ?? ".figma-lens", ref.fileKey);
  const target = safeTargetName(ref.nodeIds, options.depth).split("--d-")[0];
  const suffix = `--d-${options.depth}`;
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }

  const candidates = entries
    .filter((entry) => entry.isDirectory() && entry.name.endsWith(suffix))
    .map((entry) => ({
      entry,
      nodeNames: entry.name.slice(0, -suffix.length).split("+"),
    }))
    .filter((candidate) => candidate.nodeNames.length > 1 && candidate.nodeNames.includes(target))
    .sort((left, right) => left.nodeNames.length - right.nodeNames.length || left.entry.name.localeCompare(right.entry.name));

  for (const candidate of candidates) {
    const directory = join(root, candidate.entry.name);
    const rawPath = join(directory, "raw.json");
    if (!(await exists(rawPath))) continue;
    const batch = await readJson(rawPath);
    const node = batch.nodes?.[ref.nodeIds[0]];
    if (!node) continue;
    const { nodes: _nodes, ...metadata } = batch;
    return {
      directory,
      raw: {
        ...metadata,
        nodes: { [ref.nodeIds[0]]: node },
      },
    };
  }
  return undefined;
}

export async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

export async function writeTextAtomic(path, content) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, content);
  await rename(temporary, path);
}

export function writeJsonAtomic(path, value) {
  return writeTextAtomic(path, `${JSON.stringify(value, null, 2)}\n`);
}

const pause = (milliseconds) => new Promise((resolvePause) => setTimeout(resolvePause, milliseconds));

export async function withFileLock(lockPath, operation, options = {}) {
  const timeoutMs = options.timeoutMs ?? 45_000;
  const staleMs = options.staleMs ?? 120_000;
  const pollMs = options.pollMs ?? 75;
  const startedAt = Date.now();
  await mkdir(dirname(lockPath), { recursive: true });

  let handle;
  while (!handle) {
    try {
      handle = await open(lockPath, "wx", 0o600);
      await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      try {
        const info = await stat(lockPath);
        if (Date.now() - info.mtimeMs > staleMs) {
          await rm(lockPath, { force: true });
          continue;
        }
      } catch (statError) {
        if (statError?.code === "ENOENT") continue;
        throw statError;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        throw new Error(`Timed out waiting for cache lock: ${lockPath}`);
      }
      await pause(pollMs);
    }
  }

  try {
    return await operation();
  } finally {
    await handle.close().catch(() => {});
    await rm(lockPath, { force: true }).catch(() => {});
  }
}
