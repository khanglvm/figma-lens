import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { detail, extractTarget, focus, focusMany, inspect, prepareData, scout } from "../src/workflow.js";
import { rawFixture } from "../fixtures/raw.js";
import { scoutRawFixture } from "../fixtures/scout.js";

function findRawNode(node, id) {
  if (node.id === id) return node;
  for (const child of node.children ?? []) {
    const found = findRawNode(child, id);
    if (found) return found;
  }
  return undefined;
}

function selectNodeResponse(raw, ids) {
  const source = Object.values(raw.nodes)[0];
  const root = source.document;
  return {
    name: raw.name,
    lastModified: raw.lastModified,
    version: raw.version,
    nodes: Object.fromEntries(ids.map((id) => [id, {
      document: findRawNode(root, id),
      components: source.components,
      styles: source.styles,
    }])),
  };
}

class FakeApi {
  constructor() {
    this.calls = [];
  }

  async getNodes() {
    this.calls.push({ path: "v1/files/AbC123/nodes", status: 200, rate: {} });
    return { data: rawFixture };
  }

  async getRenders(_fileKey, ids) {
    this.calls.push({ path: "v1/images/AbC123", status: 200, rate: {} });
    return { data: { images: Object.fromEntries(ids.map((id) => [id, `mock://${id}`])) } };
  }

  async download(_url, path) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, "image");
    return { path, contentType: "image/png" };
  }
}

class ScoutApi extends FakeApi {
  async getNodes(_fileKey, ids) {
    this.calls.push({ path: "v1/files/Scout123/nodes", status: 200, rate: {} });
    return { data: selectNodeResponse(scoutRawFixture, ids) };
  }

  async getRenders(_fileKey, ids) {
    this.calls.push({ path: "v1/images/Scout123", status: 200, rate: {} });
    return { data: { images: Object.fromEntries(ids.map((id) => [id, `mock://${id}`])) } };
  }
}

class MissingAssetRenderApi extends ScoutApi {
  async getRenders(fileKey, ids) {
    this.calls.push({ path: `v1/images/${fileKey}`, status: 200, rate: {} });
    return {
      data: {
        images: Object.fromEntries(ids
          .filter((id) => id !== "10:33")
          .map((id) => [id, `mock://${id}`])),
      },
    };
  }
}

const ref = { fileKey: "AbC123", nodeIds: ["1:2"], source: "test" };

test("a cold inspect writes an agent bundle and a warm inspect makes zero API calls", async () => {
  const cacheRoot = await mkdtemp(join(tmpdir(), "figma-lens-test-"));
  const coldApi = new FakeApi();
  const cold = await inspect(coldApi, ref, { cacheRoot });
  assert.equal(cold.manifest.apiCalls.length, 2);
  assert.equal(cold.manifest.source.depth, 6);
  assert.equal(cold.manifest.cache.dataHit, false);
  assert.equal(await readFile(cold.manifest.artifacts.screenshots[0], "utf8"), "image");
  assert.match(await readFile(cold.manifest.artifacts.summary, "utf8"), /Payment card/);

  const warmApi = new FakeApi();
  const warm = await inspect(warmApi, ref, { cacheRoot });
  assert.equal(warm.manifest.apiCalls.length, 0);
  assert.equal(warm.manifest.cache.dataHit, true);
  assert.equal(warm.manifest.cache.screenshotHit, true);
});

test("offline mode reports a deterministic cache miss", async () => {
  const cacheRoot = await mkdtemp(join(tmpdir(), "figma-lens-offline-"));
  await assert.rejects(() => prepareData(new FakeApi(), ref, { cacheRoot, offline: true }), /Offline cache miss/);
});

test("offline mode reuses the deepest cached depth when none is specified", async () => {
  const cacheRoot = await mkdtemp(join(tmpdir(), "figma-lens-offline-depth-"));
  await prepareData(new FakeApi(), ref, { cacheRoot, depth: 2 });

  const offlineApi = new FakeApi();
  const prepared = await prepareData(offlineApi, ref, { cacheRoot, offline: true });
  assert.equal(prepared.depth, 2);
  assert.match(prepared.directory, /1-2--d-2$/);
  assert.equal(prepared.dataCacheHit, true);
  assert.equal(offlineApi.calls.length, 0);
});

test("online follow-ups reuse an existing bounded cache instead of fetching an unbounded subtree", async () => {
  const cacheRoot = await mkdtemp(join(tmpdir(), "figma-lens-online-depth-"));
  await prepareData(new FakeApi(), ref, { cacheRoot, depth: 6 });

  const followupApi = new FakeApi();
  const prepared = await prepareData(followupApi, ref, { cacheRoot });
  assert.equal(prepared.depth, 6);
  assert.equal(prepared.dataCacheHit, true);
  assert.equal(followupApi.calls.length, 0);
});

test("concurrent agents share locks instead of duplicating cold API calls", async () => {
  const cacheRoot = await mkdtemp(join(tmpdir(), "figma-lens-concurrent-"));
  const firstApi = new FakeApi();
  const secondApi = new FakeApi();
  const [first, second] = await Promise.all([
    inspect(firstApi, ref, { cacheRoot }),
    inspect(secondApi, ref, { cacheRoot }),
  ]);
  assert.equal(firstApi.calls.length + secondApi.calls.length, 2);
  assert.equal(first.manifest.cache.dataHit || second.manifest.cache.dataHit, true);
});

test("scout stays shallow and focus fetches only the selected node deeply", async () => {
  const cacheRoot = await mkdtemp(join(tmpdir(), "figma-lens-scout-"));
  const scoutRef = { fileKey: "Scout123", nodeIds: ["10:1"], source: "test" };
  const coldApi = new ScoutApi();
  const discovery = await scout(coldApi, scoutRef, "create a project with a smart template", {
    cacheRoot,
    render: 2,
    scale: 1,
    limit: 5,
  });
  assert.equal(discovery.candidates[0].id, "10:3");
  assert.equal(discovery.candidates.filter((candidate) => candidate.screenshot).length, 2);
  assert.ok(discovery.overview.screenshot);
  assert.deepEqual(discovery.overview.states.map((state) => state.id), ["10:2", "10:3", "10:4"]);
  assert.equal(discovery.overview.collection.kind, "screen-collection");
  assert.equal(discovery.next.focusSet, undefined);
  assert.match(discovery.next.focus[0], /--select '10:3'/);
  assert.equal(discovery.discovery.depth, 2);
  assert.equal(coldApi.calls.length, 3);

  const warmApi = new ScoutApi();
  const focused = await focus(warmApi, scoutRef, "10:3", { cacheRoot, scale: 1 });
  assert.equal(focused.selected.name, "Create project - Smart template");
  assert.equal(focused.selected.depth, 6);
  assert.equal(focused.cache.wrapperDataHit, true);
  assert.equal(focused.cache.dataHit, false);
  assert.equal(focused.cache.screenshotHit, true);
  assert.equal(warmApi.calls.length, 1);
  const evidence = JSON.parse(await readFile(focused.artifacts.evidence, "utf8"));
  assert.deepEqual(evidence.states[0].visibleText.map((node) => node.value), [
    "Create Project",
    "Smart template",
  ]);
  assert.equal(evidence.states[0].hiddenSubtrees, 1);
  assert.equal(evidence.states[0].hiddenNodes, 3);
  assert.equal(focused.fidelity.hiddenSubtreesExcluded, true);

  const cachedApi = new ScoutApi();
  const cached = await focus(cachedApi, scoutRef, "10:3", { cacheRoot, scale: 1 });
  assert.equal(cached.cache.dataHit, true);
  assert.equal(cachedApi.calls.length, 0);
});

test("extract resolves a wrapper intent and returns one focused implementation bundle", async () => {
  const cacheRoot = await mkdtemp(join(tmpdir(), "figma-lens-extract-"));
  const scoutRef = { fileKey: "Scout123", nodeIds: ["10:1"], source: "test" };
  const api = new ScoutApi();
  const extracted = await extractTarget(api, scoutRef, "create a project with a smart template", {
    cacheRoot,
    scale: 1,
  });

  assert.equal(extracted.resolution.required, false);
  assert.equal(extracted.resolution.mode, "intent-match");
  assert.equal(extracted.selected.id, "10:3");
  assert.equal(extracted.cache.wrapperDataHit, true);
  assert.equal(extracted.artifacts.screenshots.length, 1);
  assert.equal(api.calls.length, 3);
});

test("focus-set batches representative state data and renders", async () => {
  const cacheRoot = await mkdtemp(join(tmpdir(), "figma-lens-focus-set-"));
  const scoutRef = { fileKey: "Scout123", nodeIds: ["10:1"], source: "test" };
  const api = new ScoutApi();
  const focused = await focusMany(api, scoutRef, ["10:2", "10:4"], { cacheRoot, scale: 1 });

  assert.deepEqual(focused.selected.map((node) => node.id), ["10:2", "10:4"]);
  assert.equal(focused.artifacts.screenshots.length, 2);
  assert.equal(focused.cache.wrapperDataHit, false);
  assert.equal(api.calls.length, 3);
});

test("focus exports stable distinctive visual nodes and writes a compact contract", async () => {
  const cacheRoot = await mkdtemp(join(tmpdir(), "figma-lens-visual-assets-"));
  const scoutRef = { fileKey: "Scout123", nodeIds: ["10:1"], source: "test" };
  const api = new ScoutApi();
  const focused = await focus(api, scoutRef, "10:3", { cacheRoot, scale: 1, exportAssets: true });

  assert.equal(focused.visualAssets.required, true);
  assert.equal(focused.visualAssets.candidates[0].id, "10:33");
  assert.match(focused.visualAssets.candidates[0].exported, /\.svg$/);
  const contract = JSON.parse(await readFile(focused.artifacts.contract, "utf8"));
  assert.equal(contract[0].id, "10:3");
  assert.equal(contract[0].primary[1].id, "10:31");
  assert.equal(contract[0].primary.some((node) => node.id === "10:34"), false);
  assert.equal(focused.visualAssets.candidates.some((node) => node.id === "10:36"), false);
  assert.equal(api.calls.filter((call) => call.path === "v1/images/Scout123").length, 2);
});

test("detail returns source geometry and one batched 2x child render", async () => {
  const cacheRoot = await mkdtemp(join(tmpdir(), "figma-lens-detail-"));
  const focusedRef = { fileKey: "Scout123", nodeIds: ["10:3"], source: "test" };
  const api = new ScoutApi();
  const result = await detail(api, focusedRef, "smart template option", {
    cacheRoot,
    render: 1,
    scale: 2,
  });

  assert.equal(result.details[0].id, "10:31");
  assert.equal(result.details[0].size, "520×96");
  assert.equal(result.details[0].renderSize, "1040×192 px at 2×");
  assert.equal(result.details[0].childCount, 2);
  assert.ok(result.details[0].geometry);
  assert.equal(result.details[0].typography[0].fontFamily, "Inter");
  assert.equal(result.details[0].typography[0].fontWeight, 600);
  assert.equal("children" in result.details[0], false);
  assert.equal(JSON.parse(await readFile(result.details[0].artifact, "utf8")).children.length, 2);
  assert.match(result.details[0].screenshot, /@2x\.png$/);
  const detailEvidence = JSON.parse(await readFile(result.artifacts.detailEvidence, "utf8"));
  assert.deepEqual(detailEvidence.states[0].visibleText.map((row) => row.value), ["Smart template"]);
  assert.equal(detailEvidence.states[0].visibleText[0].typographyRef, "t1");
  assert.equal(result.typography.fontFaces[0].family, "Inter");
  assert.match(result.overview.warning, /navigation-only/);
  assert.equal(api.calls.length, 2);
  assert.equal(result.details.some((candidate) => candidate.id === "10:34"), false);
});

test("detail reuses a focused state already present in a representative batch", async () => {
  const cacheRoot = await mkdtemp(join(tmpdir(), "figma-lens-detail-batch-cache-"));
  const wrapperRef = { fileKey: "Scout123", nodeIds: ["10:1"], source: "test" };
  await focusMany(new ScoutApi(), wrapperRef, ["10:2", "10:3"], { cacheRoot, scale: 1 });

  const api = new ScoutApi();
  const result = await detail(
    api,
    { fileKey: "Scout123", nodeIds: ["10:3"], source: "test" },
    "smart template option",
    { cacheRoot, render: 1, scale: 2 },
  );

  assert.equal(result.cache.dataHit, true);
  assert.match(result.cache.dataDerivedFrom, /10-2\+10-3--d-6$/);
  assert.equal(api.calls.length, 1);
  assert.equal(api.calls[0].path, "v1/images/Scout123");
});

test("one unavailable suggested asset does not fail a focused bundle", async () => {
  const cacheRoot = await mkdtemp(join(tmpdir(), "figma-lens-missing-asset-"));
  const scoutRef = { fileKey: "Scout123", nodeIds: ["10:1"], source: "test" };
  const api = new MissingAssetRenderApi();
  const focused = await focus(api, scoutRef, "10:3", { cacheRoot, scale: 1, exportAssets: true });

  assert.equal(focused.ok, true);
  assert.deepEqual(focused.visualAssets.missing, ["10:33"]);
  assert.equal(focused.visualAssets.candidates[0].exported, undefined);
  assert.equal(focused.artifacts.screenshots.length, 1);
});
