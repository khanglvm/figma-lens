# Agent instructions

For read-only Figma node links, use this repository's `figma-lens` CLI or its
native MCP tools. For a single exact implementation frame use `extract --intent`. For a wrapper, flow,
board, collection, or multi-state component use a catalog `scout` first. For
non-implementation inspection use `inspect` once, open the screenshot with
vision, and read the compact spec. Use `search` or `tree` with `--offline` for
follow-up questions. Do not use Figma Desktop, a patched browser bridge, or an
unrelated Figma MCP.

If the supplied node wraps several screens or components, run `scout` without
an intent first and view only its overview screenshot. Read `overview.states`
in visual order. For a stateful component implementation, run the returned
`next.focusSet` verbatim so inner implementation nodes—not presentation
frames—are selected. For design-summary or user-flow questions, stop there
when the image and ordered states establish the product goal, entry state, main
actions, and async/error/end states. Do not investigate every state merely for
completeness.

Only when the target or transition remains ambiguous, run at most one intent
scout with `--render 2`, then view candidate 1 and candidate 2 only if needed.
Run `focus --select <node-id>` only for implementation-level detail. Prefer the
copy-ready commands in the manifest's `next` field. Read the focused summary
before opening detailed spec data. Do not implement the outer wrapper as though
it were one screen, and do not load raw or full-spec artifacts into context by
default.
Never follow a successful wrapper `scout` with `inspect`; `inspect` is for a
single implementation frame.

Use overview positions and spatial-context matches to follow flow labels such
as HOVER/YES/NO. If visible copy is missing at focus depth 8, deepen only that
focused node with `--depth 12 --no-screenshot`, then search it offline.
Offline search/tree calls without `--depth` reuse the deepest matching cached
subtree automatically.

Treat `.env`, raw responses, screenshots, and extracted private assets as
sensitive. They must remain ignored. Keep the CLI strictly read-only.

For design-to-code work, read only the chosen baseline state's compact visible
evidence, use one source-size `detail` call for important child groups, and run
`copy-check` on implementation JSX/TSX before handoff. Never allowlist guessed
copy or sample data; `copy-check` does not replace the required screenshot
comparison.
