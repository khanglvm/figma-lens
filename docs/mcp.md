# MCP mode

Figma Lens exposes the same compact, visual-first workflow as native MCP tools.
The default transport is local stdio:

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

The process uses the credential saved by `figma-lens auth login`, or a
`FIGMA_TOKEN` supplied in the MCP host configuration. A protected
`--token-file` is also supported. Keep secrets out of the JSON file when the
host supports environment-variable references; `--token-stdin` is deliberately
unavailable because stdio is the MCP protocol channel.

For cross-file discovery, register searchable teams once from the CLI before
starting the MCP server:

```bash
figma-lens teams add "https://www.figma.com/files/.../team/TEAM_ID/..."
figma-lens context
```

The token needs `folders:read` as well as the normal file and user read scopes.
Add `file_metadata:read` for design-URL setup guidance. Figma does not provide
an API that lists team IDs for the current user.

For one self-hosted endpoint shared by clients:

```bash
figma-lens mcp --http --host 127.0.0.1 --port 3333
```

This serves Streamable HTTP at `http://127.0.0.1:3333/mcp`. It uses the MCP
2026-07-28 per-request stateless model and accepts legacy 2025 clients through
the SDK's stateless compatibility path.

Loopback HTTP applies Host and Origin validation against DNS rebinding. A
non-loopback bind is refused unless `FIGMA_LENS_MCP_TOKEN` is set. Clients must
then send that separate secret as `Authorization: Bearer ...`; it must never be
the Figma PAT. Browser origins are rejected unless listed in the comma-separated
`FIGMA_LENS_ALLOWED_ORIGINS` variable. Internet-facing deployments should put
the endpoint behind TLS and a standards-compliant OAuth 2.1 MCP authorization
layer; the built-in bearer gate is intended for controlled self-hosting.

Tools:

- `figma_lens_context`: current account and registered team search scopes
- `figma_lens_find`: fuzzy design discovery across teams, folders, and files
- `figma_lens_scout`: bounded visual overview and state/target catalog
- `figma_lens_focus`: one exact node or 2-6 representative states
- `figma_lens_detail`: source-size visual and geometry for important children
- `figma_lens_inspect`: one known exact frame/component
- `figma_lens_search`: cache-first name/visible-text search
- `figma_lens_render`: exact PNG/JPG/PDF render or SVG export

Each tool returns a compact JSON manifest plus at most six image content blocks.
The JSON navigates the design; the images provide the primary visual evidence.
No tool returns the raw Figma document tree by default.

`figma_lens_find` returns no more than the requested match limit and attaches at
most two candidate screenshots. It keeps the full ranking and request details in
a local artifact. Agents should call `figma_lens_context` only when the user's
team or workspace name is unclear; otherwise they can pass the user's scope
directly to `figma_lens_find`.

When no team is registered, pass an available design-node URL as
`figma_lens_context.source_url`. The tool returns the file and folder names plus
a concise question asking the user to paste the owning team-page URL. Once the
user responds, run `figma-lens teams add "<PASTED_TEAM_URL>"` and repeat the
search.
