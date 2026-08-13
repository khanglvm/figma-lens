import { FigmaApi, FigmaApiError } from "./api.js";
import { readFile } from "node:fs/promises";
import { credentialPath, readStoredCredential, removeCredential, resolveTokenSync, storeCredential } from "./credentials.js";
import { checkImplementationCopy } from "./copy.js";
import { parseFigmaRef, parseNodeIds } from "./ref.js";
import { evidenceCoverage, searchSpec } from "./simplify.js";
import { FIGMA_LENS_VERSION } from "./version.js";
import {
  downloadAssets,
  detail,
  extractTarget,
  focus,
  focusMany,
  inspect,
  prepareData,
  scout,
  screenshotOnly,
  treeFromPrepared,
} from "./workflow.js";

const HELP = `figma-lens — token-efficient, headless Figma inspection over CLI or MCP

Usage:
  figma-lens auth <login|status|logout|path>
  figma-lens mcp [--http] [--host 127.0.0.1] [--port 3333]
  figma-lens extract <url-or-key> --intent <target> [options]
  figma-lens detail <focused-url> [--intent <child-groups>] [options]
  figma-lens inspect <url-or-key> [options]
  figma-lens scout <wrapper-url> [intent] [options]
  figma-lens focus <wrapper-url> --select <node-id> [options]
  figma-lens focus-set <wrapper-url> --select <node-ids> [options]
  figma-lens spec <url-or-key> [options]
  figma-lens tree <url-or-key> [options]
  figma-lens search <url-or-key> <query> [options]
  figma-lens evidence-check <url-or-key> --text <visible-copy> [options]
  figma-lens copy-check <visible-evidence.json> <jsx-or-tsx-files...> [options]
  figma-lens screenshot <url-or-key> [options]
  figma-lens export <url-or-key> --node <ids> --format <svg|png> [options]
  figma-lens assets <url-or-key> [options]
  figma-lens doctor

Options:
  --node <ids>          Comma-separated node IDs; inferred from a node URL
  --depth <n>           Bound Figma subtree traversal
  --output <directory>  Override the cache/artifact directory
  --scale <n>           Screenshot scale, 0.01–4 (default: 2)
  --format <type>       png, jpg, svg, or pdf (default: png)
  --assets              Download source image fills during inspect
  --export-assets       Batch-export suggested icons/illustrations as SVG
  --no-export-assets    Skip automatic focused icon/illustration SVG exports
  --no-screenshot       Do not render a screenshot during inspect
  --max-depth <n>       Maximum printed tree depth (default: 8)
  --max-nodes <n>       Maximum printed tree nodes (default: 300)
  --limit <n>           Maximum matches (search: 20; scout: 5)
  --render <n>          Candidates/details to batch-render
  --intent <text>       Scout intent; positional intent remains supported
  --text <text>         Exact visible copy for evidence-check; repeat with | separators
  --allow <text>        Exact screenshot-only copy for copy-check; separate with |
  --evidence <paths>    Extra detail evidence for copy-check; separate with commas
  --select <node-id>    Descendant selected by scout for focused extraction
  --concurrency <n>     Parallel file downloads (default: 4)
  --offline             Fail instead of calling Figma on a cache miss
  --refresh             Replace cached remote data
  --token-stdin         Read a one-shot Figma token from stdin (never argv)
  --token-file <path>   Read a one-shot Figma token from a protected file
  --http                Serve MCP over stateless Streamable HTTP (stdio is default)
  --host <address>      HTTP bind address (default: 127.0.0.1)
  --port <n>            HTTP port (default: 3333)
  -h, --help            Show help
`;

const valueFlags = new Set(["node", "depth", "output", "scale", "format", "max-depth", "max-nodes", "limit", "concurrency", "render", "select", "intent", "text", "allow", "evidence", "token-file", "host", "port"]);
const booleanFlags = new Set(["assets", "export-assets", "no-export-assets", "no-screenshot", "offline", "refresh", "help", "use-absolute-bounds", "token-stdin", "http"]);

function parseArgs(args) {
  const positionals = [];
  const flags = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "-h") {
      flags.help = true;
      continue;
    }
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }
    const [rawName, inline] = arg.slice(2).split("=", 2);
    if (booleanFlags.has(rawName)) {
      if (inline !== undefined) throw new Error(`--${rawName} does not accept a value`);
      flags[rawName] = true;
      continue;
    }
    if (!valueFlags.has(rawName)) throw new Error(`Unknown option: --${rawName}`);
    const value = inline ?? args[++index];
    if (value === undefined || value.startsWith("--")) throw new Error(`--${rawName} requires a value`);
    flags[rawName] = value;
  }
  return { positionals, flags };
}

function integer(value, name, fallback) {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`--${name} must be a non-negative integer`);
  return parsed;
}

function number(value, name, fallback) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`--${name} must be a number`);
  return parsed;
}

function positiveInteger(value, name, fallback) {
  const parsed = integer(value, name, fallback);
  if (parsed < 1) throw new Error(`--${name} must be at least 1`);
  return parsed;
}

function optionsFrom(flags) {
  if (flags.offline && flags.refresh) throw new Error("--offline and --refresh cannot be combined");
  return {
    node: flags.node,
    depth: integer(flags.depth, "depth"),
    output: flags.output,
    scale: number(flags.scale, "scale", 2),
    format: flags.format ?? "png",
    assets: Boolean(flags.assets),
    exportAssets: Boolean(flags["export-assets"]),
    screenshot: !flags["no-screenshot"],
    offline: Boolean(flags.offline),
    refresh: Boolean(flags.refresh),
    useAbsoluteBounds: Boolean(flags["use-absolute-bounds"]),
    maxDepth: integer(flags["max-depth"], "max-depth", 8),
    maxNodes: integer(flags["max-nodes"], "max-nodes", 300),
    limit: integer(flags.limit, "limit", 20),
    concurrency: positiveInteger(flags.concurrency, "concurrency", 4),
    render: flags.render === undefined ? undefined : integer(flags.render, "render"),
    select: flags.select,
  };
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8").trim();
}

async function readSecret(prompt = "Figma personal access token: ") {
  if (!process.stdin.isTTY) {
    throw new Error("Interactive login needs a terminal. Use --token-stdin or --token-file for scripts.");
  }
  process.stderr.write(prompt);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");
  let value = "";
  try {
    return await new Promise((resolve, reject) => {
      const onData = (chunk) => {
        for (const character of chunk) {
          if (character === "\r" || character === "\n") {
            process.stdin.off("data", onData);
            process.stderr.write("\n");
            resolve(value.trim());
          } else if (character === "\u0003") {
            process.stdin.off("data", onData);
            reject(new Error("Login cancelled"));
          } else if (character === "\u007f") {
            value = value.slice(0, -1);
          } else {
            value += character;
          }
        }
      };
      process.stdin.on("data", onData);
    });
  } finally {
    process.stdin.setRawMode(false);
    process.stdin.pause();
  }
}

async function explicitToken(flags) {
  if (flags["token-stdin"] && flags["token-file"]) throw new Error("Use only one of --token-stdin or --token-file");
  if (flags["token-stdin"]) return { token: await readStdin(), source: "stdin" };
  if (flags["token-file"]) {
    const source = (await readFile(flags["token-file"], "utf8")).trim();
    const match = source.match(/^\s*(?:export\s+)?FIGMA_(?:ACCESS_)?TOKEN\s*=\s*(.+)\s*$/m);
    let token = (match?.[1] ?? source).trim();
    if ((token.startsWith('"') && token.endsWith('"')) || (token.startsWith("'") && token.endsWith("'"))) token = token.slice(1, -1);
    return { token, source: "file" };
  }
  return resolveTokenSync();
}

async function authCommand(positionals, flags, dependencies) {
  const action = positionals[0];
  if (action === "path") {
    printJson({ path: credentialPath() });
    return 0;
  }
  if (action === "status") {
    const stored = readStoredCredential();
    const resolved = resolveTokenSync();
    printJson({
      configured: Boolean(resolved.token),
      source: resolved.source,
      path: credentialPath(),
      storedAccount: stored?.account,
    });
    return resolved.token ? 0 : 1;
  }
  if (action === "logout") {
    printJson({ ok: true, removed: removeCredential(), path: credentialPath() });
    return 0;
  }
  if (action !== "login") throw new Error("auth requires login, status, logout, or path");
  let resolved = await explicitToken(flags);
  if (!resolved.token) resolved = { token: await readSecret(), source: "interactive" };
  if (!resolved.token) throw new Error("The supplied token is empty");
  const api = dependencies.api ?? new FigmaApi({ token: resolved.token, baseUrl: process.env.FIGMA_API_BASE_URL });
  const { data } = await api.me();
  const path = storeCredential(resolved.token, data);
  printJson({ ok: true, path, account: { id: data.id, handle: data.handle }, source: resolved.source });
  return 0;
}

export async function main(argv = process.argv.slice(2), dependencies = {}) {
  const command = argv[0];
  if (!command || command === "help" || command === "--help" || command === "-h") {
    process.stdout.write(HELP);
    return 0;
  }
  const { positionals, flags } = parseArgs(argv.slice(1));
  if (flags.help) {
    process.stdout.write(HELP);
    return 0;
  }

  if (command === "auth") return authCommand(positionals, flags, dependencies);
  if (command === "mcp") {
    if (flags["token-stdin"]) {
      throw new Error("MCP stdio owns stdin. Use `figma-lens auth login`, FIGMA_TOKEN, or --token-file instead.");
    }
    const resolved = flags["token-file"] ? await explicitToken(flags) : { token: undefined };
    const { startMcp } = await import("./mcp.js");
    return startMcp({
      http: Boolean(flags.http),
      host: flags.host ?? "127.0.0.1",
      port: positiveInteger(flags.port, "port", 3333),
      token: resolved.token,
    });
  }
  if (command === "version" || command === "--version" || command === "-v") {
    process.stdout.write(`figma-lens ${FIGMA_LENS_VERSION}\n`);
    return 0;
  }

  const options = optionsFrom(flags);

  if (command === "copy-check") {
    const result = await checkImplementationCopy(positionals[0], positionals.slice(1), {
      allow: String(flags.allow ?? "").split("|"),
      evidencePaths: String(flags.evidence ?? "").split(",").map((path) => path.trim()).filter(Boolean),
    });
    printJson(result);
    return result.ok ? 0 : 1;
  }

  const resolved = await explicitToken(flags);
  const api = dependencies.api ?? new FigmaApi({ token: resolved.token, baseUrl: process.env.FIGMA_API_BASE_URL });

  if (command === "doctor") {
    const { data, rate } = await api.me();
    printJson({ ok: true, account: { id: data.id, handle: data.handle }, rate, apiCalls: api.calls });
    return 0;
  }

  const input = positionals[0];
  if (!input) throw new Error(`${command} requires a Figma URL or file key`);
  const ref = parseFigmaRef(input, options.node);

  if (command === "extract") {
    const positionalIntent = positionals.slice(1).join(" ").trim();
    if (flags.intent && positionalIntent) throw new Error("Pass extract intent either positionally or with --intent, not both");
    const intent = String(flags.intent ?? positionalIntent).trim();
    if (!intent) throw new Error("extract requires --intent <target>");
    const extractOptions = {
      ...options,
      limit: flags.limit === undefined ? 5 : options.limit,
      scale: flags.scale === undefined ? 1 : options.scale,
      exportAssets: !flags["no-export-assets"],
    };
    printJson(await extractTarget(api, ref, intent, extractOptions));
    return 0;
  }
  if (command === "detail") {
    const positionalIntent = positionals.slice(1).join(" ").trim();
    if (flags.intent && positionalIntent) throw new Error("Pass detail intent either positionally or with --intent, not both");
    const intent = String(flags.intent ?? positionalIntent).trim();
    const detailOptions = {
      ...options,
      depth: flags.depth === undefined ? 6 : options.depth,
      limit: flags.limit === undefined ? 12 : options.limit,
      render: flags.render === undefined ? (intent ? 4 : 0) : options.render,
      scale: flags.scale === undefined ? 2 : options.scale,
    };
    printJson(await detail(api, ref, intent, detailOptions));
    return 0;
  }
  if (command === "inspect") {
    const result = await inspect(api, ref, options);
    printJson(result.manifest);
    return 0;
  }
  if (command === "scout") {
    const positionalIntent = positionals.slice(1).join(" ").trim();
    if (flags.intent && positionalIntent) throw new Error("Pass scout intent either positionally or with --intent, not both");
    const intent = String(flags.intent ?? positionalIntent).trim();
    const scoutOptions = {
      ...options,
      depth: flags.depth === undefined ? 2 : options.depth,
      limit: flags.limit === undefined ? 5 : options.limit,
      render: flags.render === undefined ? (intent ? 2 : 0) : options.render,
      scale: flags.scale === undefined ? 1 : options.scale,
    };
    printJson(await scout(api, ref, intent, scoutOptions));
    return 0;
  }
  if (command === "focus") {
    if (!options.select) throw new Error("focus requires --select <node-id>");
    const selectedIds = parseNodeIds(options.select);
    if (selectedIds.length !== 1) throw new Error("focus accepts one node ID; use focus-set for multiple states");
    const focusOptions = {
      ...options,
      scale: flags.scale === undefined ? 1 : options.scale,
      exportAssets: !flags["no-export-assets"],
    };
    printJson(await focus(api, ref, selectedIds[0], focusOptions));
    return 0;
  }
  if (command === "focus-set") {
    if (!options.select) throw new Error("focus-set requires --select <comma-separated-node-ids>");
    const selectedIds = parseNodeIds(options.select);
    const focusOptions = {
      ...options,
      scale: flags.scale === undefined ? 1 : options.scale,
      exportAssets: !flags["no-export-assets"],
    };
    printJson(await focusMany(api, ref, selectedIds, focusOptions));
    return 0;
  }
  if (command === "screenshot" || command === "export") {
    printJson(await screenshotOnly(api, ref, {
      ...options,
      allowMissing: command === "export",
    }));
    return 0;
  }

  const prepared = await prepareData(api, ref, options);
  if (command === "spec") {
    printJson(prepared.spec);
    return 0;
  }
  if (command === "tree") {
    process.stdout.write(`${treeFromPrepared(prepared, options)}\n`);
    return 0;
  }
  if (command === "search") {
    const query = positionals.slice(1).join(" ").trim();
    if (!query) throw new Error("search requires a query");
    printJson({ query, matches: searchSpec(prepared.spec, query, options.limit), apiCalls: api.calls });
    return 0;
  }
  if (command === "evidence-check") {
    const text = String(flags.text ?? positionals.slice(1).join(" ")).trim();
    if (!text) throw new Error("evidence-check requires --text <visible-copy>");
    printJson({
      source: { fileKey: ref.fileKey, nodeIds: ref.nodeIds, depth: prepared.depth },
      coverage: evidenceCoverage(prepared.spec, text.split("|")),
      evidence: prepared.paths.evidence,
      apiCalls: api.calls,
    });
    return 0;
  }
  if (command === "assets") {
    printJson({ ...(await downloadAssets(api, prepared, options)), apiCalls: api.calls });
    return 0;
  }

  throw new Error(`Unknown command: ${command}`);
}

export function formatError(error) {
  if (error instanceof FigmaApiError) {
    return {
      ok: false,
      error: error.message,
      status: error.status,
      rate: error.rate,
    };
  }
  return { ok: false, error: error instanceof Error ? error.message : String(error) };
}

export { HELP };
