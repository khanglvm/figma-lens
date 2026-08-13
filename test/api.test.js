import assert from "node:assert/strict";
import test from "node:test";
import { FigmaApi, FigmaApiError } from "../src/api.js";

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
