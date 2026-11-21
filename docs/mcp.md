# MCP server

figma-lens can run as an MCP server, so an MCP-capable agent calls the same find, scout, focus and detail steps as native tools. This page covers client setup, the transports and the eight tools with their parameters.

## Connect a client

The server starts with `figma-lens mcp` and talks over stdio by default. It reads the token saved by `figma-lens auth login`, or a `FIGMA_TOKEN` in the host's configuration, so sign in first. See [Authentication](authentication.md).

### Claude Code

```sh
claude mcp add figma-lens -- npx -y figma-lens@latest mcp
```

To pass the token through the host instead of using the saved login:

```sh
claude mcp add --env FIGMA_TOKEN="$FIGMA_TOKEN" figma-lens -- npx -y figma-lens@latest mcp
```

### Codex

```sh
codex mcp add figma-lens -- npx -y figma-lens@latest mcp
```

Or add it to `~/.codex/config.toml`:

```toml
[mcp_servers.figma-lens]
command = "npx"
args = ["-y", "figma-lens@latest", "mcp"]
```

### Other clients

Any client that accepts a stdio server takes the same command:

```json
{
  "mcpServers": {
    "figma-lens": {
      "command": "npx",
      "args": ["-y", "figma-lens@latest", "mcp"]
    }
  }
}
```

If figma-lens is installed globally, use `"command": "figma-lens"` and `"args": ["mcp"]`. Keep the token out of this file when the host can read it from an environment variable. `--token-file <path>` also works, but `--token-stdin` is refused because stdin carries the MCP protocol.

## Search across teams

For `figma_lens_find`, register the teams you want searched once from the CLI, before the server starts:

```sh
figma-lens teams add "https://www.figma.com/files/.../team/TEAM_ID/..."
figma-lens context
```

The token needs `folders:read` as well as the normal file and user scopes. Add `file_metadata:read` for guidance that starts from a design URL. See [Find designs without a link](find-designs.md).

## One shared HTTP endpoint

To serve several clients from one process:

```sh
figma-lens mcp --http --host 127.0.0.1 --port 3333
```

This serves Streamable HTTP at `http://127.0.0.1:3333/mcp` and a health check at `/health`. It uses the stateless per-request model of the 2026-07-28 MCP version and accepts older 2025 clients through the SDK's stateless compatibility path.

On a loopback address, the server checks the Host and Origin headers to block DNS rebinding. It refuses to bind to another address unless `FIGMA_LENS_MCP_TOKEN` is set. Clients must then send it as `Authorization: Bearer ...`. This is a separate secret and must never be the Figma token. Browser origins are rejected unless the comma-separated `FIGMA_LENS_ALLOWED_ORIGINS` lists them. For an internet-facing deployment, put the endpoint behind TLS and an OAuth 2.1 MCP authorization layer. The built-in bearer check is meant for controlled self-hosting.

## Tools

Every tool is read-only. Each returns a compact JSON manifest followed by at most six image blocks. The JSON navigates the design and the images are the main visual evidence. No tool returns the raw Figma document tree. A failed call returns `{"ok": false, "error": "..."}` with the MCP error flag set.

| Tool | Use it to | CLI equivalent |
| --- | --- | --- |
| `figma_lens_context` | Show the account and registered teams, or build a team-setup request from a design URL. | `context` |
| `figma_lens_find` | Search teams, folders and files for a described design. | `find` |
| `figma_lens_scout` | Get the overview and state catalog of a board, flow or multi-state component. Call it first. | `scout` |
| `figma_lens_focus` | Focus one node or 2 to 6 representative states. | `focus`, `focus-set` |
| `figma_lens_detail` | Measure important child groups at source size. | `detail` |
| `figma_lens_inspect` | Inspect one known exact frame or component. | `inspect` |
| `figma_lens_search` | Search names and visible text inside one file URL. | `search` |
| `figma_lens_render` | Render node IDs as PNG, JPG or PDF, or export them as SVG. | `screenshot`, `export` |

### Parameters

All `url` values are Figma `/design` or `/file` URLs, preferably with a `node-id`. `refresh` and `offline` are booleans and default to false.

| Tool | Parameters (defaults in parentheses) |
| --- | --- |
| `figma_lens_context` | `source_url` (optional design URL), `refresh` |
| `figma_lens_find` | `query` (1 to 500 characters), `scope` (up to 200 characters), `team_ids` (up to 8), `max_files` (1 to 30, default 8), `limit` (1 to 8, default 5), `render` (0 to 2, default 2), `depth` (2 to 6, default 3), `offline`, `refresh` |
| `figma_lens_scout` | `url`, `intent` (up to 500 characters; leave it out on the first call), `render` (0 to 2; default 2 with an intent, else 0), `refresh` |
| `figma_lens_focus` | `url`, `node_ids` (1 to 6 IDs such as `12:34`), `depth` (1 to 12, default 6), `scale` (0.25 to 4, default 1), `refresh` |
| `figma_lens_detail` | `url` (a focused single-node URL), `intent` (comma-separated child groups, required), `render` (1 to 4, default 4), `scale` (1 to 4, default 2), `depth` (1 to 12, default 6), `refresh` |
| `figma_lens_inspect` | `url`, `depth` (1 to 12, default 6), `scale` (0.25 to 4, default 2), `refresh` |
| `figma_lens_search` | `url`, `query` (1 to 500 characters), `depth` (1 to 12, default 6), `limit` (1 to 30, default 20), `offline` |
| `figma_lens_render` | `url`, `node_ids` (1 to 20), `format` (`png`, `jpg`, `svg` or `pdf`; default `png`), `scale` (0.01 to 4, default 2), `refresh` |

`figma_lens_focus` exports distinctive assets automatically. `figma_lens_render` skips nodes Figma cannot export and returns no image blocks for `pdf`.

### How an agent uses them

1. `figma_lens_scout` with only `url` for any board, flow or multi-state link. View `overview.screenshot` and read `overview.states`.
2. `figma_lens_focus` with `overview.collection.representativeStates[].implementationId` as `node_ids`, for one call.
3. `figma_lens_detail` once, with the focused node's URL and two to four child groups in `intent`.
4. `figma_lens_render` for icons and illustrations that were not exported automatically.

`figma_lens_find` returns at most the requested number of matches and attaches at most two screenshots. It keeps the full ranking in a local file. An agent should call `figma_lens_context` only when the team or workspace is unclear, and otherwise pass the user's scope straight to `figma_lens_find`.

When no team is registered, an agent passes any design URL it has as `figma_lens_context.source_url`. The tool returns the file and folder names and a question asking the user for the owning team-page URL. After the user answers, run `figma-lens teams add "<PASTED_TEAM_URL>"` and search again. For the full agent rules, see [Use with coding agents](agents.md).
