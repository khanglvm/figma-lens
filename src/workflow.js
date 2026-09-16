import { basename, join } from "node:path";
import { cacheDirectory, exists, projectNodeFromBatchCache, readJson, resolveOfflineCache, withFileLock, writeJsonAtomic, writeTextAtomic } from "./cache.js";
import {
  compactTypography,
  imageRefsFromRaw,
  implementationContract,
  isNodeVisible,
  nodeStats,
  simplifyResponse,
  specTree,
  summaryMarkdown,
  typographyCatalog,
  visibleEvidence,
} from "./simplify.js";
import { detailCandidates } from "./detail.js";
import { findSpecNode, scoutCacheKey, scoutCandidates } from "./scout.js";

function safeId(id) {
  return id.replaceAll(":", "-").replaceAll(";", "_");
}

function artifactPaths(directory) {
  return {
    directory,
    raw: join(directory, "raw.json"),
    spec: join(directory, "spec.json"),
    summary: join(directory, "summary.md"),
    contract: join(directory, "contract.json"),
    typography: join(directory, "typography.json"),
    evidence: join(directory, "visible-evidence.json"),
    manifest: join(directory, "manifest.json"),
  };
}

function publicCalls(api) {
  return api.calls.map((call) => ({
    path: call.path,
    status: call.status,
    attempt: call.attempt,
    networkError: call.networkError,
    rate: call.rate,
  }));
}

function compactCandidate(candidate, hasIntent, rootBounds) {
  const size = candidate.bounds ? `${candidate.bounds.width}×${candidate.bounds.height}` : undefined;
  const position = candidate.bounds && rootBounds
    ? `${Math.round(((candidate.bounds.x + candidate.bounds.width / 2 - rootBounds.x) / rootBounds.width) * 100)}%,${Math.round(((candidate.bounds.y + candidate.bounds.height / 2 - rootBounds.y) / rootBounds.height) * 100)}%`
    : undefined;
  return {
    rank: candidate.rank,
    id: candidate.id,
    name: candidate.name,
    kind: candidate.kind,
    size,
    position,
    confidence: hasIntent ? candidate.confidence : undefined,
    why: hasIntent ? candidate.why[0] : undefined,
    preview: hasIntent && candidate.textPreview ? candidate.textPreview : undefined,
    screenshot: candidate.screenshot,
  };
}

function overviewDescription(root, result, depth) {
  const counts = result.topLevelKindCounts;
  const parts = [
    [counts.screen, "screen"],
    [counts.dialog, "dialog"],
    [counts.component, "component"],
    [counts.annotation, "annotation/flow item"],
  ]
    .filter(([count]) => count)
    .map(([count, label]) => `${count} ${label}${count === 1 ? "" : "s"}`);
  const dimensions = root?.bounds ? `${root.bounds.width}×${root.bounds.height}` : "unknown-size";
  return `${dimensions} ${root?.type?.toLocaleLowerCase() ?? "node"} with ${parts.join(", ") || "no classified children"} at discovery depth ${depth}.`;
}

function shellArg(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

function focusSetCommand(ref, states) {
  const ids = states.map((state) => state.implementationId ?? state.id).join(",");
  return ids ? `figma-lens focus-set ${shellArg(ref.source)} --select ${shellArg(ids)}` : undefined;
}

function nextCommands(ref, result, depth, hasIntent) {
  const input = shellArg(ref.source);
  if (!hasIntent) {
    return {
      guidance: result.collection.requiresRepresentativeFocusSet
        ? "This is one component across multiple states. Run the representative focus-set before implementation."
        : "Answer from the overview and ordered states when sufficient. Otherwise run one intent scout.",
      focusSet: focusSetCommand(ref, result.collection.representativeStates),
      intent: `figma-lens scout ${input} --intent "DESCRIBE TARGET" --render 2`,
      tree: `figma-lens tree ${input} --depth ${depth} --offline --max-depth 3 --max-nodes 100`,
    };
  }
  return {
    guidance: "View candidate 1 first; view candidate 2 only if unclear. Focus only for implementation-level detail.",
    focus: result.candidates.slice(0, 2).map((candidate) =>
      `figma-lens focus ${input} --select ${shellArg(candidate.id)}`),
  };
}

const VISUAL_ASSET_NAME = /(?:avatar|brand|empty(?: state)?|icon|illustration|logo|mark|user[- ]?search)/i;

function visualAssetCandidates(spec, limit = 8) {
  const candidates = [];
  const seen = new Set();
  function visit(node, path, stateName) {
    if (!isNodeVisible(node)) return;
    const bounds = node.bounds;
    const name = String(node.name ?? "");
    const width = bounds?.width ?? 0;
    const height = bounds?.height ?? 0;
    const nextState = path.length === 0 ? name : stateName;
    const matches = VISUAL_ASSET_NAME.test(name);
    const stableNodeId = !String(node.id).startsWith("I") && !String(node.id).includes(";");
    const renderable = stableNodeId && isNodeVisible(node) && node.type !== "TEXT" && width >= 8 && height >= 8 && width <= 256 && height <= 256;
    if (matches && renderable) {
      const signature = `${name.toLocaleLowerCase()}|${Math.round(width)}x${Math.round(height)}`;
      if (!seen.has(signature)) {
        seen.add(signature);
        const priority = /illustration|logo|brand|user-search/i.test(name)
          ? 100
          : /avatar|empty/i.test(name)
            ? 80
            : /^icon\s*\//i.test(name)
              ? 60
              : 30;
        candidates.push({
          id: node.id,
          name,
          type: node.type,
          size: `${width}×${height}`,
          state: nextState,
          path: [...path, name].slice(-5).join(" / "),
          format: "svg",
          priority,
        });
      }
    }
    for (const child of node.children ?? []) visit(child, [...path, name], nextState);
  }
  for (const root of spec.nodes ?? []) visit(root, [], root.name);
  return candidates
    .sort((left, right) => right.priority - left.priority || left.path.localeCompare(right.path))
    .slice(0, limit)
    .map(({ priority: _priority, ...candidate }) => candidate);
}

async function prepareVisualAssets(api, spec, ref, directory, options = {}) {
  const candidates = visualAssetCandidates(spec);
  let rendered = { paths: [], cacheHit: true };
  if (options.exportAssets && candidates.length) {
    rendered = await renderScreenshots(
      api,
      {
        ref: { fileKey: ref.fileKey, nodeIds: candidates.map((candidate) => candidate.id) },
        directory: join(directory, "visual-assets"),
      },
      { ...options, format: "svg", scale: 1, allowMissing: true },
    );
  }
  const exportedById = new Map((rendered.items ?? []).map((item) => [item.id, item.path]));
  return {
    required: candidates.length > 0,
    instruction: candidates.length
      ? "Inspect and reuse exported distinctive visuals. Replacing them with emoji, text glyphs, or unrelated icons fails visual fidelity."
      : undefined,
    candidates: candidates.map((candidate) => ({
      ...candidate,
      exported: exportedById.get(candidate.id),
    })),
    cacheHit: rendered.cacheHit,
    missing: rendered.missing ?? [],
    next: candidates.length && !options.exportAssets
      ? `figma-lens export ${shellArg(ref.source)} --node ${shellArg(candidates.map((candidate) => candidate.id).join(","))} --format svg`
      : undefined,
  };
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, limit), items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function prepareData(api, ref, options = {}) {
  let depth = options.depth ?? (ref.nodeIds.length ? 6 : 2);
  let directory = cacheDirectory(ref, { ...options, depth });
  if (!options.refresh && options.depth === undefined) {
    const resolved = await resolveOfflineCache(ref, { ...options, depth: undefined });
    if (await exists(join(resolved.directory, "raw.json"))) {
      directory = resolved.directory;
      depth = resolved.depth;
    }
  }
  const paths = artifactPaths(directory);
  let cachedRaw = await exists(paths.raw);
  let dataDerivedFrom;

  if (!cachedRaw && !options.refresh) {
    const projection = await projectNodeFromBatchCache(ref, { ...options, depth });
    if (projection) {
      await withFileLock(`${paths.raw}.lock`, async () => {
        if (!(await exists(paths.raw))) await writeJsonAtomic(paths.raw, projection.raw);
      });
      cachedRaw = true;
      dataDerivedFrom = projection.directory;
    }
  }

  if (options.offline && (!cachedRaw || options.refresh)) {
    throw new Error(`Offline cache miss: ${paths.raw}`);
  }

  let raw;
  let dataCacheHit = cachedRaw && !options.refresh;
  if (dataCacheHit) {
    raw = await readJson(paths.raw);
  } else {
    const result = await withFileLock(`${paths.raw}.lock`, async () => {
      if (!options.refresh && (await exists(paths.raw))) {
        return { raw: await readJson(paths.raw), cacheHit: true };
      }
      const response = ref.nodeIds.length
        ? await api.getNodes(ref.fileKey, ref.nodeIds, { depth })
        : await api.getFile(ref.fileKey, { depth });
      await writeJsonAtomic(paths.raw, response.data);
      return { raw: response.data, cacheHit: false };
    });
    raw = result.raw;
    dataCacheHit = result.cacheHit;
  }

  const spec = simplifyResponse(raw, ref);
  if (ref.nodeIds.length && spec.nodes.length !== ref.nodeIds.length) {
    const found = new Set(spec.nodes.map((node) => node.id));
    const missing = ref.nodeIds.filter((id) => !found.has(id));
    throw new Error(`Figma returned no data for node(s): ${missing.join(", ")}`);
  }
  await writeJsonAtomic(paths.spec, spec);
  await writeJsonAtomic(paths.contract, implementationContract(spec));
  await writeJsonAtomic(paths.typography, typographyCatalog(spec));
  await writeJsonAtomic(paths.evidence, visibleEvidence(spec));
  await writeTextAtomic(paths.summary, summaryMarkdown(spec, { evidence: paths.evidence }));

  return { ref, depth, directory, paths, raw, spec, dataCacheHit, dataDerivedFrom };
}

export async function renderScreenshots(api, prepared, options = {}) {
  if (!prepared.ref.nodeIds.length) {
    throw new Error("A node link or --node is required to render a screenshot");
  }

  const format = options.format ?? "png";
  if (!new Set(["png", "jpg", "svg", "pdf"]).has(format)) {
    throw new Error(`Unsupported render format: ${format}`);
  }
  const scale = options.scale ?? 2;
  if (!(scale >= 0.01 && scale <= 4)) throw new Error("--scale must be between 0.01 and 4");

  const renderVariant = `${scale}x${options.useAbsoluteBounds ? "-absolute" : ""}`;
  const destinations = new Map(
    prepared.ref.nodeIds.map((id) => [
      id,
      join(
        prepared.directory,
        `screenshot-${safeId(id)}@${renderVariant}.${format}`,
      ),
    ]),
  );
  const missing = [];
  for (const [id, path] of destinations) {
    if (options.refresh || !(await exists(path))) missing.push(id);
  }

  if (options.offline && missing.length) {
    throw new Error(`Offline screenshot cache miss: ${missing.join(", ")}`);
  }

  let rendered = missing;
  if (missing.length) {
    rendered = await withFileLock(join(prepared.directory, `.render-${format}-${scale}.lock`), async () => {
      const stillMissing = [];
      for (const [id, path] of destinations) {
        if (options.refresh || !(await exists(path))) stillMissing.push(id);
      }
      if (!stillMissing.length) return [];
      const { data } = await api.getRenders(prepared.ref.fileKey, stillMissing, {
        format,
        scale,
        useAbsoluteBounds: options.useAbsoluteBounds,
      });
      await mapLimit(stillMissing, options.concurrency ?? 4, async (id) => {
        const url = data.images?.[id];
        if (!url) {
          if (options.allowMissing) return;
          throw new Error(`Figma could not render node ${id}`);
        }
        await api.download(url, destinations.get(id));
      });
      return stillMissing;
    });
  }

  const items = [];
  const unavailable = [];
  for (const [id, path] of destinations) {
    if (await exists(path)) items.push({ id, path });
    else unavailable.push(id);
  }
  return {
    paths: items.map((item) => item.path),
    items,
    missing: unavailable,
    cacheHit: rendered.length === 0,
  };
}

export async function downloadAssets(api, prepared, options = {}) {
  const indexPath = join(prepared.directory, "assets", "index.json");
  if (!options.refresh && (await exists(indexPath))) {
    const index = await readJson(indexPath);
    return { ...index, cacheHit: true, indexPath };
  }
  if (options.offline) throw new Error(`Offline asset cache miss: ${indexPath}`);

  return withFileLock(`${indexPath}.lock`, async () => {
    if (!options.refresh && (await exists(indexPath))) {
      const index = await readJson(indexPath);
      return { ...index, cacheHit: true, indexPath };
    }

    const refs = imageRefsFromRaw(prepared.raw);
    if (!refs.length) {
      const index = { assets: [], missing: [], cacheHit: false, indexPath };
      await writeJsonAtomic(indexPath, index);
      return index;
    }

    const { data } = await api.getImageFills(prepared.ref.fileKey);
    const imageMap = data.meta?.images ?? data.images?.images ?? data.images ?? {};
    const assets = [];
    const missing = [];
    await mapLimit(refs, options.concurrency ?? 4, async (ref) => {
      const url = imageMap[ref];
      if (!url) {
        missing.push(ref);
        return;
      }
      const downloaded = await api.download(url, join(prepared.directory, "assets", ref), { detectExtension: true });
      assets.push({ ref, path: downloaded.path, contentType: downloaded.contentType });
    });
    assets.sort((a, b) => a.ref.localeCompare(b.ref));
    missing.sort();
    const index = { assets, missing, cacheHit: false, indexPath };
    await writeJsonAtomic(indexPath, index);
    return index;
  });
}

export async function inspect(api, ref, options = {}) {
  const boundedOptions = { ...options, depth: options.depth ?? 6 };
  const prepared = await prepareData(api, ref, boundedOptions);
  const screenshot = options.screenshot === false || !ref.nodeIds.length
    ? { paths: [], cacheHit: true }
    : await renderScreenshots(api, prepared, boundedOptions);
  const assets = options.assets ? await downloadAssets(api, prepared, boundedOptions) : undefined;
  await writeJsonAtomic(prepared.paths.evidence, visibleEvidence(prepared.spec, { screenshots: screenshot.paths }));
  await writeTextAtomic(prepared.paths.summary, summaryMarkdown(prepared.spec, {
    screenshots: screenshot.paths,
    evidence: prepared.paths.evidence,
  }));

  const manifest = {
    ok: true,
    source: {
      fileKey: ref.fileKey,
      nodeIds: ref.nodeIds,
      fileName: prepared.spec.source.fileName,
      version: prepared.spec.source.version,
      lastModified: prepared.spec.source.lastModified,
      depth: prepared.depth,
    },
    cache: {
      directory: prepared.directory,
      dataHit: prepared.dataCacheHit,
      screenshotHit: screenshot.cacheHit,
      assetsHit: assets?.cacheHit,
    },
    stats: nodeStats(prepared.spec),
    artifacts: {
      raw: prepared.paths.raw,
      spec: prepared.paths.spec,
      summary: prepared.paths.summary,
      contract: prepared.paths.contract,
      typography: prepared.paths.typography,
      evidence: prepared.paths.evidence,
      screenshots: screenshot.paths,
      assets: assets?.assets ?? [],
      missingAssets: assets?.missing ?? [],
    },
    typography: compactTypography(prepared.spec),
    apiCalls: publicCalls(api),
  };
  await writeJsonAtomic(prepared.paths.manifest, manifest);
  return { manifest, prepared };
}

export async function screenshotOnly(api, ref, options = {}) {
  const depth = options.depth;
  const directory = cacheDirectory(ref, { ...options, depth });
  const prepared = { ref, directory };
  const screenshot = await renderScreenshots(api, prepared, options);
  return {
    ok: true,
    source: { fileKey: ref.fileKey, nodeIds: ref.nodeIds },
    cache: { directory, screenshotHit: screenshot.cacheHit },
    screenshots: screenshot.paths,
    missing: screenshot.missing,
    apiCalls: publicCalls(api),
  };
}

export async function scout(api, ref, intent, options = {}) {
  const depth = options.depth ?? 2;
  const prepared = await prepareData(api, ref, { ...options, depth });
  const result = scoutCandidates(prepared.spec, intent, { limit: options.limit ?? 5 });
  const scoutDirectory = join(prepared.directory, "scouts", scoutCacheKey(intent));
  const hasIntent = Boolean(String(intent ?? "").trim());
  const renderCount = Math.min(options.render ?? (hasIntent ? 2 : 0), result.candidates.length);
  const renderedCandidates = result.candidates.slice(0, renderCount);
  let overviewScreenshot = { paths: [], cacheHit: true };
  let candidateScreenshots = { paths: [], cacheHit: true };

  if (options.screenshot !== false && ref.nodeIds.length) {
    overviewScreenshot = await renderScreenshots(
      api,
      { ref, directory: join(prepared.directory, "overview") },
      { ...options, scale: 0.25 },
    );
  }

  if (renderedCandidates.length) {
    candidateScreenshots = await renderScreenshots(
      api,
      {
        ref: {
          fileKey: ref.fileKey,
          nodeIds: renderedCandidates.map((candidate) => candidate.id),
        },
        directory: join(prepared.directory, "renders"),
      },
      { ...options, scale: options.scale ?? 1 },
    );
    renderedCandidates.forEach((candidate, index) => {
      candidate.screenshot = candidateScreenshots.paths[index];
    });
  }

  const root = prepared.spec.nodes[0];
  const detailsPath = join(scoutDirectory, "details.json");
  const details = {
    ok: true,
    source: {
      fileKey: ref.fileKey,
      wrapperNodeIds: ref.nodeIds,
      fileName: prepared.spec.source.fileName,
      version: prepared.spec.source.version,
      lastModified: prepared.spec.source.lastModified,
    },
    intent: result.intent,
    normalizedIntent: result.normalizedIntent,
    queryTokens: result.queryTokens,
    mode: result.mode,
    candidateCount: result.candidateCount,
    designCandidateCount: result.designCandidateCount,
    topLevelDesignCount: result.topLevelDesignCount,
    topLevelKindCounts: result.topLevelKindCounts,
    states: result.states,
    context: result.context,
    matchedContext: result.matchedContext,
    candidates: result.candidates,
    overviewScreenshot: overviewScreenshot.paths[0],
    cache: {
      directory: prepared.directory,
      dataHit: prepared.dataCacheHit,
      overviewHit: overviewScreenshot.cacheHit,
      candidatesHit: candidateScreenshots.cacheHit,
    },
    apiCalls: publicCalls(api),
  };
  await writeJsonAtomic(detailsPath, details);

  return {
    ok: true,
    source: {
      fileKey: ref.fileKey,
      wrapperNodeIds: ref.nodeIds,
      fileName: prepared.spec.source.fileName,
      lastModified: prepared.spec.source.lastModified,
    },
    overview: {
      id: root?.id,
      name: root?.name,
      type: root?.type,
      size: root?.bounds && { width: root.bounds.width, height: root.bounds.height },
      description: overviewDescription(root, result, depth),
      states: result.states,
      collection: result.collection,
      context: result.context,
      screenshot: overviewScreenshot.paths[0],
    },
    discovery: {
      intent: String(intent ?? ""),
      mode: result.mode,
      depth,
      indexed: result.candidateCount,
      topLevelDesignCandidates: result.topLevelDesignCount,
      returned: hasIntent ? result.candidates.length : result.states.length,
      matchedContext: result.matchedContext.length ? result.matchedContext : undefined,
    },
    candidates: hasIntent
      ? result.candidates.map((candidate) => compactCandidate(candidate, hasIntent, root?.bounds))
      : undefined,
    next: nextCommands(ref, result, depth, hasIntent),
    cache: details.cache,
    artifacts: { details: detailsPath },
    apiCalls: details.apiCalls,
  };
}

export async function focus(api, ref, nodeId, options = {}) {
  const directSelection = ref.nodeIds.length === 1 && ref.nodeIds[0] === nodeId;
  let wrapperPrepared;
  if (!directSelection) {
    wrapperPrepared = await prepareData(api, ref, { ...options, depth: 2 });
    const catalogNode = findSpecNode(wrapperPrepared.spec, nodeId);
    if (!catalogNode) {
      throw new Error(`Node ${nodeId} is not inside the cached wrapper subtree`);
    }
  }

  const selectedRef = { ...ref, nodeIds: [nodeId] };
  const selectedDepth = options.depth ?? 6;
  const selectedOutput = options.output
    ? join(wrapperPrepared?.directory ?? options.output, "focused", safeId(nodeId))
    : undefined;
  const prepared = await prepareData(api, selectedRef, {
    ...options,
    output: selectedOutput,
    depth: selectedDepth,
  });
  const node = prepared.spec.nodes[0];
  const directory = prepared.directory;
  const spec = {
    schemaVersion: prepared.spec.schemaVersion,
    source: {
      ...prepared.spec.source,
      wrapperNodeIds: ref.nodeIds,
      nodeIds: [nodeId],
    },
    nodes: [node],
  };
  const paths = {
    spec: join(directory, "spec.json"),
    summary: join(directory, "summary.md"),
    contract: join(directory, "contract.json"),
    typography: join(directory, "typography.json"),
    evidence: join(directory, "visible-evidence.json"),
    manifest: join(directory, "manifest.json"),
  };
  let screenshot = { paths: [], cacheHit: true };
  if (options.screenshot !== false) {
    screenshot = await renderScreenshots(
      api,
      {
        ref: { fileKey: ref.fileKey, nodeIds: [nodeId] },
        directory: join(wrapperPrepared?.directory ?? prepared.directory, "renders"),
      },
      { ...options, scale: options.scale ?? 1 },
    );
  }
  const visualAssets = await prepareVisualAssets(api, spec, ref, directory, options);
  await writeJsonAtomic(paths.spec, spec);
  await writeJsonAtomic(paths.contract, implementationContract(spec));
  const typography = typographyCatalog(spec);
  await writeJsonAtomic(paths.typography, typography);
  const evidence = visibleEvidence(spec, { screenshots: screenshot.paths });
  await writeJsonAtomic(paths.evidence, evidence);
  await writeTextAtomic(paths.summary, summaryMarkdown(spec, {
    screenshots: screenshot.paths,
    evidence: paths.evidence,
  }));
  const manifest = {
    ok: true,
    source: spec.source,
    selected: {
      id: node.id,
      name: node.name,
      type: node.type,
      bounds: node.bounds,
      depth: prepared.depth,
      evidence: paths.evidence,
      visibleTextCount: evidence.states[0]?.visibleTextCount ?? 0,
    },
    cache: {
      directory: prepared.directory,
      wrapperDirectory: wrapperPrepared?.directory,
      wrapperDataHit: wrapperPrepared?.dataCacheHit,
      dataHit: prepared.dataCacheHit,
      screenshotHit: screenshot.cacheHit,
    },
    artifacts: {
      spec: paths.spec,
      summary: paths.summary,
      contract: paths.contract,
      evidence: paths.evidence,
      typography: paths.typography,
      screenshots: screenshot.paths,
    },
    typography: compactTypography(spec),
    fidelity: {
      lockedState: node.id,
      hiddenSubtreesExcluded: true,
      evidenceCoverage: evidence.states[0]?.coverage.status ?? "bounded-unknown",
      sourceOfTruth: [paths.evidence, screenshot.paths[0]].filter(Boolean),
      instruction: evidence.fidelityRule,
    },
    visualAssets,
    apiCalls: publicCalls(api),
  };
  await writeJsonAtomic(paths.manifest, manifest);
  return manifest;
}

export async function focusMany(api, ref, nodeIds, options = {}) {
  const uniqueIds = [...new Set(nodeIds)];
  if (uniqueIds.length < 2) throw new Error("focus-set requires at least two node IDs");
  if (uniqueIds.length > 6) throw new Error("focus-set accepts at most six representative states");

  const wrapperPrepared = await prepareData(api, ref, { ...options, depth: 2 });
  const missing = uniqueIds.filter((nodeId) => !findSpecNode(wrapperPrepared.spec, nodeId));
  if (missing.length) {
    throw new Error(`Node(s) ${missing.join(", ")} are not inside the cached wrapper subtree`);
  }

  const selectedRef = { ...ref, nodeIds: uniqueIds };
  // A representative state set multiplies instance metadata quickly. Depth 6
  // retains the same compact summary for the observed modal boards while
  // avoiding hundreds of megabytes of repeated raw component metadata.
  const selectedDepth = options.depth ?? 6;
  const selectedOutput = options.output
    ? join(wrapperPrepared.directory, "focused", uniqueIds.map(safeId).join("+"))
    : undefined;
  const prepared = await prepareData(api, selectedRef, {
    ...options,
    output: selectedOutput,
    depth: selectedDepth,
  });
  const spec = {
    schemaVersion: prepared.spec.schemaVersion,
    source: {
      ...prepared.spec.source,
      wrapperNodeIds: ref.nodeIds,
      nodeIds: uniqueIds,
    },
    nodes: prepared.spec.nodes,
  };
  const paths = {
    spec: join(prepared.directory, "spec.json"),
    summary: join(prepared.directory, "summary.md"),
    contract: join(prepared.directory, "contract.json"),
    typography: join(prepared.directory, "typography.json"),
    evidence: join(prepared.directory, "visible-evidence.json"),
    manifest: join(prepared.directory, "manifest.json"),
  };
  let screenshots = { paths: [], cacheHit: true };
  if (options.screenshot !== false) {
    screenshots = await renderScreenshots(
      api,
      { ref: selectedRef, directory: join(wrapperPrepared.directory, "renders") },
      { ...options, scale: options.scale ?? 1 },
    );
  }
  const visualAssets = await prepareVisualAssets(api, spec, ref, prepared.directory, options);
  await writeJsonAtomic(paths.spec, spec);
  await writeJsonAtomic(paths.contract, implementationContract(spec));
  const typography = typographyCatalog(spec);
  await writeJsonAtomic(paths.typography, typography);
  const evidence = visibleEvidence(spec, { screenshots: screenshots.paths });
  await writeJsonAtomic(paths.evidence, evidence);
  const stateEvidencePaths = [];
  for (const state of evidence.states) {
    const stateEvidencePath = join(prepared.directory, `visible-evidence-${safeId(state.id)}.json`);
    await writeJsonAtomic(stateEvidencePath, {
      schemaVersion: evidence.schemaVersion,
      source: evidence.source,
      fidelityRule: evidence.fidelityRule,
      state,
    });
    stateEvidencePaths.push(stateEvidencePath);
  }
  await writeTextAtomic(paths.summary, summaryMarkdown(spec, {
    screenshots: screenshots.paths,
    evidence: paths.evidence,
  }));
  const manifest = {
    ok: true,
    source: spec.source,
    selected: prepared.spec.nodes.map((node, index) => ({
      id: node.id,
      name: node.name,
      type: node.type,
      bounds: node.bounds,
      depth: prepared.depth,
      screenshot: screenshots.paths[index],
      evidence: stateEvidencePaths[index],
      visibleTextCount: evidence.states[index]?.visibleTextCount ?? 0,
    })),
    cache: {
      directory: prepared.directory,
      wrapperDirectory: wrapperPrepared.directory,
      wrapperDataHit: wrapperPrepared.dataCacheHit,
      dataHit: prepared.dataCacheHit,
      screenshotsHit: screenshots.cacheHit,
    },
    artifacts: {
      spec: paths.spec,
      summary: paths.summary,
      contract: paths.contract,
      evidence: paths.evidence,
      typography: paths.typography,
      stateEvidence: stateEvidencePaths,
      screenshots: screenshots.paths,
    },
    typography: compactTypography(spec),
    fidelity: {
      hiddenSubtreesExcluded: true,
      evidenceCoverage: evidence.states.map((state) => ({ id: state.id, status: state.coverage.status })),
      baselineRequired: "Choose exactly one selected state as the visual baseline before implementation. Its screenshot and state evidence are authoritative; other states only justify visible transitions.",
      instruction: evidence.fidelityRule,
    },
    visualAssets,
    apiCalls: publicCalls(api),
  };
  await writeJsonAtomic(paths.manifest, manifest);
  return manifest;
}

export async function extractTarget(api, ref, intent, options = {}) {
  const discovery = await scout(api, ref, intent, {
    ...options,
    depth: options.discoveryDepth ?? 2,
    limit: options.limit ?? 5,
    render: 0,
    screenshot: false,
    scale: options.scale ?? 1,
  });
  const root = discovery.overview;
  const rootSize = root.size ?? {};
  const states = discovery.overview.states ?? [];
  const statefulCollection = discovery.overview.collection?.requiresRepresentativeFocusSet === true;
  const looksLikeWrapper = root.type === "SECTION" || (
    states.length >= 2 && ((rootSize.width ?? 0) > 2_000 || (rootSize.height ?? 0) > 2_000)
  );
  const candidate = discovery.candidates?.[0];
  const singleStateMatch = states.length === 1 && candidate?.id === states[0].id;
  const selectedId = looksLikeWrapper
    ? ((candidate?.confidence === "high" || singleStateMatch) ? candidate.id : undefined)
    : root.id;

  if (statefulCollection) {
    const catalog = await scout(api, ref, "", {
      ...options,
      depth: options.discoveryDepth ?? 2,
      limit: options.limit ?? 5,
      render: 0,
      screenshot: true,
      scale: 0.25,
    });
    return {
      ok: true,
      source: catalog.source,
      resolution: {
        required: true,
        kind: "stateful-component",
        reason: "The linked wrapper represents one component across multiple states; generic one-state extraction is unsafe.",
        intent,
        overview: catalog.overview,
        stateCount: states.length,
        representativeStates: catalog.overview.collection.representativeStates,
        next: {
          scout: `figma-lens scout ${shellArg(ref.source)}`,
          focusSet: focusSetCommand(ref, catalog.overview.collection.representativeStates),
        },
      },
      cache: catalog.cache,
      artifacts: catalog.artifacts,
      apiCalls: publicCalls(api),
    };
  }

  if (!selectedId) {
    return {
      ok: true,
      source: discovery.source,
      resolution: {
        required: true,
        reason: candidate
          ? `Top intent match is ${candidate.confidence} confidence; inspect a rendered candidate before deep extraction.`
          : "No implementation candidate matched the requested intent.",
        intent,
        wrapper: root,
        states,
        candidates: discovery.candidates,
        next: {
          scout: `figma-lens scout ${shellArg(ref.source)} --intent ${shellArg(intent)} --render 2 --no-screenshot`,
          focus: discovery.next?.focus,
        },
      },
      cache: discovery.cache,
      artifacts: discovery.artifacts,
      apiCalls: publicCalls(api),
    };
  }

  const focused = await focus(api, ref, selectedId, {
    ...options,
    depth: options.depth ?? 6,
    scale: options.scale ?? 1,
  });
  return {
    ok: true,
    source: discovery.source,
    resolution: {
      required: false,
      mode: looksLikeWrapper ? "intent-match" : "linked-node",
      intent,
      wrapper: root,
      candidate: looksLikeWrapper ? candidate : undefined,
    },
    selected: focused.selected,
    cache: focused.cache,
    artifacts: focused.artifacts,
    typography: {
      visibleTextNodes: focused.typography.visibleTextNodes,
      mixedStyleNodes: focused.typography.mixedStyleNodes,
      fontFaces: focused.typography.fontFaces,
      availability: focused.typography.availability,
      artifact: focused.artifacts.typography,
    },
    visualAssets: focused.visualAssets,
    apiCalls: publicCalls(api),
  };
}

function splitDetailIntents(intent) {
  return String(intent ?? "")
    .split(/\s*[,;|]\s*/)
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 6);
}

function stdoutDetailGeometry(style = {}) {
  const layout = style.layout ?? {};
  return {
    layout: {
      mode: layout.mode,
      wrap: layout.wrap,
      itemSpacing: layout.itemSpacing,
      counterAxisSpacing: layout.counterAxisSpacing,
      padding: layout.padding,
      primaryAlign: layout.primaryAlign,
      counterAlign: layout.counterAlign,
      primarySizing: layout.primarySizing,
      counterSizing: layout.counterSizing,
      grow: layout.grow,
      clipsContent: layout.clipsContent,
    },
    fills: style.fills,
    strokes: style.strokes,
    cornerRadius: style.cornerRadius,
    effects: style.effects,
  };
}

function chooseDetailCandidates(spec, intent, limit) {
  const parts = splitDetailIntents(intent);
  if (parts.length <= 1) return detailCandidates(spec, intent, { limit });
  const selected = [];
  for (const part of parts) {
    const candidate = detailCandidates(spec, part, { limit: 1 })[0];
    if (candidate && !selected.some((item) => item.id === candidate.id)) {
      selected.push({ ...candidate, intent: part });
    }
  }
  return selected.slice(0, limit).map((candidate, index) => ({ ...candidate, rank: index + 1 }));
}

export async function detail(api, ref, intent, options = {}) {
  if (ref.nodeIds.length !== 1) throw new Error("detail requires one focused Figma node URL or --node ID");
  const depth = options.depth ?? 6;
  const prepared = await prepareData(api, ref, { ...options, depth });
  const limit = options.limit ?? 12;
  const catalog = chooseDetailCandidates(prepared.spec, intent, limit);
  const renderCount = Math.min(options.render ?? (intent ? 4 : 0), catalog.length);
  const rendered = catalog.slice(0, renderCount);
  let screenshots = { paths: [], cacheHit: true };
  if (rendered.length && options.screenshot !== false) {
    screenshots = await renderScreenshots(
      api,
      {
        ref: { fileKey: ref.fileKey, nodeIds: rendered.map((candidate) => candidate.id) },
        directory: join(prepared.directory, "details"),
      },
      { ...options, scale: options.scale ?? 2 },
    );
  }
  const renderedById = new Map(rendered.map((candidate, index) => [candidate.id, screenshots.paths[index]]));
  const explicitIntentCount = Math.max(1, splitDetailIntents(intent).length);
  const typographyCandidates = rendered.length ? rendered : catalog.slice(0, Math.min(4, explicitIntentCount));
  const returnedCandidates = intent
    ? catalog.slice(0, Math.max(renderCount, explicitIntentCount))
    : catalog;
  const detailSpec = {
    ...prepared.spec,
    nodes: typographyCandidates.map((candidate) => findSpecNode(prepared.spec, candidate.id)).filter(Boolean),
  };
  const detailEvidencePath = join(prepared.directory, "details", `visible-evidence-${scoutCacheKey(intent)}.json`);
  await writeJsonAtomic(detailEvidencePath, visibleEvidence(detailSpec, { screenshots: screenshots.paths }));
  const detailArtifacts = [];
  const details = [];
  for (const candidate of returnedCandidates) {
    const screenshot = renderedById.get(candidate.id);
    const scale = options.scale ?? 2;
    const artifact = join(prepared.directory, "details", `detail-${safeId(candidate.id)}.json`);
    await writeJsonAtomic(artifact, candidate);
    detailArtifacts.push(artifact);
    details.push({
      rank: candidate.rank,
      intent: candidate.intent,
      id: candidate.id,
      name: candidate.name,
      type: candidate.type,
      path: candidate.path,
      size: candidate.size,
      position: candidate.position,
      text: candidate.text,
      geometry: stdoutDetailGeometry(candidate.style),
      typography: screenshot || candidate.intent || (renderCount === 0 && candidate.rank <= Math.min(4, explicitIntentCount))
        ? candidate.typography
        : undefined,
      childCount: candidate.children?.length ?? 0,
      screenshot,
      artifact,
      renderSize: screenshot && candidate.style?.bounds
        ? `${Math.round(candidate.style.bounds.width * scale)}×${Math.round(candidate.style.bounds.height * scale)} px at ${scale}×`
        : undefined,
    });
  }
  const manifestPath = join(prepared.directory, "details", `manifest-${scoutCacheKey(intent)}.json`);
  const manifest = {
    ok: true,
    source: {
      fileKey: ref.fileKey,
      nodeId: ref.nodeIds[0],
      fileName: prepared.spec.source.fileName,
      depth: prepared.depth,
    },
    intent: String(intent ?? ""),
    overview: {
      id: prepared.spec.nodes[0]?.id,
      name: prepared.spec.nodes[0]?.name,
      size: prepared.spec.nodes[0]?.bounds && `${prepared.spec.nodes[0].bounds.width}×${prepared.spec.nodes[0].bounds.height}`,
      warning: "The parent screenshot is navigation-only: descendants may be visually tiny. Implement detail only after viewing an isolated source-size render below.",
    },
    typography: compactTypography(detailSpec),
    details,
    artifacts: {
      contract: prepared.paths.contract,
      evidence: prepared.paths.evidence,
      detailEvidence: detailEvidencePath,
      manifest: manifestPath,
      details: detailArtifacts,
      screenshots: screenshots.paths,
    },
    next: {
      guidance: "View each returned detail screenshot at original pixels. Apply each detail's exact typography before measuring layout; verify the named font family/weight is loaded in the destination and never silently substitute a fallback. Read a detail artifact only when compact geometry is insufficient; never base64 or inline image bytes into model context.",
      export: details.map((candidate) =>
        `figma-lens export ${shellArg(ref.source)} --node ${shellArg(candidate.id)} --format svg`),
    },
    cache: {
      directory: prepared.directory,
      dataHit: prepared.dataCacheHit,
      dataDerivedFrom: prepared.dataDerivedFrom,
      screenshotsHit: screenshots.cacheHit,
    },
    apiCalls: publicCalls(api),
  };
  await writeJsonAtomic(manifestPath, manifest);
  return manifest;
}

export function treeFromPrepared(prepared, options) {
  return specTree(prepared.spec, options);
}

export function compactPathList(paths) {
  return Object.fromEntries(Object.entries(paths).map(([key, value]) => [key, Array.isArray(value) ? value.map(basename) : basename(value)]));
}

export { mapLimit };
