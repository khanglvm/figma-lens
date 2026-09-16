import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FigmaApi, FigmaApiError } from "../src/api.js";

function chunkedBody(chunks) {
  let index = 0;
  let cancelled = false;
  return {
    stream: new ReadableStream({
      pull(controller) {
        if (index < chunks.length) controller.enqueue(chunks[index++]);
        else controller.close();
      },
      cancel() {
        cancelled = true;
      },
    }, { highWaterMark: 0 }),
    wasCancelled: () => cancelled,
  };
}

test("keeps credentials in headers and captures rate-limit metadata", async () => {
  let request;
  const api = new FigmaApi({
    token: "secret-token",
    fetchImpl: async (url, options) => {
      request = { url: String(url), options };
      return new Response(JSON.stringify({ nodes: {} }), {
        status: 200,
        headers: { "content-type": "application/json", "x-figma-plan-tier": "starter" },
      });
    },
  });
  const result = await api.getNodes("AbC123", ["1:2"]);
  assert.equal(request.options.headers["X-Figma-Token"], "secret-token");
  assert.doesNotMatch(request.url, /secret-token/);
  assert.match(request.url, /ids=1%3A2/);
  assert.equal(result.rate.planTier, "starter");
});

test("uses current folder discovery endpoints without leaking scope data", async () => {
  const requests = [];
  const api = new FigmaApi({
    token: "secret-token",
    fetchImpl: async (url) => {
      requests.push(String(url));
      return new Response(JSON.stringify({ name: "Product", folders: [], files: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
  await api.getTeamFolders("123");
  await api.getFolderFolders("456");
  await api.getFolderFiles("456");
  assert.deepEqual(requests.map((value) => new URL(value).pathname), [
    "/v2/teams/123/folders",
    "/v2/folders/456/folders",
    "/v2/folders/456/files",
  ]);
  assert.ok(requests.every((value) => !value.includes("secret-token")));
});

test("returns actionable 404 errors without exposing the token", async () => {
  const api = new FigmaApi({
    token: "never-print-me",
    fetchImpl: async () => new Response(JSON.stringify({ status: 404, err: "Not found" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    }),
  });
  await assert.rejects(
    () => api.getNodes("Missing", ["1:2"]),
    (error) => error instanceof FigmaApiError && error.status === 404 && !error.message.includes("never-print-me"),
  );
});

test("retries bounded transient failures and records every attempt", async () => {
  let calls = 0;
  const waits = [];
  const api = new FigmaApi({
    token: "token",
    maxRetries: 2,
    sleepImpl: async (milliseconds) => waits.push(milliseconds),
    randomImpl: () => 0,
    fetchImpl: async () => {
      calls += 1;
      if (calls < 3) return new Response("unavailable", { status: 503 });
      return new Response(JSON.stringify({ id: "me" }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  const result = await api.me();
  assert.equal(result.data.id, "me");
  assert.equal(api.calls.length, 3);
  assert.deepEqual(waits, [250, 500]);
});

test("does not sleep through long Figma rate-limit windows", async () => {
  let calls = 0;
  const api = new FigmaApi({
    token: "token",
    maxRetries: 2,
    maxRetryAfterMs: 5_000,
    sleepImpl: async () => assert.fail("long 429 must not be retried"),
    fetchImpl: async () => {
      calls += 1;
      return new Response(JSON.stringify({ err: "Rate limited" }), {
        status: 429,
        headers: { "content-type": "application/json", "retry-after": "86400" },
      });
    },
  });
  await assert.rejects(() => api.me(), (error) => error.status === 429 && error.rate.retryAfter === "86400");
  assert.equal(calls, 1);
});

test("caps chunked JSON responses even when Content-Length lies", async () => {
  const body = chunkedBody([new TextEncoder().encode('{"name":"'), new TextEncoder().encode("too-large".repeat(8)), new TextEncoder().encode('"}')]);
  const api = new FigmaApi({
    token: "token",
    maxResponseBytes: 16,
    fetchImpl: async () => new Response(body.stream, {
      status: 200,
      headers: { "content-type": "application/json", "content-length": "1" },
    }),
  });

  await assert.rejects(() => api.me(), (error) => error instanceof FigmaApiError && error.status === 200 && /safety limit/.test(error.message));
  assert.equal(body.wasCancelled(), true);
});

test("parses chunked JSON below the response limit", async () => {
  const body = chunkedBody([new TextEncoder().encode('{"id":'), new TextEncoder().encode('"me"}')]);
  const api = new FigmaApi({
    token: "token",
    maxResponseBytes: 32,
    fetchImpl: async () => new Response(body.stream, { status: 200, headers: { "content-type": "application/json" } }),
  });

  assert.deepEqual((await api.me()).data, { id: "me" });
  assert.equal(body.wasCancelled(), false);
});

test("caps chunked asset downloads before oversized bytes reach disk", async () => {
  const directory = await mkdtemp(join(tmpdir(), "figma-lens-api-"));
  const destination = join(directory, "asset.png");
  const body = chunkedBody([new Uint8Array([1, 2, 3]), new Uint8Array([4, 5, 6])]);
  const api = new FigmaApi({
    token: "token",
    maxResponseBytes: 4,
    fetchImpl: async () => new Response(body.stream, {
      status: 200,
      headers: { "content-type": "image/png", "content-length": "1" },
    }),
  });
  try {
    await assert.rejects(() => api.download("https://assets.example/asset", destination), (error) => error instanceof FigmaApiError && /safety limit/.test(error.message));
    await assert.rejects(() => readFile(destination));
    assert.deepEqual(await readdir(directory), []);
    assert.equal(body.wasCancelled(), true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("writes chunked asset downloads below the response limit", async () => {
  const directory = await mkdtemp(join(tmpdir(), "figma-lens-api-"));
  const destination = join(directory, "asset.png");
  const body = chunkedBody([new Uint8Array([1, 2]), new Uint8Array([3, 4])]);
  const api = new FigmaApi({
    token: "token",
    maxResponseBytes: 4,
    fetchImpl: async () => new Response(body.stream, { status: 200, headers: { "content-type": "image/png" } }),
  });
  try {
    const result = await api.download("https://assets.example/asset", destination);
    assert.equal(result.path, destination);
    assert.deepEqual(await readFile(destination), Buffer.from([1, 2, 3, 4]));
    assert.equal(body.wasCancelled(), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
