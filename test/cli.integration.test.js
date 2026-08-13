import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { rawFixture } from "../fixtures/raw.js";
import { scoutRawFixture } from "../fixtures/scout.js";

const execFileAsync = promisify(execFile);

test("CLI version exactly matches package metadata", async () => {
  const packageMetadata = JSON.parse(await readFile(resolve("package.json"), "utf8"));
  const result = await execFileAsync(process.execPath, [resolve("bin/figma-lens.js"), "--version"], {
    cwd: resolve("."),
  });

  assert.equal(result.stderr, "");
  assert.equal(result.stdout, `figma-lens ${packageMetadata.version}\n`);
});

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
  return {
    name: raw.name,
    lastModified: raw.lastModified,
    version: raw.version,
    nodes: Object.fromEntries(ids.map((id) => [id, {
      document: findRawNode(source.document, id),
      components: source.components,
      styles: source.styles,
    }])),
  };
}

test("CLI performs a two-request cold inspect and creates a reusable bundle", async (context) => {
  const requests = [];
  const server = createServer((request, response) => {
    requests.push(request.url);
    if (request.url.startsWith("/v1/files/AbC123/nodes")) {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(rawFixture));
      return;
    }
    if (request.url.startsWith("/v1/images/AbC123")) {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ images: { "1:2": `http://127.0.0.1:${server.address().port}/render.png` } }));
      return;
    }
    if (request.url === "/render.png") {
      response.setHeader("content-type", "image/png");
      response.end("mock-png");
      return;
    }
    response.statusCode = 404;
    response.end();
  });
  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  context.after(() => server.close());

  const output = await mkdtemp(join(tmpdir(), "figma-lens-cli-"));
  const result = await execFileAsync(process.execPath, [
    resolve("bin/figma-lens.js"),
    "inspect",
    "https://www.figma.com/design/AbC123/Test?node-id=1-2",
    "--output",
    output,
  ], {
    cwd: resolve("."),
    env: {
      ...process.env,
      FIGMA_TOKEN: "test-token",
      FIGMA_API_BASE_URL: `http://127.0.0.1:${server.address().port}`,
    },
  });

  const manifest = JSON.parse(result.stdout);
  assert.equal(manifest.ok, true);
  assert.equal(manifest.source.depth, 6);
  assert.equal(manifest.apiCalls.length, 2);
  assert.equal(await readFile(manifest.artifacts.screenshots[0], "utf8"), "mock-png");
  assert.equal(requests.filter((url) => url.startsWith("/v1/")).length, 2);
  assert.match(requests.find((url) => url.startsWith("/v1/files/")), /depth=6/);
});

test("CLI evidence-check reports screenshot copy missing from bounded data", async (context) => {
  const server = createServer((request, response) => {
    if (request.url.startsWith("/v1/files/AbC123/nodes")) {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(rawFixture));
      return;
    }
    response.statusCode = 404;
    response.end();
  });
  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  context.after(() => server.close());

  const output = await mkdtemp(join(tmpdir(), "figma-lens-cli-evidence-"));
  const result = await execFileAsync(process.execPath, [
    resolve("bin/figma-lens.js"),
    "evidence-check",
    "AbC123",
    "--node",
    "1:2",
    "--text",
    "Payment details|Missing label",
    "--output",
    output,
  ], {
    cwd: resolve("."),
    env: {
      ...process.env,
      FIGMA_TOKEN: "test-token",
      FIGMA_API_BASE_URL: `http://127.0.0.1:${server.address().port}`,
    },
  });
  const resultJson = JSON.parse(result.stdout);
  assert.equal(resultJson.coverage.complete, false);
  assert.deepEqual(resultJson.coverage.missingFromData, ["Missing label"]);
});

test("CLI scouts shallowly and fetches only the chosen screen during focus", async (context) => {
  const requests = [];
  const server = createServer((request, response) => {
    requests.push(request.url);
    if (request.url.startsWith("/v1/files/Scout123/nodes")) {
      const ids = new URL(request.url, "http://localhost").searchParams.get("ids").split(",");
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(selectNodeResponse(scoutRawFixture, ids)));
      return;
    }
    if (request.url.startsWith("/v1/images/Scout123")) {
      const ids = new URL(request.url, "http://localhost").searchParams.get("ids").split(",");
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({
        images: Object.fromEntries(ids.map((id) => [id, `http://127.0.0.1:${server.address().port}/render/${id}.png`])),
      }));
      return;
    }
    if (request.url.startsWith("/render/")) {
      response.setHeader("content-type", "image/png");
      response.end(`mock-${request.url}`);
      return;
    }
    response.statusCode = 404;
    response.end();
  });
  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  context.after(() => server.close());

  const output = await mkdtemp(join(tmpdir(), "figma-lens-cli-scout-"));
  const url = "https://www.figma.com/design/Scout123/Test?node-id=10-1";
  const environment = {
    ...process.env,
    FIGMA_TOKEN: "test-token",
    FIGMA_API_BASE_URL: `http://127.0.0.1:${server.address().port}`,
  };
  const discovered = await execFileAsync(process.execPath, [
    resolve("bin/figma-lens.js"),
    "scout",
    url,
    "create a project using a smart template",
    "--render",
    "2",
    "--output",
    output,
  ], { cwd: resolve("."), env: environment });
  const scoutManifest = JSON.parse(discovered.stdout);
  assert.equal(scoutManifest.candidates[0].id, "10:3");
  assert.equal(scoutManifest.candidates.filter((candidate) => candidate.screenshot).length, 2);
  assert.ok(scoutManifest.overview.screenshot);
  assert.deepEqual(scoutManifest.overview.states.map((state) => state.id), ["10:2", "10:3", "10:4"]);
  assert.match(scoutManifest.next.focus[0], /--select '10:3'/);
  assert.equal(scoutManifest.discovery.depth, 2);
  assert.ok(Buffer.byteLength(discovered.stdout) < 5_000);
  assert.equal(scoutManifest.apiCalls.length, 3);

  const aliased = await execFileAsync(process.execPath, [
    resolve("bin/figma-lens.js"),
    "scout",
    url,
    "--intent",
    "create a project using a smart template",
    "--render",
    "0",
    "--output",
    output,
  ], { cwd: resolve("."), env: environment });
  const aliasManifest = JSON.parse(aliased.stdout);
  assert.equal(aliasManifest.discovery.intent, "create a project using a smart template");
  assert.equal(aliasManifest.apiCalls.length, 0);

  const focused = await execFileAsync(process.execPath, [
    resolve("bin/figma-lens.js"),
    "focus",
    url,
    "--select",
    "10:3",
    "--output",
    output,
  ], { cwd: resolve("."), env: environment });
  const focusManifest = JSON.parse(focused.stdout);
  assert.equal(focusManifest.selected.id, "10:3");
  assert.equal(focusManifest.apiCalls.length, 2);
  assert.equal(focusManifest.visualAssets.candidates[0].id, "10:33");
  assert.equal(requests.filter((request) => request.startsWith("/v1/")).length, 5);

  const extractOutput = await mkdtemp(join(tmpdir(), "figma-lens-cli-extract-"));
  const extracted = await execFileAsync(process.execPath, [
    resolve("bin/figma-lens.js"),
    "extract",
    url,
    "--intent",
    "create a project using a smart template",
    "--output",
    extractOutput,
  ], { cwd: resolve("."), env: environment });
  const extractManifest = JSON.parse(extracted.stdout);
  assert.equal(extractManifest.resolution.required, false);
  assert.equal(extractManifest.resolution.mode, "intent-match");
  assert.equal(extractManifest.selected.id, "10:3");
  assert.equal(extractManifest.apiCalls.length, 4);
  assert.ok(Buffer.byteLength(extracted.stdout) < 5_000);
  assert.equal(requests.filter((request) => request.startsWith("/v1/")).length, 9);

  const setOutput = await mkdtemp(join(tmpdir(), "figma-lens-cli-focus-set-"));
  const focusedSet = await execFileAsync(process.execPath, [
    resolve("bin/figma-lens.js"),
    "focus-set",
    url,
    "--select",
    "10:2,10:4",
    "--output",
    setOutput,
  ], { cwd: resolve("."), env: environment });
  const setManifest = JSON.parse(focusedSet.stdout);
  assert.deepEqual(setManifest.selected.map((node) => node.id), ["10:2", "10:4"]);
  assert.equal(setManifest.apiCalls.length, 3);
  assert.equal(requests.filter((request) => request.startsWith("/v1/")).length, 12);

  const exportOutput = await mkdtemp(join(tmpdir(), "figma-lens-cli-export-"));
  const exported = await execFileAsync(process.execPath, [
    resolve("bin/figma-lens.js"),
    "export",
    url,
    "--node",
    "10:31",
    "--format",
    "svg",
    "--output",
    exportOutput,
  ], { cwd: resolve("."), env: environment });
  const exportManifest = JSON.parse(exported.stdout);
  assert.match(exportManifest.screenshots[0], /\.svg$/);
  assert.equal(exportManifest.apiCalls.length, 1);
  assert.equal(requests.filter((request) => request.startsWith("/v1/")).length, 13);
});
