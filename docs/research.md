# Headless Figma extraction research

Research date: 2026-08-12

## Result

The best fit is a cache-first CLI over Figma's REST API, with screenshots and
private image fills saved as files and only a compact manifest returned to the
agent. No existing project combines all of these properties cleanly:

- personal access token only;
- no Figma Desktop, browser session, plugin, or long-running server;
- selected-node specs and visual render in one agent workflow;
- persistent cache and local search after the first read;
- bounded/concurrent downloads and cross-process request de-duplication;
- strictly read-only commands.

This repository implements that intersection. Framelink remains the strongest
reference for deeper Figma-specific normalization, while `figma-query` is the
strongest reference for local query projections.

Framelink does not bypass REST rate limits. Its current `get_figma_data`
pipeline calls `GET /files/:key` or `GET /files/:key/nodes`, and its image
pipeline calls `GET /images/:key` and `GET /files/:key/images`. It reduces the
model-facing payload after those calls, but Figma still counts the calls against
the PAT owner and resource plan.

The official OpenAPI spec inspected at `04fbbc719706e986fc79f3050d3e068e118275d9`
has file, node, image, component, component-set, and style endpoints, but no
layer search endpoint. Natural-language screen discovery therefore has to be a
local index over a fetched file or wrapper subtree.

## Non-negotiable platform constraint

Personal access tokens are valid for local scripts and can request private
files the token owner is allowed to open. The token needs `file_content:read`.
[Figma authentication](https://developers.figma.com/docs/rest-api/authentication/)
and [personal access token](https://developers.figma.com/docs/rest-api/personal-access-tokens/)
documentation confirm this use case.

Every PAT-based implementation shares Figma's REST rate limits. Since November
17, 2025, `GET file`, `GET file nodes`, and `GET image` are Tier 1. A View or
Collab seat can be limited to six Tier-1 calls per month; limits also depend on
the plan containing the requested file. There is no client-side technique that
legitimately removes that server-side limit. Figma explicitly recommends
batching and caching. See [REST API rate limits](https://developers.figma.com/docs/rest-api/rate-limits/).

This is why the implementation:

1. fetches only the linked node subtree;
2. batches all requested node IDs into one node call and one render call;
3. stores raw JSON, a compact spec, tree summary, screenshots, and assets;
4. makes warm inspection/search/tree calls fully offline;
5. requires explicit `--refresh` before replacing current cached state;
6. does not sleep through long 429 windows or retry permanent 4xx failures.

For wrapper nodes, `scout` adds an agent-oriented retrieval step. It identifies
meaningful container nodes, ranks them using names, visible descendant text,
component properties, hierarchy, and dimensions, then renders the highest
ranked candidates in one batched image request. `focus` materializes the chosen
child spec from the wrapper cache instead of issuing another node request.

The REST image endpoint can batch node renders and returns temporary render
URLs; the image-fills endpoint returns the original uploaded raster references
for a file. See [Figma file and image endpoints](https://developers.figma.com/docs/rest-api/file-endpoints/).

## Current options inspected

The GitHub HEAD below is the exact revision inspected, not merely the latest
release name visible in a registry.

| Option | Inspected state | Strong parts | Why it is not the complete fit |
| --- | --- | --- | --- |
| [Official Figma MCP](https://developers.figma.com/docs/figma-mcp-server/) | Live docs on 2026-08-12 | Best first-party `get_design_context`, sparse metadata, screenshot, and asset tools; remote mode is headless | Remote auth is not PAT-only, every result still flows through MCP, and Starter/View usage is capped. [MCP limits](https://developers.figma.com/docs/figma-mcp-server/rate-limits-access/) and [tools](https://developers.figma.com/docs/figma-mcp-server/tools-and-prompts/). |
| [GLips/Figma-Context-MCP](https://github.com/GLips/Figma-Context-MCP/tree/c083d65c7e002923e7cb98f4e3bdafb105e90f6d) (Framelink) | `c083d65`, npm `figma-developer-mcp` 0.13.2 | Mature selected-node simplifier, global style de-duplication, compact tree format, image-fill/render export, crop handling, strong tests. Current code also has a headless `fetch` CLI. | The CLI only prints data; image download remains an MCP tool. No persistent inspect bundle or local search. MCP returns one potentially large text payload. Telemetry is on by default unless disabled. |
| [sahajamit/figma-cli](https://github.com/sahajamit/figma-cli/tree/2a3a0c6be2984b0958ab5f02b0c72a6f85978ff8) | `2a3a0c6`, npm 0.2.0 | Closest transport philosophy: small PAT CLI, direct node reads, screenshots, components, styles, variables, and token export. | No persistent cache, local search/query, full-link-first inspect bundle, bounded retry/locking, or automated tests. It also exposes a comment write command, so it is not strictly read-only as shipped. |
| [standardbeagle/figma-query](https://github.com/standardbeagle/figma-query/tree/8bd9e3ee727acd4c9aa0cd4d54e1a1fc1d86f573) | `8bd9e3e`, npm 0.1.0 | Rich Go query DSL, search, projections, tree, CSS, asset export, sync-to-disk cache, and diff tools. | MCP-only entry point, roughly 40 MB unpacked npm package, file-key-centric interface, and cache requires a separate full-file sync workflow. Repository metadata did not expose a license file even though the README says MIT, so code reuse would need clarification. |
| [superdoccimo/figma-mcp-free](https://github.com/superdoccimo/figma-mcp-free/tree/73bbdaebed6d4932e86e406aef44d2ad6f7aef21) | `73bbdae`, unpublished workspace | PAT CLI plus MCP, URL parsing, bounded selection inspection, retries, component search, tokens, starter code, and good security guidance. | No node screenshot or source-image download path, no persistent response cache/local search, and packages are not published. |
| [hellenic-development/figma-extractor](https://github.com/hellenic-development/figma-extractor/tree/32d28f36e6900ee66564cb190fe8bc184a0a9f10) | `32d28f3` | Small Go extractor for Markdown specs, CSS variables, tokens, and selected nodes. | Does not cover rendered screenshots, source image fills, local search, or agent cache behavior. |
| [silships/figma-cli](https://github.com/silships/figma-cli/tree/8d98acd9677a9f21bc2f5406a05bcd80a2b98cb5) | `8d98acd` | Extremely rich Plugin API coverage and fast direct manipulation. | Intentionally depends on Figma Desktop, patched CDP/browser mode, or a plugin. It solves a different, write-capable problem and violates the headless PAT-only boundary. |

The official [Figma REST OpenAPI repository](https://github.com/figma/rest-api-spec)
is the schema authority and should be preferred over reverse-engineered web or
desktop protocols.

## Implemented architecture

```text
Figma node URL
   │ parse file key + normalize node-id
   ▼
cross-process cache lock
   │
   ├─ warm → raw/spec/render/assets on disk → zero Figma calls
   │
   └─ cold → 1 batched node call + 1 batched render call
                │
                ├─ compact spec.json + summary.md
                ├─ screenshot@<scale>x.png
                └─ optional 1 image-fills call → bounded parallel downloads
```

The extraction engine uses Node's built-in HTTP and stream APIs. MCP mode adds
the official MCP TypeScript SDK 2.x and Zod; there is no browser or desktop
runtime. The engine limits whole-file navigation to depth 2 by default, enforces a 128 MiB
declared-response safety cap, streams downloads to atomic temporary files, and
uses a configurable four-worker download pool. Concurrent agents share file
locks, preventing a cold-cache request stampede.

Retries are bounded to network errors, timeouts, short explicit 429 windows,
and transient 408/425/5xx responses. Default settings are two retries, a
30-second per-request timeout, and a maximum automatic `Retry-After` of five
seconds. Longer rate limits are returned to the agent immediately.

## Verification

The implementation is covered by synthetic fixtures only; protected file keys,
node IDs, visual copy, screenshots, exports, and benchmark artifacts are not
part of the public source or Git history. Tests cover shallow discovery,
representative state selection, batched renders, source-size detail extraction,
asset export, cache reuse, concurrent lock de-duplication, visible-copy
provenance, CLI authentication, and both current and legacy MCP negotiation.

## Next feature candidates

- Framelink-style style tables and SVG-container collapsing to reduce repeated
  spec values further.
- Optional Tier-3 metadata checks for users whose PAT also has
  `file_metadata:read`; disabled by default because it adds a request.
- CSS and Tailwind projections over the cached compact spec.
