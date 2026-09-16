# Workspace discovery

Use this workflow when the user describes a design without a file URL. The
scope may name a team, workspace, folder, or file.

## Description-led search

Pass the user's scope wording directly to `scope`. Use the design description
as `query`. Call `figma_lens_context` only when the scope is ambiguous or the
user asks which teams are available. In CLI mode:

```bash
figma-lens find "<NATURAL DESCRIPTION>" --scope "<TEAM, FOLDER, OR FILE>"
```

Omit `--scope` to search all registered teams. View candidate 1 first, then
candidate 2 only if candidate 1 remains uncertain. The compact result contains
the selection evidence; leave the full search artifact unopened.

When coverage is partial and neither candidate is plausible, rerun once with a
larger `max_files` value. When candidates are close but the query was broad,
refine it once with visible product terms. Report partial coverage when it
affects the conclusion.

For implementation, pass the chosen match's exact `url` and node ID to `focus`.
For explanation-only work, stop when a visually confirmed screenshot and its
compact metadata answer the question.

## Reference-screenshot search

View the supplied source screenshot first. Build a short internal fingerprint
from these signals, in order:

1. exact visible copy read with confidence;
2. the screen purpose, actor, action, and state;
3. named controls or distinctive content;
4. one useful layout relationship.

Turn that fingerprint into one concise `find` query. The index searches design
metadata and visible text, so long descriptions of color and spacing add noise.
Compare the returned candidate screenshots through vision using composition,
copy, controls, and state. Refine once if the first pair is inconclusive. A name
or text match without visual confirmation is insufficient.

## Team setup

Figma's REST API does not expose the current user's team IDs. When `find`
returns `needs_setup`, ask the user to run its one-time setup command:

```bash
figma-lens teams add "<FIGMA_TEAM_URL>"
```

After registration, `context` identifies the account and searchable team names,
while `find` resolves fuzzy team, folder, and file scopes. Keep discovery on the
documented REST endpoints and registered scopes.
