# Changelog

This file records user-visible changes to Figma Lens.

## 0.3.1 - 2026-09-16

- Added file-metadata guidance when team setup starts from a design-node URL.
- Updated CLI and MCP context output with a concise request for the owning team-page URL.
- Updated the agent skill so the agent asks the user for that URL, registers it itself, and retries the original search.

## 0.3.0 - 2026-09-16

- Added cross-file design discovery through registered Figma teams and nested folders.
- Added `context`, `teams`, and `find` CLI commands plus `figma_lens_context` and `figma_lens_find` MCP tools.
- Added fuzzy scope resolution for team, folder, and file names, with natural-language node ranking across names, visible text, components, hierarchy, and annotations.
- Added a private cross-project discovery cache, bounded cold-file indexing, explicit coverage reporting, and compact results with at most two candidate screenshots.
- Added agent guidance for description-led and reference-screenshot-led design discovery.
- Removed the redundant shallow content request when an agent focuses an exact node returned by workspace search.
- Updated npm publishing automation to trigger from version changes and verify GitHub OIDC trust without publishing.

## 0.2.4 - 2026-08-14

- Added exact typography evidence, mixed-style text runs, font availability guidance, and stricter visual verification.
- Published the guided board, state, detail, asset, and copy-provenance workflow for coding agents.
