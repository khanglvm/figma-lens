# CLI reference

Every figma-lens command, flag, default and environment variable. Commands print compact JSON to stdout and write larger files to the local cache instead of printing raw Figma responses.

Run `figma-lens --help` for the same option list from the installed version. The flags are parsed once for every command, so a flag that a command does not use has no effect. An unknown flag is an error.

## Commands

```text
figma-lens auth <login|status|logout|path>
figma-lens doctor
figma-lens context [design-url] [--refresh]
figma-lens teams <add|list|remove> [team-or-design-url]
figma-lens find <description> [--scope <team-folder-or-file>] [--max-files 8]
figma-lens extract <url-or-key> --intent <implementation-target>
figma-lens scout <wrapper-url> [<intent> | --intent <text>] [--render 2]
figma-lens focus <wrapper-url> --select <node-id> [--depth 6]
figma-lens focus-set <wrapper-url> --select <id-1,id-2,...> [--depth 6]
figma-lens detail <focused-url> [--intent <child-groups>] [--render 4] [--scale 2]
figma-lens inspect <url-or-key> [--node 1:2] [--assets] [--refresh]
figma-lens spec <url-or-key> [--node 1:2]
figma-lens tree <url-or-key> [--node 1:2] [--max-depth 8]
figma-lens search <url-or-key> <query> [--node 1:2] [--limit 20]
figma-lens evidence-check <url-or-key> --text <copy|copy>
figma-lens copy-check <visible-evidence.json> <jsx-or-tsx-files...>
figma-lens screenshot <url-or-key> [--node 1:2] [--scale 2]
figma-lens export <url-or-key> --node <ids> --format <svg|png>
figma-lens assets <url-or-key> [--node 1:2]
figma-lens mcp [--http] [--host 127.0.0.1] [--port 3333]
figma-lens --version
```

A `<url-or-key>` is a Figma `/design` or `/file` URL, or a bare file key. A node ID in the URL (`node-id=1-2`) is used when `--node` is not given.

## Account and setup

### auth

`auth login` reads a token, checks it with Figma and saves it. It prompts with hidden input in a terminal. In a script, use `--token-stdin` or `--token-file`. `auth status` prints whether a token is configured, where it comes from, the saved path and the saved account, and exits with code 1 when none is configured. `auth path` prints the credential file path. `auth logout` deletes the saved login. See [Authentication](authentication.md).

### doctor

Makes one request to Figma and prints `ok`, the account `id` and `handle`, the rate-limit headers and the API calls made.

### context

Prints the account and the registered team search scopes. With a design URL, it also names the file and folder that URL belongs to and prints the request to send you for the owning team-page URL. `--refresh` re-checks each registered team with Figma.

### teams

`teams add <team-url-or-id>` validates the team with Figma and saves its ID and name. `teams add <design-url>` prints the setup request instead of saving anything. `teams list` prints the same data as `context`. `teams remove <team-url-or-id>` deletes a saved scope. See [Find designs without a link](find-designs.md).

## Finding and focusing

### find

Searches registered teams for a natural-language description. The query is every positional word joined together.

| Option | Default | Meaning |
| --- | --- | --- |
| `--scope <text>` | all registered teams | Loosely matches a team, folder path or file name. |
| `--team <ids>` | none | Comma-separated team IDs or URLs for this call, without saving them. |
| `--max-files <n>` | `8` | Most uncached files indexed in one call. Cached files are always searched. |
| `--limit <n>` | `5` | Most matches returned. |
| `--render <n>` | `2` | Candidate screenshots to render. |
| `--depth <n>` | `3` | Index depth. |
| `--offline` | off | Search the cache only. |
| `--refresh` | off | Rebuild the cached catalog. |

The result has `status`, `scope`, `coverage`, `matches`, `next.focus` and `cache`. `status` is `complete` or `partial` on success. Failures print `"ok": false` with a `status` of `needs_setup`, `needs_sync`, `catalog_error` or `scope_not_found`, and still exit with code 0.

### scout

Gives an overview of a board, flow, wrapper or multi-state component: one small overview image, an ordered list of states with stable node IDs, flow labels, and copy-ready next commands. Without an intent it is a catalog scout. Catalog mode uses a depth 2 subtree and one overview render. The intent is the second positional argument or `--intent`, not both.

```sh
figma-lens scout "$FIGMA_URL" --intent "screen where a recruiter creates a segment" --render 2
```

| Option | Default | Meaning |
| --- | --- | --- |
| `--intent <text>` | none | Ranks candidates by name, path, visible text, size, component properties, hierarchy and nearby annotations such as HOVER, YES and NO. |
| `--render <n>` | `2` with an intent, `0` without | Candidate screenshots, batched into one image request. |
| `--limit <n>` | `5` | Most candidates returned. |
| `--depth <n>` | `2` | Subtree depth. |
| `--scale <n>` | `1` | Screenshot scale. |

The manifest has `source`, `overview` (`screenshot`, `states`, `collection`, `context`), `discovery`, `candidates` (with an intent), `next`, `cache`, `artifacts` and `apiCalls`. Without an intent, `next.focusSet` is a `focus-set` command for the representative states.

### focus and focus-set

`focus` fetches one node. `focus-set` fetches 2 to 6 representative states with one node request and one render request. Both write screenshots, a compact summary, the visible text, typography and distinctive asset exports.

| Option | Default | Meaning |
| --- | --- | --- |
| `--select <ids>` | required | `focus` takes one node ID. `focus-set` takes a comma-separated list. |
| `--depth <n>` | `6` | Subtree depth. |
| `--scale <n>` | `1` | Screenshot scale. |
| `--no-export-assets` | off | Skip the automatic SVG export of icons and illustrations. |
| `--no-screenshot` | off | Skip rendering. |

The manifest has `selected`, `cache`, `artifacts` (`spec`, `summary`, `contract`, `evidence`, `typography`, `screenshots`), a compact `typography` catalog, `fidelity`, and `visualAssets` when assets were found.

### extract

One call for a known single screen or component. It runs a shallow discovery, resolves the intent, fetches only the chosen node, renders it and exports distinctive assets. A low-confidence match fails closed and returns a bounded `scout` command instead of guessing.

| Option | Default | Meaning |
| --- | --- | --- |
| `--intent <text>` | required | The target to build. It can also be the second positional argument, not both. |
| `--limit <n>` | `5` | Most candidates considered. |
| `--scale <n>` | `1` | Screenshot scale. |
| `--no-export-assets` | off | Skip asset export. |

### detail

Run once after you choose a baseline. It ranks the meaningful child groups inside a focused node and renders the ones you name at source size. The manifest has dimensions, child positions, layout, fills, strokes, radii, effects, typography and a compact contract. A comma-separated intent is resolved one group at a time.

| Option | Default | Meaning |
| --- | --- | --- |
| `--intent <text>` | none | Comma-separated child groups. It can also be the second positional argument, not both. |
| `--render <n>` | `4` with an intent, `0` without | Groups to render. |
| `--scale <n>` | `2` | Render scale. |
| `--depth <n>` | `6` | Subtree depth. |
| `--limit <n>` | `12` | Most child groups ranked. |

## Inspecting

### inspect, spec, tree and search

`inspect` is for one known exact node outside the design-to-code workflow. It always fetches at depth 6 unless you set `--depth`, and renders a screenshot unless `--no-screenshot` is set. `--assets` also downloads image fills. `spec` prints the compact structured properties as JSON. `tree` prints an indented text tree. `search` prints name and visible-text matches in a node subtree. Add `--offline` to `tree` and `search` to guarantee no network request. When `--depth` is left out, a cached query reuses the deepest matching cached subtree.

| Option | Default | Used by | Meaning |
| --- | --- | --- | --- |
| `--node <ids>` | from the URL | all | Comma-separated node IDs. |
| `--depth <n>` | `6` with a node; `2` without, except `inspect`, which uses `6` | all | Figma subtree depth to fetch. |
| `--max-depth <n>` | `8` | `tree` | Deepest level printed. |
| `--max-nodes <n>` | `300` | `tree` | Most nodes printed. |
| `--limit <n>` | `20` | `search` | Most matches printed. |
| `--no-screenshot` | off | `inspect` | Skip the render. |
| `--assets` | off | `inspect` | Download source image fills. |

`spec` can print a large document. Prefer `search` or a focused `summary.md`, and do not load the full output into an agent's context.

### screenshot, export and assets

`screenshot` renders a node. `export` renders the node IDs you list, in the format you ask for, without fetching the surrounding tree. It reports the paths it wrote and lists nodes Figma could not export as missing instead of failing. `assets` downloads the image fills used by a subtree, with bounded concurrency.

| Option | Default | Meaning |
| --- | --- | --- |
| `--node <ids>` | from the URL | Comma-separated node IDs. `export` needs them. |
| `--format <type>` | `png` | `png`, `jpg`, `svg` or `pdf`. |
| `--scale <n>` | `2` | Render scale, from 0.01 to 4. |
| `--use-absolute-bounds` | off | Ask Figma to render with absolute bounds. Not listed in `--help`. |
| `--concurrency <n>` | `4` | Parallel downloads for `assets`. |

### evidence-check and copy-check

`evidence-check` fetches a node (or reads it from the cache with `--offline`) and reports which strings you read in the screenshot are present in its visible text. Separate strings with `|`. The `coverage` object has `complete`, `presentInData` and `missingFromData`.

`copy-check` makes no Figma request. It reads user-facing strings from the JSX or TSX files and compares them with the visible-text evidence.

| Option | Meaning |
| --- | --- |
| `--evidence <paths>` | Extra evidence files, such as a detail manifest's `artifacts.detailEvidence`, separated by commas. |
| `--allow <text>` | Exact screenshot-only strings that count as approved, separated by `|`. |

It exits with code 0 when every string is covered and 1 when not. The output has `ok`, `checkedStrings`, `violationCount`, `violations` (at most 20, with file and line) and an `instruction`. It skips type generics, client directives, logger arguments, non-visible attributes and Tailwind class lists.

## Cache and output

The default `.figma-lens/` folder holds compact specs, summaries, screenshots, visible text, typography catalogs, exports and raw responses. Stdout holds paths and short navigation data, not the raw payload. Repeated commands reuse the cache. `--refresh` replaces cached remote data and `--offline` fails instead of calling Figma on a cache miss. The two cannot be combined.

`--output <directory>` overrides the cache directory for one command. `FIGMA_LENS_CACHE_DIR` sets it for a shell.

Writes are atomic and guarded by cross-process locks, so agents running at the same time do not repeat the same cold request. Workspace search uses a private cache under the operating system's config directory, shared by every project.

Typical request counts on a cold cache:

- Catalog `scout`: one node request and one overview render.
- A successful `extract`: a shallow discovery, one focused node request, one focused render and one batched asset render.
- `focus-set`: one batched node request and one batched render, plus one asset render when needed.
- `detail`: one batched render, after the focused data is cached.

## MCP server command

`figma-lens mcp` starts the MCP server on stdio. `--http` serves Streamable HTTP instead, with `--host` (default `127.0.0.1`) and `--port` (default `3333`). See [MCP server](mcp.md).

## Environment variables

| Variable | Purpose |
| --- | --- |
| `FIGMA_TOKEN` | Personal access token, sent as `X-Figma-Token`. |
| `FIGMA_ACCESS_TOKEN` | Alias for `FIGMA_TOKEN`. |
| `FIGMA_LENS_ENV_FILE` | An env file that holds the token. |
| `FIGMA_LENS_CACHE_DIR` | Cache root. Defaults to `.figma-lens`. |
| `FIGMA_LENS_CONFIG_DIR` | Replaces the operating system's config directory. |
| `FIGMA_LENS_TEAM_IDS` | Comma-separated team IDs or URLs added as search scopes. |
| `FIGMA_LENS_MCP_TOKEN` | Bearer secret that non-loopback MCP HTTP requires from clients. |
| `FIGMA_LENS_ALLOWED_ORIGINS` | Comma-separated browser origins allowed by non-loopback MCP HTTP. |
| `FIGMA_API_BASE_URL` | Replaces the Figma API URL, for tests and development. |
| `FIGMA_MAX_RETRIES` | Retries for network errors and short 429 waits. Defaults to `2`. |
| `FIGMA_MAX_RETRY_AFTER_MS` | Longest 429 wait that is retried. Defaults to `5000`. |
| `FIGMA_REQUEST_TIMEOUT_MS` | Timeout per request. Defaults to `30000`. |
| `FIGMA_MAX_RESPONSE_BYTES` | Response size limit. Defaults to 128 MiB. |

The CLI never loads a project `.env` on its own. Token precedence is listed in [Authentication](authentication.md#other-ways-to-supply-a-token).

## Exit codes and errors

A command exits with 0 on success and 1 on failure. A failure prints JSON to stderr: `{"ok": false, "error": "..."}`, plus `status` and `rate` for a Figma API error. Exceptions to the "0 means ok" rule:

- `auth status` exits 1 when no token is configured.
- `copy-check` exits 1 when it finds unproven copy.
- `find` exits 0 even when it returns `"ok": false`, so read its `status` field.

A response that is too large or too slow fails safely. Network errors and short 429 waits are retried. A 404 after a successful `doctor` means the token is valid but Figma did not expose that file or node to its owner.
