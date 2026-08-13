---
name: figma-lens
description: Use for every prompt containing a figma.com/design or figma.com/file URL, including implementing pixel-accurate UI, explaining a design or user flow, finding a screen/component inside a large board, or inspecting visual/spec/asset details. Provides the headless read-only Figma Lens workflow through native figma_lens MCP tools when available or the figma-lens CLI otherwise, with exact font/typography evidence, personal-token access, compact visual-first output, source-size details, asset export, and caching. Does not require Figma Desktop.
---

# Figma Lens workflow

Use Figma Lens for every Figma URL. Choose the transport without probing or
duplicating calls:

1. If native tools named `figma_lens_scout`, `figma_lens_focus`, and
   `figma_lens_detail` appear in the current tool list, use them.
2. Otherwise use the matching `figma-lens` CLI command.
3. If a native MCP call reports that its server/tool is unavailable, fall back
   once to the CLI. If the CLI is missing too, follow [Setup and authentication](references/authentication.md).

Keep one transport for a retrieval workflow so node IDs, cache hits,
screenshots, and follow-up commands stay consistent. Inspect only the evidence
needed for the user's request; stop when the visual and structural evidence is
sufficient.

The semantic workflow is identical in both modes:

| Need | Native MCP | CLI |
|---|---|---|
| Catalog board/flow | `figma_lens_scout` | `figma-lens scout` |
| Focus 1-6 exact states | `figma_lens_focus` | `figma-lens focus` / `focus-set` |
| Source-size child details | `figma_lens_detail` | `figma-lens detail` |
| Inspect one exact node | `figma_lens_inspect` | `figma-lens inspect` |
| Search names/visible text | `figma_lens_search` | `figma-lens search` |
| Export exact nodes/assets | `figma_lens_render` | `figma-lens export` |

MCP results contain a compact JSON navigation manifest followed by bounded image
content. Inspect those images with vision; do not ask the tool to dump raw node
JSON. CLI results contain the same compact manifest and local screenshot paths;
open those paths with the agent's image viewer.

## Build a screen or component

When the user names only a component type such as “the modal” and the linked
node may show a collection of its states, discover the board before choosing a
frame:

```bash
figma-lens scout "<FIGMA_URL>"
```

In MCP mode call `figma_lens_scout` with only `url` for this first catalog pass.

This catalog scout must be the first Figma command: do not run `extract` or an
intent scout first. Run the returned `next.focusSet` command verbatim. It uses
each state's `implementationId` when a board frame wraps the actual
modal/screen; do not replace those IDs with an intent scout's nested candidate
guesses.

View `overview.screenshot` and read the ordered `overview.states`. Decide
whether the board represents one stateful component or unrelated screens. For
one component, the tool selects two to four representative nodes covering the
base, content/result, async, and error/empty states, then batches them:

```bash
<next.focusSet>
```

In MCP mode pass `overview.collection.representativeStates[].implementationId`
verbatim as `node_ids` to one `figma_lens_focus` call.

View the returned screenshots. Do not print or read the combined `contract.json`;
it repeats every representative state's geometry. Read the single combined
summary only when the screenshots do not establish the state relationships. Implement
one component/state machine and its visible transitions, not disconnected mock
pages. Do not deep-inspect the wrapper or focus every state when representative
states plus the overview establish the behavior.

Before reading state text or coding, choose exactly one selected state as the
visual baseline from the screenshots. Open only that state's `evidence`; do not
loop over, concatenate, or print every state evidence file. Treat the baseline
screenshot/evidence pair as a fidelity lock.
Copy labels, counts, sample data, controls, and visible state only from
`evidence.state.visibleText` when they also appear in the screenshot. The tool
has removed hidden and zero-opacity variant subtrees. Do not recover them by
recursively querying `spec.json`, and do not combine visible content from two
states into a synthetic screen. Other selected states may justify only a
transition that their own screenshot visibly demonstrates.

The overview and full-state renders are navigation maps, not implementation
detail: a large source element may appear tiny after the whole frame is fit into
one image. Before writing CSS, name two to four visually important child groups
seen in the selected state (for example `candidate card, query bar, city
filter`) and make exactly one source-size detail call:

```bash
figma-lens detail "<FOCUSED_NODE_URL>" --intent "<GROUP 1>, <GROUP 2>, <GROUP 3>" --render 4 --scale 2
```

In MCP mode make one `figma_lens_detail` call with the same URL and comma-separated
intent, `render: 4`, and `scale: 2`.

Use the original linked URL with its node ID replaced by the selected focused
node ID. View every returned `details[].screenshot` at original pixels. Use
each detail's inline `geometry` and source `size`; read only an individual
`details[].artifact` when inline data omits a needed child property. Do not read
`artifacts.contract` or loop over all artifacts. These focused values are the
layout contract for padding, gaps, radius, strokes, colors, effects, typography,
and child geometry. Never estimate from a scaled-down parent preview.

### Resolve typography before CSS

Treat `typography.fontFaces` and `typography.styles` returned by `focus`,
`inspect`, or `detail` as required implementation evidence. Before measuring or
writing text layout:

1. Match each visible text row's `typographyRef` to its state's
   `typography.styles[]` entry. For a source-size child, prefer its matching
   `details[].typography[]` entry.
2. Apply the exact `fontFamily`, `fontPostScriptName`/`fontStyle`, `fontWeight`,
   `fontSize`, line height, and `letterSpacing`. Preserve text case, decoration,
   and fill color when returned.
3. Implement `mixedStyleRuns` as bounded spans with their returned styles; do
   not flatten a mixed-weight or mixed-font label into one CSS rule.
4. Inspect the destination project's font imports, local font files, CSS,
   framework font loader, or design-system tokens. Confirm every required
   family and weight is loaded before screenshot comparison. In a browser,
   verify the computed font and use `document.fonts.check(...)` when available.

`typography.availability.status` is `not-verified` by design: Figma REST reports
the requested face and metrics but does not provide a licensed font file or
prove the destination loads it. Never silently substitute a fallback or fetch
an unlicensed font. Reuse an exact font already present, add a legitimately
available project font, or tell the user that pixel parity is blocked by the
missing face. Do not claim pixel-perfect output while a fallback is rendering.

For large nodes, inline output is bounded. Read only `artifacts.typography` when
the required visible style is absent from the inline catalog; it contains the
deduplicated full focused-subtree catalog without raw node noise.

Do not start implementation when a named visible control has no source-size
detail or when `detail` returns a different group than the screenshot. Refine
the comma-separated intent once. If it still cannot isolate the group, preserve
only what the baseline screenshot proves; never substitute a plausible UI.

Use the agent's local image-view capability on screenshot paths. Never print,
read, or pipe PNG/JPEG/SVG bytes through `base64`, `xxd`, or stdout. That is not
visual inspection and wastes context. Read an individual `details[].artifact`
only when its compact geometry is missing a needed child property; do not load
all detail artifacts.

When the user names one particular screen/state/component and the linked node
itself is known to be that exact single target, start with one intent-based
extraction. Do not use this shortcut for a URL described as a board, collection,
flow, wrapper, or a component with multiple states; those always start with the
catalog scout above. Do not start with `inspect`.

```bash
figma-lens extract "<FIGMA_URL>" --intent "<target requested by the user>"
```

Run it concurrently with reading the destination project's existing files. On
success, view `artifacts.screenshots[0]`, read `artifacts.evidence`, and read
`artifacts.summary`. Those are the focused frame, not the wrapper. Implement
from the screenshot for visual hierarchy, from evidence for exact visible
copy/state, and from the summary/contract for geometry, typography, and colors.
Query `spec.json` only by a known visible node ID when a property is absent;
never recursively dump or mine all text because dormant component variants may
be present in Figma data.
Then run one `detail` call for the two to four child groups that carry the most
visual or interaction detail before implementing them.

If vision reads important baseline copy that is absent from visible evidence,
verify the gap before coding:

```bash
figma-lens evidence-check "<FOCUSED_NODE_URL>" --offline --text "<COPY 1>|<COPY 2>"
```

When `coverage.complete` is false, evidence is incomplete at the bounded depth.
Do not guess and do not fetch the whole state unbounded. Use `detail` to isolate
the visible group and trust its screenshot; deepen only that named group if its
copy is still missing.

If `resolution.required` is true, do not guess or deeply inspect the wrapper.
Run the copy-ready `resolution.next.scout`, view candidate 1, then use the
matching `focus` command. View candidate 2 only if candidate 1 is wrong.

After implementation, run the project's normal build/tests. Confirm the exact
fonts have finished loading, then capture the implementation at the baseline
frame's width and height and compare it with the baseline screenshot using
vision. This verification is required for visual work. Before calling the
result complete, run the offline copy provenance gate
against the one state evidence file used as the baseline, or the combined
`visible-evidence.json` when the code implements multiple inspected states. If
bounded state data omitted copy visible in a viewed detail screenshot, add the
detail manifest's compact `artifacts.detailEvidence`; allowlist only any
remaining exact visual-only strings. Audit every JSX/TSX file containing visible UI:

```bash
figma-lens copy-check "<BASELINE_VISIBLE_EVIDENCE_JSON>" src/Component.tsx \
  --evidence "<DETAIL_VISIBLE_EVIDENCE_JSON>" \
  --allow "<EXACT SCREENSHOT-ONLY COPY 1>|<EXACT SCREENSHOT-ONLY COPY 2>"
```

Omit `--allow` when evidence is complete. An allowlisted string must have been
personally read from a viewed source-size `detail` screenshot; never allow a
guess, placeholder, invented sample person, count, state, or interaction. A
non-zero exit is a failed implementation: remove the unproven copy/data or
inspect the exact visible detail that proves it. This gate checks provenance,
not pixels, so the screenshot comparison remains mandatory.

Reject the implementation before handoff when any baseline
label/count/control changed, when an unproven control or interaction appeared,
or when the modal/frame bounds, column split, spacing, or distinctive asset are
visibly wrong. Fix semantic drift before cosmetic details.

### Reuse real visual assets

Focused commands automatically discover and batch-export distinctive visual
assets. If `visualAssets.required` is true, view every relevant
`visualAssets.candidates[].exported` file and use the export in the product.
Do not start implementation until these files have been checked. First reuse an
icon package already present in the destination only when the visual match is
clearly exact. If a visible logo, illustration, icon, or vector was not
auto-discovered, locate its node ID in the focused summary/spec and batch-export
only the unique assets needed:

```bash
figma-lens export "<FIGMA_URL>" --node <ICON_OR_VECTOR_IDS> --format svg
```

Use `--format png` for rasterized effects. For source image fills referenced by
the focused subtree, use `figma-lens assets` with that focused node ID. Do not
approximate a distinctive asset with emoji, text glyphs, or unrelated icons.

## Explain a design or flow

For “what is this design?”, flow explanations, or any link that may contain
multiple screens, start with exactly one bounded scout:

```bash
figma-lens scout "<FIGMA_URL>"
```

Read the small JSON manifest and view only `overview.screenshot`. Interpret the
image with vision; use `overview.states` as the ordered node-ID/name map and
`overview.context` for labels such as HOVER, YES, and NO.

Stop and answer when the overview establishes the product goal, actor/entry,
main actions, and async/error/end states. Never follow a successful wrapper
`scout` with `inspect`, and do not inspect every state for completeness.

## Find and inspect one target

Only when the target or transition remains ambiguous, run at most one intent
scout and render at most two matches:

```bash
figma-lens scout "<FIGMA_URL>" --intent "<specific target>" --render 2
```

Use the manifest's copy-ready `next` commands. View candidate 1 first and
candidate 2 only if still unclear. For implementation-level layout/style data,
focus the chosen node:

```bash
figma-lens focus "<FIGMA_URL>" --select <NODE_ID>
```

View its screenshot and read `summary.md`. Query `spec.json` only for exact
properties; never load a large spec or `raw.json` wholesale. Deepen only this
focused node when a visible detail is absent:

```bash
figma-lens focus "<FIGMA_URL>" --select <NODE_ID> --depth 12 --no-screenshot
figma-lens search <FILE_KEY> "<visible copy>" --node <NODE_ID> --depth 12 --offline
```

For non-implementation inspection, if the user explicitly says the supplied
URL is the exact single frame, use bounded inspection (depth 6 by default):

```bash
figma-lens inspect "<FIGMA_NODE_URL>"
```

## Cached follow-up

Search or print a compact tree without another Figma request:

```bash
figma-lens search "<FIGMA_URL>" "<name or text>" --offline
figma-lens tree "<FIGMA_URL>" --offline --max-depth 3 --max-nodes 100
```

Omitting `--depth` selects the deepest matching cached subtree. Do not pass
`--refresh` unless the user explicitly needs current remote state.

Download private source image fills only when implementation needs them:

```bash
figma-lens assets "<FIGMA_NODE_URL>"
```

## Safety and failures

If authentication is missing, do not ask the user to paste a token into chat.
Guide them through `figma-lens auth login` using
[references/authentication.md](references/authentication.md). Figma Lens needs
an online Figma file and an API token whose owner can already access it; it does
not require Figma Desktop and cannot read unsaved local `.fig` files.

Never print a token, put it in a URL, expose it as an MCP bearer credential, or
commit credentials/artifacts. `FIGMA_LENS_MCP_TOKEN`, when present, protects a
remote MCP endpoint and must be a separate secret from the Figma PAT.
Do not call Figma once per child; scout renders candidates in one batch and
cache locks deduplicate concurrent agents.

If the API returns 404 while `figma-lens doctor` succeeds, report that the
token is valid but Figma did not expose the specified file. Ask the user to
verify that the token owner can open the current file link. Do not fall back to
desktop patching unless the user explicitly changes the headless requirement.
