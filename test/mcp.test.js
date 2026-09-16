import assert from "node:assert/strict";
import test from "node:test";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { buildMcpServer } from "../src/mcp.js";

test("MCP advertises one compact read-only Figma workflow", async () => {
  const handler = createMcpHandler(buildMcpServer);
  const transport = new StreamableHTTPClientTransport(new URL("http://test.local/mcp"), {
    fetch: (url, init) => handler.fetch(new Request(url, init)),
  });
  const client = new Client({ name: "figma-lens-test", version: "1.0.0" }, { versionNegotiation: { mode: "auto" } });
  await client.connect(transport);
  try {
    const result = await client.listTools();
    assert.deepEqual(result.tools.map((tool) => tool.name), [
      "figma_lens_context",
      "figma_lens_find",
      "figma_lens_scout",
      "figma_lens_focus",
      "figma_lens_detail",
      "figma_lens_inspect",
      "figma_lens_search",
      "figma_lens_render",
    ]);
    assert.ok(result.tools.every((tool) => tool.annotations?.readOnlyHint === true));
    assert.match(result.tools[1].description, /no file URL/);
    assert.match(result.tools[2].description, /FIRST call/);
    assert.match(result.tools[4].description, /Never estimate/);
  } finally {
    await client.close();
    await handler.close();
  }
});

test("MCP tool descriptions stay compact enough for prompt caches", async () => {
  const handler = createMcpHandler(buildMcpServer);
  const transport = new StreamableHTTPClientTransport(new URL("http://test.local/mcp"), {
    fetch: (url, init) => handler.fetch(new Request(url, init)),
  });
  const client = new Client({ name: "figma-lens-test", version: "1.0.0" }, { versionNegotiation: { mode: "auto" } });
  await client.connect(transport);
  try {
    const result = await client.listTools();
    const bytes = Buffer.byteLength(JSON.stringify(result.tools));
    assert.ok(bytes < 9_000, `tool catalog is ${bytes} bytes`);
  } finally {
    await client.close();
    await handler.close();
  }
});

test("MCP returns bounded validation failures as tool results", async () => {
  const handler = createMcpHandler(buildMcpServer);
  const transport = new StreamableHTTPClientTransport(new URL("http://test.local/mcp"), {
    fetch: (url, init) => handler.fetch(new Request(url, init)),
  });
  const client = new Client({ name: "figma-lens-test", version: "1.0.0" }, { versionNegotiation: { mode: "auto" } });
  await client.connect(transport);
  try {
    const result = await client.callTool({
      name: "figma_lens_detail",
      arguments: { url: "not-a-figma-url", intent: "candidate card", render: 99 },
    });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /Input validation error/);
  } finally {
    await client.close();
    await handler.close();
  }
});
