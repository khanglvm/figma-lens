# figma-lens

Token-efficient, headless, read-only Figma inspection for coding agents over a
terminal CLI or native MCP tools. It accepts protected node links, fetches only
bounded subtrees, returns compact navigation/spec data plus visual evidence, and
caches artifacts so follow-up work is usually offline.

See [docs/research.md](docs/research.md) for the current ecosystem review and
the constraints behind this design.

## Quick start

Requirements: Node.js 20+ and a Figma personal access token with
`file_content:read` access to the target online file. Figma Desktop is not
required.

```bash
npm install --global figma-lens
figma-lens auth login
figma-lens extract "https://www.figma.com/design/FILE_KEY/File?node-id=1-2" \
  --intent "initial create-segment screen"
```

The command prints a small JSON manifest. The useful artifacts are written to
`.figma-lens/`: `screenshot-<node-id>@2x.png`, `spec.json`, `summary.md`, and `raw.json`.
Run the same command again to use the local cache without another Figma API
call. Pass `--refresh` only when current remote state is required.

## Commands

```text
figma-lens auth <login|status|logout|path>
figma-lens mcp [--http] [--host 127.0.0.1] [--port 3333]
figma-lens extract <url-or-key> --intent <implementation-target>
figma-lens detail <focused-url> [--intent "child group, child group"] [--render 4] [--scale 2]
figma-lens inspect <url-or-key> [--node 1:2] [--assets] [--refresh]
figma-lens scout <wrapper-url> ["<implementation intent>" | --intent <text>] [--render 2]
figma-lens focus <wrapper-url> --select <candidate-node-id> [--depth 6]
figma-lens focus-set <wrapper-url> --select <id-1,id-2,...> [--depth 6]
figma-lens spec <url-or-key> [--node 1:2]
figma-lens tree <url-or-key> [--node 1:2] [--max-depth 6]
figma-lens search <url-or-key> <query> [--node 1:2] [--limit 20]
figma-lens evidence-check <url-or-key> --text "copy|copy"
figma-lens copy-check <visible-evidence.json> <jsx-or-tsx-files...> [--evidence <detail-evidence>] [--allow "copy|copy"]
figma-lens screenshot <url-or-key> [--node 1:2] [--scale 2]
figma-lens export <url-or-key> --node <ids> --format <svg|png>
figma-lens assets <url-or-key> [--node 1:2]
figma-lens doctor
```

`inspect` bounds node traversal to depth 6 by default and uses at most one
file/node request plus one batched render request on a cold cache. `assets` adds
one image-fills request, then downloads referenced
files from their temporary URLs. Downloads use bounded concurrency (four by
default), while atomic writes and cross-process locks prevent concurrent agents
from stampeding the same cache entry. All commands are read-only.

### Extract one implementation target

`extract` is the design-to-code entry point for a known single target. It first
reads the linked node at depth 2. A direct frame/component link is focused as-is;
a large wrapper is resolved from the natural-language intent. Only a
high-confidence match is deeply fetched and rendered:

```bash
figma-lens extract "$FIGMA_URL" --intent "initial Create Segment screen"
```

A successful cold extraction normally uses four Figma API requests: shallow
discovery, one depth-6 request for the selected node, one selected-node render,
and one batched distinctive-asset render. It returns one
focused screenshot plus `summary.md` and `spec.json`, without rendering or
deeply caching the wrapper. If intent confidence is low, `resolution.required`
is true and the manifest supplies a bounded scout command rather than guessing.
If the node is recognized as one component shown across several states,
`resolution.required` instead supplies a representative `focus-set`; use the
catalog `scout` route below when the prompt or URL is already known to be a
board, wrapper, flow, collection, or multi-state component.

### Discover the right screen inside a wrapper

When a node contains several screens, component states, and prototype
annotations, begin with a bounded depth-2 catalog and a 0.25x overview image:

```bash
figma-lens scout "$FIGMA_WRAPPER_URL"
```

View `overview.screenshot` first. The stdout manifest includes the wrapper's
size, short context labels, and up to twenty direct design states in visual
reading order. Catalog mode omits the noisier ranked-candidate payload.
Connector arrows, flow shapes, and documentation chrome are classified but not
promoted as implementation targets. Full ranking details remain in the local
`artifacts.details` file and do not enter agent context automatically.

Context labels and candidates include percentage positions relative to the
overview. If an intent matches a board annotation such as `HOVER`, `YES`, or
`NO`, nearby screens/components are ranked by spatial proximity. This lets the
agent use vision to understand a flow, then use stable node IDs to render the
source and resulting states without parsing the entire layer tree.

For a design-summary or user-flow question, the overview image plus ordered
states is normally the stopping point. Only if a target or transition remains
ambiguous, rank and batch-render the two strongest matches from the cached
shallow data:

```bash
figma-lens scout "$FIGMA_WRAPPER_URL" \
  --intent "implement the screen where a recruiter creates a segment with smart filters" \
  --render 2
```

The output's `next` field supplies exact, shell-safe follow-up commands and a
bounded stopping rule. Intent can also remain the positional second argument
for backward compatibility.

`scout` ranks descendant sections, frames, components, component sets,
instances, and groups using layer names, paths, visible descendant text,
component properties, dimensions, and hierarchy. Matching is
accent-insensitive, typo-tolerant, and includes common English/Vietnamese UI
aliases. The best candidates are rendered together in one batched image call.
Ancestor/descendant duplicates are collapsed before output.

The output explains each match and provides screenshot paths. After viewing
those images, focus the winning candidate:

```bash
figma-lens focus "$FIGMA_WRAPPER_URL" --select 12:34
```

`focus` validates the selection against the shallow wrapper cache, then fetches
only that node to depth 6 by default. The candidate image is reused when
`scout` already rendered it. A cold focus therefore normally needs one node
request plus one batched distinctive-asset render; it needs one additional
selected-node render when no candidate image is cached. Increase `--depth` only
when a specific nested detail is missing; `--render 0` suppresses candidate
images.

For one UI shown across several states, `focus-set` accepts two to six IDs and
batches them into one node request plus one render request. It emits ordered
screenshots and a combined summary so an agent can implement a single stateful
component without one API call or one large text response per state.

Catalog scout classifies repeated state boards and prints a representative
`next.focusSet` covering base, loading, populated, and error/empty outcomes.
When a 1440px presentation frame wraps a 1200px modal, the command selects the
inner implementation node. Generic `extract --intent modal` fails closed for
this board shape instead of silently choosing one state.

Focused bundles also emit `visible-evidence.json` (and one small evidence file
per state for `focus-set`). This is the state-fidelity source of truth: it keeps
only descendants whose full ancestor chain is visible and non-transparent.
Hidden component variants are excluded from search, detail ranking, contracts,
asset discovery, image-fill download, and implementation summaries. Agents can
therefore lock one screenshot/evidence pair as the baseline instead of merging
dormant layer copy into a fabricated screen.

`evidence-check` compares copy read from the screenshot against the bounded
visible evidence without another request when cached:

```bash
figma-lens evidence-check "$FOCUSED_NODE_URL" --offline \
  --text "Smart template|Import spreadsheet (xlsx, xls)"
```

An incomplete result is a stop signal to isolate that visible child with
`detail`; it is not permission to mine the full state or invent replacement UI.

Before handoff, `copy-check` audits user-facing strings in JSX/TSX without a
network request and exits non-zero for copy or sample data absent from the
selected visible evidence (use combined focus-set evidence for a state machine).
Screenshot-only strings may be attested explicitly,
but must come from a viewed source-size detail:

```bash
figma-lens copy-check ./visible-evidence-STATE.json src/Modal.tsx \
  --evidence ./details/visible-evidence-DETAIL.json \
  --allow "Exact screenshot-only label|Exact screenshot-only placeholder"
```

Focused state screenshots are navigation maps. The `detail` command ranks
meaningful child containers inside one focused node and batch-renders them in
isolation at 2x by default. Its compact manifest includes each child's source
dimensions, position, layout/fill/stroke/radius/effect data, visible
descendants, and `contract.json`. This prevents large modal/board previews from
hiding pixel details:

```bash
figma-lens detail "$FOCUSED_NODE_URL" \
  --intent "candidate card, query bar, city filter" --render 3
```

Comma-separated intents are resolved independently, so a generic designer name
such as `Frame 1618871847` can still be selected from geometry and nearby
structure. All detail images are rendered in one Figma API request and cached.

`focus`, `focus-set`, and `extract` also discover distinctive logos,
illustrations, and icons and batch-export stable nodes to SVG automatically.
Pass `--no-export-assets` only when those exports are intentionally unnecessary.

`export` is a render-only alias suited to copying selected vector/icon nodes as
SVG (or raster effects as PNG). Multiple node IDs are batched in one request;
the command never fetches the surrounding document tree. It returns successful
paths plus `missing` IDs when one optional node cannot render, instead of
discarding the rest of the batch.

Component properties retain their selected values, variant options, and the
count of preferred swap values. Large `preferredValues` catalogs are omitted
from `spec.json`; they are irrelevant to reproducing the selected state and can
otherwise dominate extraction size.

If vision reveals copy or a nested control that is absent from the default
depth-6 spec, deepen only the focused node and search that cache:

```bash
figma-lens focus "$FIGMA_WRAPPER_URL" --select 12:34 --depth 12 --no-screenshot
figma-lens search FILE_KEY "tooltip copy" --node 12:34 --depth 12 --offline
```

Offline `search` and `tree` commands automatically reuse the deepest matching
cached depth when `--depth` is omitted.

## Configuration

| Variable | Purpose |
| --- | --- |
| `FIGMA_TOKEN` | Personal access token sent as `X-Figma-Token` |
| `FIGMA_ACCESS_TOKEN` | Supported alias for `FIGMA_TOKEN` |
| `FIGMA_LENS_ENV_FILE` | Optional path to an env file containing the token |
| `FIGMA_LENS_CACHE_DIR` | Cache root; defaults to `.figma-lens` |
| `FIGMA_LENS_CONFIG_DIR` | Override OS config/credential directory |
| `FIGMA_LENS_MCP_TOKEN` | Separate inbound bearer secret required for non-loopback MCP HTTP |
| `FIGMA_LENS_ALLOWED_ORIGINS` | Comma-separated browser origins allowed on non-loopback MCP HTTP |
| `FIGMA_API_BASE_URL` | Test/development override |
| `FIGMA_MAX_RETRIES` | Transient/network retries; defaults to `2` |
| `FIGMA_MAX_RETRY_AFTER_MS` | Largest 429 wait retried automatically; defaults to `5000` |
| `FIGMA_REQUEST_TIMEOUT_MS` | Per-request timeout; defaults to `30000` |
| `FIGMA_MAX_RESPONSE_BYTES` | Content-length safety limit; defaults to 128 MiB |

Never commit `.env` or `.figma-lens/`; both are ignored.
The CLI never auto-loads a project `.env`. Select one explicitly with
`FIGMA_LENS_ENV_FILE`, use the OS credential store created by `auth login`, or
provide a one-shot token with `--token-stdin` / `--token-file`.

## Installation and credentials

The unscoped npm package supplies both CLI and MCP modes:

```bash
npm install --global figma-lens
npx figma-lens@latest --help
curl -fsSL https://raw.githubusercontent.com/khanglvm/figma-lens/main/install.sh | sh
```

For automation, invoke `npm install --global figma-lens@latest` with Node's
`child_process.execFile` rather than a shell. No install-time login or desktop
popup is required.

Create a PAT in Figma **Settings → Security → Personal access tokens** with
`file_content:read` and `current_user:read`, then run `figma-lens auth login`.
The interactive token input is hidden and the validated token is saved with
private filesystem permissions. See [the skill authentication guide](skills/figma-lens/references/authentication.md)
for OS paths, CI alternatives, precedence, and limitations.

Figma Lens can read only designs saved/imported online and already shared with
the token owner. It cannot read an unsaved local `.fig`, bypass permissions or
rate limits, edit designs, or reproduce uncommitted Figma Desktop state.

## MCP

`figma-lens mcp` serves local stdio. `figma-lens mcp --http` serves a stateless
Streamable HTTP endpoint. Both expose six compact workflow tools and share the
same credential/cache. See [docs/mcp.md](docs/mcp.md) for host configuration,
tool contracts, compatibility, and remote security.

## Agent skill

The repository includes an on-demand skill at `skills/figma-lens/SKILL.md`.
Install the all-in-one skill with a skill manager, or symlink it during local
development:

```bash
npx skills add khanglvm/figma-lens --skill figma-lens
ln -s "$(pwd)/skills/figma-lens" "$HOME/.codex/skills/figma-lens"
# or: "$HOME/.claude/skills/figma-lens"
```

Inspect the destination first and do not replace an existing skill blindly.
The skill uses native `figma_lens_*` MCP tools when the host exposes them and
falls back once to the matching CLI command otherwise; users do not choose a
different skill variant.
