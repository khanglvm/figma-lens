# CLI reference

Figma Lens is a read-only CLI over the Figma REST API. Commands print compact
JSON manifests to stdout and write larger artifacts to the local cache instead
of placing raw Figma responses in agent context.

## Command index

```text
figma-lens auth <login|status|logout|path>
figma-lens doctor
figma-lens extract <url-or-key> --intent <implementation-target>
figma-lens scout <wrapper-url> [<intent> | --intent <text>] [--render 2]
figma-lens focus <wrapper-url> --select <node-id> [--depth 6]
figma-lens focus-set <wrapper-url> --select <id-1,id-2,...> [--depth 6]
figma-lens detail <focused-url> [--intent <child-groups>] [--render 4] [--scale 2]
figma-lens inspect <url-or-key> [--node 1:2] [--assets] [--refresh]
figma-lens spec <url-or-key> [--node 1:2]
figma-lens tree <url-or-key> [--node 1:2] [--max-depth 6]
figma-lens search <url-or-key> <query> [--node 1:2] [--limit 20]
figma-lens evidence-check <url-or-key> --text <copy|copy>
figma-lens copy-check <visible-evidence.json> <jsx-or-tsx-files...>
figma-lens screenshot <url-or-key> [--node 1:2] [--scale 2]
figma-lens export <url-or-key> --node <ids> --format <svg|png>
figma-lens assets <url-or-key> [--node 1:2]
figma-lens mcp [--http] [--host 127.0.0.1] [--port 3333]
```

Run `figma-lens <command> --help` for the current option list.

## Retrieval commands

### `extract`

Use for one known implementation screen or component. It performs shallow
discovery, resolves the natural-language intent, fetches only the selected node,
renders it, and exports distinctive assets. Low-confidence resolution fails
closed and returns a bounded scout command instead of guessing.

### `scout`

Use for boards, flows, wrappers, and multi-state collections. Catalog mode uses
a depth-2 subtree and a small overview image. It returns ordered states,
context labels, stable node IDs, and copy-ready follow-up commands without
dumping the full candidate ranking.

Add a specific intent only when the overview does not identify the target:

```bash
figma-lens scout "$FIGMA_URL" \
  --intent "screen where a recruiter creates a segment" --render 2
```

Candidates are ranked from names, paths, visible text, dimensions, component
properties, hierarchy, and spatial proximity to annotations such as HOVER,
YES, and NO. Candidate renders are batched into one Figma image request.

### `focus` and `focus-set`

`focus` retrieves one exact candidate. `focus-set` retrieves two to six
representative states in one node request and one render request. Both emit
screenshots, compact summaries, visible evidence, typography, and distinctive
asset exports.

### `detail`

Use once after selecting a visual baseline. It ranks meaningful child groups
inside the focused node and renders the requested groups at source size, 2x by
default. The manifest includes source dimensions, child positions, layout,
fills, strokes, radii, effects, typography, and a compact contract.

Comma-separated intents are resolved independently:

```bash
figma-lens detail "$FOCUSED_URL" \
  --intent "candidate card, query bar, city filter" --render 4 --scale 2
```

### `inspect`, `spec`, `tree`, and `search`

Use `inspect` only for a known exact node outside the design-to-code workflow.
It uses depth 6 by default. `spec` emits compact structured properties. `tree`
and `search` support local investigation; add `--offline` to guarantee no
network request. When depth is omitted, cached queries reuse the deepest
matching subtree.

### `screenshot`, `export`, and `assets`

`screenshot` renders one node. `export` batch-renders selected stable node IDs
as SVG or PNG without fetching their surrounding tree. `assets` fetches image
fills referenced by the selected subtree. Downloads use bounded concurrency.

### Evidence commands

`evidence-check` verifies that screenshot-read strings occur in the bounded
visible evidence. `copy-check` audits JSX/TSX user-facing strings against the
selected state evidence and optional detail evidence without a Figma request.
A non-zero exit means the implementation contains unproven copy or sample data.

## Output and cache

The default `.figma-lens/` cache contains compact specs, summaries,
screenshots, visible evidence, typography catalogs, selected exports, and raw
responses. Stdout contains paths and bounded navigation metadata rather than
the raw payload.

Repeated commands reuse the cache. Use `--refresh` only when current remote
state is required. Atomic writes and cross-process locks prevent concurrent
agents from duplicating the same cold request.

Typical cold request budgets:

- Catalog `scout`: one node request and one overview render.
- Successful `extract`: shallow discovery, one focused node request, one
  focused render, and one batched distinctive-asset render.
- `focus-set`: one batched node request and one batched state render, plus a
  batched asset render when required.
- `detail`: one batched render for all selected child groups after focused data
  is cached.

## Configuration

| Variable | Purpose |
| --- | --- |
| `FIGMA_TOKEN` | Personal access token sent as `X-Figma-Token` |
| `FIGMA_ACCESS_TOKEN` | Alias for `FIGMA_TOKEN` |
| `FIGMA_LENS_ENV_FILE` | Explicit env file containing the token |
| `FIGMA_LENS_CACHE_DIR` | Cache root; defaults to `.figma-lens` |
| `FIGMA_LENS_CONFIG_DIR` | Override the OS config directory |
| `FIGMA_LENS_MCP_TOKEN` | Separate inbound bearer secret for non-loopback MCP HTTP |
| `FIGMA_LENS_ALLOWED_ORIGINS` | Allowed browser origins for non-loopback MCP HTTP |
| `FIGMA_API_BASE_URL` | Test/development API override |
| `FIGMA_MAX_RETRIES` | Transient/network retries; defaults to `2` |
| `FIGMA_MAX_RETRY_AFTER_MS` | Largest 429 delay retried; defaults to `5000` |
| `FIGMA_REQUEST_TIMEOUT_MS` | Per-request timeout; defaults to `30000` |
| `FIGMA_MAX_RESPONSE_BYTES` | Response safety limit; defaults to 128 MiB |

The CLI never auto-loads a project `.env`. Credential precedence and secure CI
patterns are documented in
[authentication and installation](../skills/figma-lens/references/authentication.md).

## Error behavior

Transient network failures and bounded 429 responses are retried. A response
that exceeds the configured size or timeout fails safely. Batched exports
report successful paths and missing optional nodes separately.

If `doctor` succeeds but a file request returns 404, the token is valid but
Figma did not expose that file or node to the token owner. Verify the URL and
the account's existing file access.
