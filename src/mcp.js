import { timingSafeEqual } from "node:crypto";
import { createServer as createHttpServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { localhostHostValidation, localhostOriginValidation, toNodeHandler } from "@modelcontextprotocol/node";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";
import { FigmaApi } from "./api.js";
import { parseFigmaRef } from "./ref.js";
import { searchSpec } from "./simplify.js";
import { FIGMA_LENS_VERSION } from "./version.js";
import {
  detail,
  focus,
  focusMany,
  inspect,
  prepareData,
  scout,
  screenshotOnly,
} from "./workflow.js";

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true };
const URL = z.string().min(1).describe("Figma /design or /file URL, preferably with node-id");
const BOOL = z.boolean().optional();

function api(token) {
  return new FigmaApi({ token, baseUrl: process.env.FIGMA_API_BASE_URL });
}

function mimeType(path) {
  return ({
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
  })[extname(path).toLowerCase()];
}

function uniquePaths(paths) {
  return [...new Set(paths.flat(Infinity).filter(Boolean))].slice(0, 6);
}

async function toolResult(value, imagePaths = []) {
  const content = [{ type: "text", text: JSON.stringify(value) }];
  for (const path of uniquePaths(imagePaths)) {
    const mime = mimeType(path);
    if (!mime) continue;
    try {
      content.push({ type: "image", data: (await readFile(path)).toString("base64"), mimeType: mime });
    } catch {}
  }
  return { content };
}

function failure(error) {
  return {
    content: [{ type: "text", text: JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }) }],
    isError: true,
  };
}

function register(server, name, config, handler) {
  server.registerTool(name, { ...config, annotations: READ_ONLY }, async (args) => {
    try {
      return await handler(args);
    } catch (error) {
      return failure(error);
    }
  });
}

export function buildMcpServer({ token } = {}) {
  const server = new McpServer({ name: "figma-lens", version: FIGMA_LENS_VERSION });

  register(server, "figma_lens_scout", {
    title: "Scout a Figma design",
    description: "FIRST call for any Figma board, wrapper, flow, collection, or multi-state component. Returns one compact visual overview, ordered state/node catalog, semantic matches, and the exact representative focus set to inspect next. Do not replace returned node IDs with guesses.",
    inputSchema: z.object({
      url: URL,
      intent: z.string().max(500).optional().describe("Optional natural-language target; omit first when the link may contain multiple states"),
      render: z.number().int().min(0).max(2).optional().describe("Intent-match candidate renders; maximum 2"),
      refresh: BOOL,
    }),
  }, async ({ url, intent = "", render, refresh = false }) => {
    const client = api(token);
    const result = await scout(client, parseFigmaRef(url), intent, {
      depth: 2,
      limit: 5,
      render: render ?? (intent ? 2 : 0),
      scale: 1,
      refresh,
    });
    return toolResult(result, [result.overview?.screenshot, result.candidates?.map((item) => item.screenshot)]);
  });

  register(server, "figma_lens_focus", {
    title: "Focus representative Figma states",
    description: "Focus one exact target or 2-6 representative states returned by figma_lens_scout. Returns source-size screenshots, visible-copy evidence, compact geometry, an inline typography catalog with exact font faces/metrics, and exported assets. Choose one baseline and verify its fonts are loaded before implementation.",
    inputSchema: z.object({
      url: URL,
      node_ids: z.array(z.string()).min(1).max(6).describe("Exact node IDs returned by scout, such as 12:34"),
      depth: z.number().int().min(1).max(12).optional(),
      scale: z.number().min(0.25).max(4).optional(),
      refresh: BOOL,
    }),
  }, async ({ url, node_ids: nodeIds, depth = 6, scale = 1, refresh = false }) => {
    const client = api(token);
    const ref = parseFigmaRef(url);
    const result = nodeIds.length === 1
      ? await focus(client, ref, nodeIds[0], { depth, scale, refresh, exportAssets: true })
      : await focusMany(client, ref, nodeIds, { depth, scale, refresh, exportAssets: true });
    return toolResult(result, result.artifacts?.screenshots);
  });

  register(server, "figma_lens_detail", {
    title: "Inspect source-size child details",
    description: "Use once after choosing a focused baseline. Isolates 1-4 important child groups at 1x-4x and returns exact geometry, colors/effects, font family/PostScript face/weight/size/line-height/tracking, mixed-style runs, and image content. Verify fonts locally. Never estimate from a tiny parent preview.",
    inputSchema: z.object({
      url: URL.describe("Focused single-node Figma URL"),
      intent: z.string().max(500).describe("Comma-separated visible child groups, for example candidate card, query bar, city filter"),
      render: z.number().int().min(1).max(4).optional(),
      scale: z.number().min(1).max(4).optional(),
      depth: z.number().int().min(1).max(12).optional(),
      refresh: BOOL,
    }),
  }, async ({ url, intent, render = 4, scale = 2, depth = 6, refresh = false }) => {
    const client = api(token);
    const result = await detail(client, parseFigmaRef(url), intent, { render, scale, depth, refresh });
    return toolResult(result, result.details?.map((item) => item.screenshot));
  });

  register(server, "figma_lens_inspect", {
    title: "Inspect one exact Figma node",
    description: "Bounded inspection for a known exact single frame or component. For boards and multi-state links, use figma_lens_scout. Returns compact spec, screenshot, evidence, and an inline exact typography catalog without dumping raw Figma JSON.",
    inputSchema: z.object({
      url: URL,
      depth: z.number().int().min(1).max(12).optional(),
      scale: z.number().min(0.25).max(4).optional(),
      refresh: BOOL,
    }),
  }, async ({ url, depth = 6, scale = 2, refresh = false }) => {
    const client = api(token);
    const result = await inspect(client, parseFigmaRef(url), { depth, scale, refresh });
    return toolResult(result.manifest, result.manifest?.artifacts?.screenshots);
  });

  register(server, "figma_lens_search", {
    title: "Search a Figma subtree",
    description: "Search node names and visible text inside one bounded Figma subtree using natural-language or keywords. Cache-first and compact; use a focused node URL when possible.",
    inputSchema: z.object({
      url: URL,
      query: z.string().min(1).max(500),
      depth: z.number().int().min(1).max(12).optional(),
      limit: z.number().int().min(1).max(30).optional(),
      offline: BOOL,
    }),
  }, async ({ url, query, depth = 6, limit = 20, offline = false }) => {
    const client = api(token);
    const ref = parseFigmaRef(url);
    const prepared = await prepareData(client, ref, { depth, offline });
    return toolResult({ ok: true, query, matches: searchSpec(prepared.spec, query, limit), apiCalls: client.calls });
  });

  register(server, "figma_lens_render", {
    title: "Render or export exact Figma nodes",
    description: "Render exact node IDs as PNG/JPG/PDF or export vectors as SVG. Use for distinctive icons, illustrations, logos, and raster effects instead of approximating them.",
    inputSchema: z.object({
      url: URL,
      node_ids: z.array(z.string()).min(1).max(20),
      format: z.enum(["png", "jpg", "svg", "pdf"]).optional(),
      scale: z.number().min(0.01).max(4).optional(),
      refresh: BOOL,
    }),
  }, async ({ url, node_ids: nodeIds, format = "png", scale = 2, refresh = false }) => {
    const client = api(token);
    const ref = parseFigmaRef(url, nodeIds.join(","));
    const result = await screenshotOnly(client, ref, { format, scale, refresh, allowMissing: true });
    return toolResult(result, format === "pdf" ? [] : result.screenshots);
  });

  return server;
}

function safeEqual(left, right) {
  const a = Buffer.from(left ?? "");
  const b = Buffer.from(right ?? "");
  return a.length === b.length && timingSafeEqual(a, b);
}

function bearerToken(req) {
  const value = req.headers.authorization ?? "";
  return value.startsWith("Bearer ") ? value.slice(7) : undefined;
}

function isLoopback(host) {
  return host === "127.0.0.1" || host === "::1" || host === "localhost";
}

export async function startMcp({ http = false, host = "127.0.0.1", port = 3333, token } = {}) {
  const factory = () => buildMcpServer({ token });
  if (!http) {
    const handle = serveStdio(factory);
    process.on("SIGINT", () => void handle.close());
    process.on("SIGTERM", () => void handle.close());
    console.error("[figma-lens] MCP stdio ready");
    return 0;
  }

  const local = isLoopback(host);
  const accessToken = process.env.FIGMA_LENS_MCP_TOKEN;
  if (!local && !accessToken) {
    throw new Error("Non-loopback MCP HTTP requires FIGMA_LENS_MCP_TOKEN. This is a separate inbound bearer secret, never the Figma PAT.");
  }
  const allowedOrigins = new Set(String(process.env.FIGMA_LENS_ALLOWED_ORIGINS ?? "").split(",").map((item) => item.trim()).filter(Boolean));
  const handler = createMcpHandler(factory);
  const nodeHandler = toNodeHandler(handler);
  const validateHost = local ? localhostHostValidation() : undefined;
  const validateOrigin = local ? localhostOriginValidation() : undefined;
  const server = createHttpServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"ok":true,"name":"figma-lens"}');
      return;
    }
    if (req.url?.split("?", 1)[0] !== "/mcp") {
      res.writeHead(404).end();
      return;
    }
    if (local) {
      if (!validateHost(req, res) || !validateOrigin(req, res)) return;
    } else {
      const origin = req.headers.origin;
      if (!safeEqual(bearerToken(req), accessToken) || (origin && !allowedOrigins.has(origin))) {
        res.writeHead(403).end();
        return;
      }
    }
    void nodeHandler(req, res);
  });
  server.listen(port, host, () => console.error(`[figma-lens] MCP HTTP ready at http://${host}:${port}/mcp`));
  const close = async () => {
    await handler.close();
    server.close();
  };
  process.on("SIGINT", () => void close());
  process.on("SIGTERM", () => void close());
  return 0;
}
