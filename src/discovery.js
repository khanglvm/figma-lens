import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { configDirectory, readStoredCredential } from "./credentials.js";
import { exists, readJson, resolveOfflineCache, withFileLock, writeJsonAtomic } from "./cache.js";
import { parseFigmaRef } from "./ref.js";
import { normalizeSearchText, scoutCandidates } from "./scout.js";
import { prepareData, screenshotOnly } from "./workflow.js";

const CONFIG_VERSION = 1;
const DEFAULT_CATALOG_TTL_MS = 15 * 60 * 1000;
const DEFAULT_MAX_FOLDERS = 200;
const DEFAULT_MAX_FILES = 8;
const DEFAULT_DEPTH = 3;
const DEFAULT_LIMIT = 5;
const DEFAULT_RENDER = 2;

function splitValues(value) {
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function parseTeamId(value) {
  const input = String(value ?? "").trim();
  if (/^\d+$/.test(input)) return input;
  let url;
  try {
    url = new URL(input);
  } catch {
    throw new Error("Expected a numeric Figma team ID or a figma.com team URL");
  }
  if (!(url.hostname === "figma.com" || url.hostname.endsWith(".figma.com"))) {
    throw new Error(`Not a figma.com URL: ${url.hostname}`);
  }
  const parts = url.pathname.split("/").filter(Boolean);
  const teamIndex = parts.indexOf("team");
  const teamId = teamIndex >= 0 ? parts[teamIndex + 1] : undefined;
  if (!teamId || !/^\d+$/.test(teamId)) {
    throw new Error("Could not extract a numeric team ID from the Figma URL");
  }
  return teamId;
}

export function discoveryConfigPath(options = {}) {
  return resolve(options.path ?? join(configDirectory(options.env), "discovery.json"));
}

function discoveryRoot(options = {}) {
  return resolve(options.output ?? options.root ?? join(configDirectory(options.env), "discovery"));
}

async function writePrivateJson(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await chmod(dirname(path), 0o700);
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  await chmod(temporary, 0o600);
  await rename(temporary, path);
  await chmod(path, 0o600);
}

export async function readDiscoveryConfig(options = {}) {
  try {
    const parsed = JSON.parse(await readFile(discoveryConfigPath(options), "utf8"));
    return {
      version: CONFIG_VERSION,
      teams: Array.isArray(parsed?.teams) ? parsed.teams : [],
    };
  } catch (error) {
    if (error?.code === "ENOENT") return { version: CONFIG_VERSION, teams: [] };
    throw new Error(`Could not read figma-lens discovery config: ${error.message}`);
  }
}

async function writeDiscoveryConfig(config, options = {}) {
  const normalized = {
    version: CONFIG_VERSION,
    teams: [...config.teams]
      .filter((team) => team?.id)
      .sort((left, right) => (left.name ?? left.id).localeCompare(right.name ?? right.id)),
  };
  await writePrivateJson(discoveryConfigPath(options), normalized);
  return normalized;
}

function environmentTeams(env = process.env) {
  return splitValues(env.FIGMA_LENS_TEAM_IDS).map((value) => ({ id: parseTeamId(value), source: "environment" }));
}

async function configuredTeams(options = {}) {
  const config = await readDiscoveryConfig(options);
  const values = [...config.teams, ...environmentTeams(options.env)];
  const unique = new Map();
  for (const team of values) {
    const current = unique.get(team.id);
    unique.set(team.id, { ...team, ...current, id: team.id, name: current?.name ?? team.name });
  }
  return [...unique.values()];
}

export async function addTeam(api, value, options = {}) {
  const id = parseTeamId(value);
  const { data } = await api.getTeamFolders(id);
  const config = await readDiscoveryConfig(options);
  const now = new Date().toISOString();
  const current = config.teams.find((team) => team.id === id);
  const team = {
    id,
    name: data.name ?? current?.name,
    addedAt: current?.addedAt ?? now,
    verifiedAt: now,
  };
  config.teams = [...config.teams.filter((item) => item.id !== id), team];
  await writeDiscoveryConfig(config, options);
  return { ok: true, team, folderCount: data.folders?.length ?? 0, path: discoveryConfigPath(options) };
}

export async function removeTeam(value, options = {}) {
  const id = parseTeamId(value);
  const config = await readDiscoveryConfig(options);
  const removed = config.teams.some((team) => team.id === id);
  config.teams = config.teams.filter((team) => team.id !== id);
  await writeDiscoveryConfig(config, options);
  return { ok: true, removed, id, path: discoveryConfigPath(options) };
}

function apiCallSummary(api) {
  const byStatus = {};
  const byKind = {};
  for (const call of api.calls) {
    const status = String(call.status ?? 0);
    byStatus[status] = (byStatus[status] ?? 0) + 1;
    const kind = call.path.includes("/images/")
      ? "render"
      : call.path.includes("/folders")
        ? "folders"
        : call.path.includes("/files/")
          ? "files"
          : call.path.endsWith("/me")
            ? "identity"
            : "other";
    byKind[kind] = (byKind[kind] ?? 0) + 1;
  }
  return { total: api.calls.length, byKind, byStatus };
}

export async function discoveryContext(api, options = {}) {
  const stored = readStoredCredential({ env: options.env });
  let account = stored?.account;
  const teams = await configuredTeams(options);
  const failures = [];
  if (options.refresh || !account) {
    const { data } = await api.me();
    account = { id: data.id, handle: data.handle };
  }
  if (options.refresh && teams.length) {
    const config = await readDiscoveryConfig(options);
    for (const team of teams) {
      try {
        const { data } = await api.getTeamFolders(team.id);
        team.name = data.name ?? team.name;
        team.topLevelFolders = data.folders?.length ?? 0;
        team.verifiedAt = new Date().toISOString();
      } catch (error) {
        failures.push({ id: team.id, error: error.message });
      }
    }
    const configuredIds = new Set(config.teams.map((team) => team.id));
    config.teams = teams.filter((team) => configuredIds.has(team.id));
    await writeDiscoveryConfig(config, options);
  }
  return {
    ok: true,
    account,
    teams: teams.map((team) => ({
      id: team.id,
      name: team.name,
      source: team.source ?? "stored",
      verifiedAt: team.verifiedAt,
      topLevelFolders: team.topLevelFolders,
    })),
    setup: {
      required: teams.length === 0,
      reason: teams.length === 0
        ? "Figma does not expose a token-to-team listing endpoint. Register one team URL before workspace search."
        : undefined,
      command: teams.length === 0 ? "figma-lens teams add <FIGMA_TEAM_URL>" : undefined,
    },
    failures: failures.length ? failures : undefined,
    api: apiCallSummary(api),
  };
}

function catalogIsFresh(catalog, teamIds, ttlMs) {
  if (!catalog?.updatedAt || !Array.isArray(catalog.teams)) return false;
  const cachedIds = catalog.teams.map((team) => team.id).sort();
  const requestedIds = [...teamIds].sort();
  return JSON.stringify(cachedIds) === JSON.stringify(requestedIds)
    && Date.now() - Date.parse(catalog.updatedAt) < ttlMs;
}

async function readCatalog(path) {
  try {
    return await readJson(path);
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
}

async function enumerateTeam(api, team, options = {}) {
  const top = await api.getTeamFolders(team.id);
  const teamName = top.data.name ?? team.name ?? team.id;
  const queue = (top.data.folders ?? []).map((folder) => ({ ...folder, path: folder.name }));
  const folders = [];
  const files = [];
  const seenFolders = new Set();
  let truncated = false;

  while (queue.length) {
    const folder = queue.shift();
    if (seenFolders.has(folder.id)) continue;
    if (seenFolders.size >= (options.maxFolders ?? DEFAULT_MAX_FOLDERS)) {
      truncated = true;
      break;
    }
    seenFolders.add(folder.id);
    const [fileResponse, folderResponse] = await Promise.all([
      api.getFolderFiles(folder.id),
      api.getFolderFolders(folder.id),
    ]);
    const path = folder.path ?? folder.name;
    folders.push({
      id: folder.id,
      name: folder.name,
      path,
      parentFolderId: folder.parent_folder_id ?? undefined,
      teamId: team.id,
      teamName,
    });
    for (const file of fileResponse.data.files ?? []) {
      files.push({
        key: file.key,
        name: file.name,
        thumbnailUrl: file.thumbnail_url,
        lastModified: file.last_modified,
        folderId: folder.id,
        folderName: folder.name,
        folderPath: path,
        teamId: team.id,
        teamName,
      });
    }
    for (const child of folderResponse.data.folders ?? []) {
      queue.push({ ...child, path: `${path} / ${child.name}` });
    }
  }

  return {
    team: { id: team.id, name: teamName },
    folders,
    files,
    truncated,
  };
}

async function loadCatalog(api, teams, options = {}) {
  const root = discoveryRoot(options);
  const teamIds = teams.map((team) => team.id);
  const scopeKey = createHash("sha256").update([...teamIds].sort().join(",")).digest("hex").slice(0, 12);
  const path = join(root, "catalogs", `${scopeKey}.json`);
  const cached = await readCatalog(path);
  const ttlMs = options.catalogTtlMs ?? DEFAULT_CATALOG_TTL_MS;
  if (!options.refresh && catalogIsFresh(cached, teamIds, ttlMs)) {
    return { catalog: cached, cacheHit: true, path };
  }
  if (options.offline) {
    if (cached) return { catalog: cached, cacheHit: true, stale: true, path };
    return { catalog: undefined, cacheHit: false, path };
  }

  return withFileLock(`${path}.lock`, async () => {
    const lockedCached = await readCatalog(path);
    if (!options.refresh && catalogIsFresh(lockedCached, teamIds, ttlMs)) {
      return { catalog: lockedCached, cacheHit: true, path };
    }
    const collected = [];
    const failures = [];
    for (const team of teams) {
      try {
        collected.push(await enumerateTeam(api, team, options));
      } catch (error) {
        failures.push({ id: team.id, name: team.name, error: error.message, status: error.status });
      }
    }
    const filesByKey = new Map();
    for (const result of collected) {
      for (const file of result.files) {
        const current = filesByKey.get(file.key);
        if (!current || Date.parse(file.lastModified ?? 0) > Date.parse(current.lastModified ?? 0)) {
          filesByKey.set(file.key, file);
        }
      }
    }
    const catalog = {
      schemaVersion: 1,
      updatedAt: new Date().toISOString(),
      teams: collected.map((result) => result.team),
      folders: collected.flatMap((result) => result.folders),
      files: [...filesByKey.values()].sort((left, right) =>
        Date.parse(right.lastModified ?? 0) - Date.parse(left.lastModified ?? 0) || left.name.localeCompare(right.name)),
      truncated: collected.some((result) => result.truncated),
      failures,
    };
    await writeJsonAtomic(path, catalog);

    const config = await readDiscoveryConfig(options);
    let configChanged = false;
    for (const result of collected) {
      const target = config.teams.find((team) => team.id === result.team.id);
      if (target && target.name !== result.team.name) {
        target.name = result.team.name;
        target.verifiedAt = catalog.updatedAt;
        configChanged = true;
      }
    }
    if (configChanged) await writeDiscoveryConfig(config, options);
    return { catalog, cacheHit: false, path };
  });
}

function trigrams(value) {
  const padded = `  ${value} `;
  const result = new Set();
  for (let index = 0; index <= padded.length - 3; index += 1) result.add(padded.slice(index, index + 3));
  return result;
}

function similarity(left, right) {
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (left.includes(right) || right.includes(left)) return 0.86;
  const a = trigrams(left);
  const b = trigrams(right);
  let shared = 0;
  for (const value of a) if (b.has(value)) shared += 1;
  return shared / Math.max(1, a.size + b.size - shared);
}

function scopeCandidates(catalog) {
  return [
    ...(catalog.teams ?? []).map((team) => ({ kind: "team", id: team.id, label: team.name, teamId: team.id })),
    ...(catalog.folders ?? []).map((folder) => ({
      kind: "folder",
      id: folder.id,
      label: `${folder.teamName} / ${folder.path}`,
      teamId: folder.teamId,
      teamName: folder.teamName,
      folderPath: folder.path,
    })),
    ...(catalog.files ?? []).map((file) => ({
      kind: "file",
      id: file.key,
      label: `${file.teamName} / ${file.folderPath} / ${file.name}`,
      teamId: file.teamId,
      teamName: file.teamName,
      fileKey: file.key,
    })),
  ];
}

function resolveScope(catalog, scope) {
  const requested = normalizeSearchText(scope);
  if (!requested) return { files: catalog.files ?? [], resolved: [] };
  const ranked = scopeCandidates(catalog)
    .map((candidate) => {
      const idScore = normalizeSearchText(candidate.id) === requested ? 1.1 : 0;
      const labelScore = similarity(requested, normalizeSearchText(candidate.label));
      const teamScore = similarity(requested, normalizeSearchText(candidate.teamName));
      return { ...candidate, score: Math.max(idScore, labelScore, teamScore) };
    })
    .filter((candidate) => candidate.score >= 0.42)
    .sort((left, right) => right.score - left.score || left.label.localeCompare(right.label));
  if (!ranked.length) {
    return {
      files: [],
      resolved: [],
      missing: true,
      suggestions: scopeCandidates(catalog)
        .filter((candidate) => candidate.kind !== "file")
        .slice(0, 12)
        .map(({ kind, id, label }) => ({ kind, id, label })),
    };
  }
  const best = ranked[0].score;
  const selected = ranked.filter((candidate) => candidate.score >= Math.max(0.58, best - 0.08));
  const files = (catalog.files ?? []).filter((file) => selected.some((candidate) => {
    if (candidate.kind === "team") return file.teamId === candidate.id;
    if (candidate.kind === "folder") return file.folderPath === candidate.folderPath || file.folderPath.startsWith(`${candidate.folderPath} / `);
    return file.key === candidate.fileKey;
  }));
  return {
    files,
    resolved: selected.slice(0, 8).map(({ kind, id, label }) => ({ kind, id, label })),
  };
}

function metadataScore(file, query) {
  const normalizedQuery = normalizeSearchText(query);
  const tokens = normalizedQuery.split(/\s+/).filter((token) => token.length > 2);
  const value = normalizeSearchText(`${file.name} ${file.folderPath} ${file.teamName}`);
  if (!tokens.length) return 0;
  if (value.includes(normalizedQuery)) return 100;
  let matched = 0;
  for (const token of tokens) {
    if (value.includes(token)) matched += 1;
    else if (value.split(/\s+/).some((word) => similarity(token, word) >= 0.58)) matched += 0.5;
  }
  return (matched / tokens.length) * 50;
}

function fileRef(file) {
  return parseFigmaRef(file.key);
}

async function cachedSpec(file, options = {}) {
  const ref = fileRef(file);
  const resolved = await resolveOfflineCache(ref, { cacheRoot: options.cacheRoot });
  if (!(await exists(join(resolved.directory, "raw.json")))) return undefined;
  let spec;
  if (await exists(join(resolved.directory, "spec.json"))) spec = await readJson(join(resolved.directory, "spec.json"));
  else spec = (await prepareData(options.api, ref, { cacheRoot: options.cacheRoot, offline: true })).spec;
  const remoteModified = Date.parse(file.lastModified ?? 0);
  const cachedModified = Date.parse(spec.source?.lastModified ?? 0);
  return {
    spec,
    directory: resolved.directory,
    depth: resolved.depth,
    stale: Number.isFinite(remoteModified) && (!Number.isFinite(cachedModified) || remoteModified > cachedModified),
  };
}

function fileNodeUrl(fileKey, nodeId) {
  const url = new URL(`https://www.figma.com/design/${fileKey}/Design`);
  url.searchParams.set("node-id", nodeId.replaceAll(":", "-"));
  return url.toString();
}

function candidateMatches(file, spec, query, perFileLimit = 3) {
  const discovery = scoutCandidates(spec, query, { limit: perFileLimit });
  if (!new Set(["intent-match", "spatial-context"]).has(discovery.mode)) return [];
  const fileBonus = Math.min(12, metadataScore(file, query) * 0.12);
  return discovery.candidates.map((candidate) => ({
    score: candidate.score + fileBonus,
    confidence: candidate.confidence,
    why: candidate.why.slice(0, 2),
    preview: candidate.textPreview,
    file: {
      key: file.key,
      name: file.name,
      team: file.teamName,
      folder: file.folderPath,
      lastModified: file.lastModified,
    },
    node: {
      id: candidate.id,
      name: candidate.name,
      kind: candidate.kind,
      path: candidate.path,
      bounds: candidate.bounds,
    },
    url: fileNodeUrl(file.key, candidate.id),
  }));
}

function publicMatch(match, rank) {
  const bounds = match.node.bounds;
  return {
    rank,
    confidence: match.confidence,
    file: match.file,
    node: {
      id: match.node.id,
      name: match.node.name,
      kind: match.node.kind,
      path: match.node.path,
      size: bounds ? `${bounds.width}×${bounds.height}` : undefined,
    },
    why: match.why,
    preview: match.preview,
    url: match.url,
    screenshot: match.screenshot,
  };
}

async function renderMatches(api, matches, options = {}) {
  const selected = matches.slice(0, options.render ?? DEFAULT_RENDER);
  const byFile = new Map();
  for (const match of selected) {
    const group = byFile.get(match.file.key) ?? [];
    group.push(match);
    byFile.set(match.file.key, group);
  }
  for (const [fileKey, group] of byFile) {
    try {
      const rendered = await screenshotOnly(api, {
        fileKey,
        nodeIds: group.map((match) => match.node.id),
        source: fileKey,
      }, {
        cacheRoot: options.cacheRoot,
        offline: options.offline,
        refresh: options.refresh,
        scale: 1,
        concurrency: options.concurrency,
      });
      group.forEach((match, index) => {
        match.screenshot = rendered.screenshots[index];
      });
    } catch (error) {
      group.forEach((match) => {
        match.renderError = error.message;
      });
    }
  }
}

function searchArtifactKey(query, scope, catalogUpdatedAt) {
  return createHash("sha256")
    .update(`${normalizeSearchText(query)}|${normalizeSearchText(scope)}|${catalogUpdatedAt}`)
    .digest("hex")
    .slice(0, 16);
}

export async function findDesigns(api, query, options = {}) {
  const requestedTeamIds = splitValues(options.teamIds).map(parseTeamId);
  const storedTeams = await configuredTeams(options);
  const teamMap = new Map(storedTeams.map((team) => [team.id, team]));
  const teams = requestedTeamIds.length
    ? requestedTeamIds.map((id) => teamMap.get(id) ?? { id, source: "request" })
    : storedTeams;
  if (!teams.length) {
    return {
      ok: false,
      status: "needs_setup",
      query,
      reason: "Figma does not expose the current user's team IDs through the REST API.",
      next: { command: "figma-lens teams add <FIGMA_TEAM_URL>" },
    };
  }

  const root = discoveryRoot(options);
  if (!options.output) {
    await mkdir(root, { recursive: true, mode: 0o700 });
    await chmod(root, 0o700);
  }
  const cacheRoot = join(root, "files");
  const catalogResult = await loadCatalog(api, teams, options);
  if (!catalogResult.catalog) {
    return {
      ok: false,
      status: "needs_sync",
      query,
      reason: "No cached team catalog is available for offline search.",
      next: { command: `figma-lens find ${JSON.stringify(query)}` },
    };
  }
  if (!catalogResult.catalog.teams.length && catalogResult.catalog.failures?.length) {
    return {
      ok: false,
      status: "catalog_error",
      query,
      reason: "Figma could not list the registered teams. Confirm the token has folders:read and can open each team.",
      failures: catalogResult.catalog.failures.slice(0, 5),
    };
  }
  const scoped = resolveScope(catalogResult.catalog, options.scope);
  if (scoped.missing) {
    return {
      ok: false,
      status: "scope_not_found",
      query,
      requestedScope: options.scope,
      suggestions: scoped.suggestions,
      coverage: {
        teams: catalogResult.catalog.teams.length,
        folders: catalogResult.catalog.folders.length,
        files: catalogResult.catalog.files.length,
      },
    };
  }

  const files = [...scoped.files].sort((left, right) =>
    metadataScore(right, query) - metadataScore(left, query)
    || Date.parse(right.lastModified ?? 0) - Date.parse(left.lastModified ?? 0));
  const indexed = [];
  const cold = [];
  const failures = (catalogResult.catalog.failures ?? []).map((failure) => ({ ...failure, stage: "catalog" }));
  let cachedFiles = 0;
  let refreshedFiles = 0;
  for (const file of files) {
    try {
      const cached = await cachedSpec(file, { api, cacheRoot });
      if (cached && !options.refresh && !cached.stale) {
        indexed.push({ file, spec: cached.spec, source: "cache" });
        cachedFiles += 1;
      } else {
        cold.push({ file, cached });
      }
    } catch (error) {
      cold.push({ file });
      failures.push({ file: file.name, key: file.key, stage: "cache", error: error.message });
    }
  }

  if (!options.offline) {
    const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
    for (const item of cold.slice(0, maxFiles)) {
      try {
        const prepared = await prepareData(api, fileRef(item.file), {
          cacheRoot,
          depth: options.depth ?? DEFAULT_DEPTH,
          refresh: Boolean(item.cached?.stale || options.refresh),
        });
        indexed.push({ file: item.file, spec: prepared.spec, source: "remote" });
        refreshedFiles += 1;
      } catch (error) {
        failures.push({ file: item.file.name, key: item.file.key, stage: "content", error: error.message, status: error.status });
        if (error.status === 429) break;
      }
    }
  }

  const allMatches = indexed
    .flatMap(({ file, spec }) => candidateMatches(file, spec, query))
    .sort((left, right) => right.score - left.score
      || Date.parse(right.file.lastModified ?? 0) - Date.parse(left.file.lastModified ?? 0)
      || left.node.path.localeCompare(right.node.path));
  const limit = options.limit ?? DEFAULT_LIMIT;
  const topMatches = allMatches.slice(0, limit);
  await renderMatches(api, topMatches, { ...options, cacheRoot });

  const artifact = join(root, "searches", `${searchArtifactKey(query, options.scope, catalogResult.catalog.updatedAt)}.json`);
  const coverage = {
    catalogCacheHit: catalogResult.cacheHit,
    discoveredTeams: catalogResult.catalog.teams.length,
    discoveredFolders: catalogResult.catalog.folders.length,
    discoveredFiles: files.length,
    indexedFiles: indexed.length,
    cachedFiles,
    fetchedFiles: refreshedFiles,
    skippedFiles: Math.max(0, files.length - indexed.length - failures.filter((failure) => failure.stage === "content").length),
    complete: indexed.length === files.length && !catalogResult.catalog.truncated && failures.length === 0,
    depth: options.depth ?? DEFAULT_DEPTH,
  };
  await writeJsonAtomic(artifact, {
    schemaVersion: 1,
    query,
    requestedScope: options.scope,
    resolvedScopes: scoped.resolved,
    coverage,
    matches: allMatches,
    failures,
    catalog: catalogResult.path,
    apiCalls: api.calls,
  });

  const compactMatches = topMatches.map((match, index) => publicMatch(match, index + 1));
  return {
    ok: true,
    status: coverage.complete ? "complete" : "partial",
    query,
    scope: {
      requested: options.scope,
      resolved: scoped.resolved,
    },
    coverage,
    matches: compactMatches,
    next: {
      guidance: compactMatches.length
        ? "View candidate 1 first and candidate 2 only if needed. Focus the chosen node for implementation detail."
        : "No indexed node matched. Increase --max-files or use --refresh if the catalog may be stale.",
      focus: compactMatches.slice(0, 2).map((match) =>
        `figma-lens focus '${match.url}' --select '${match.node.id}'`),
    },
    failures: failures.length ? failures.slice(0, 5) : undefined,
    cache: { root, catalog: catalogResult.path, artifact },
    api: apiCallSummary(api),
  };
}
