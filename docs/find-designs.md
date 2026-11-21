# Find designs without a link

Describe the design you want, such as "the screen where a recruiter filters candidates and sees no results", and figma-lens searches your Figma teams for it. This page covers the one-time team setup and how to search.

## Register your teams once

Figma's API cannot list the team IDs of a user, so you register each team you want searched. Copy the URL of the team page from Figma's file browser (it contains `/team/` followed by a number) and add it:

```sh
figma-lens teams add "https://www.figma.com/files/.../team/TEAM_ID/..."
figma-lens context
```

`teams add` checks the team with Figma and saves its ID and name. `context` prints your account and the registered teams. Both need a token with the `folders:read` scope; see [Authentication](authentication.md).

If you only have a link to a design, pass it to `teams add` instead:

```sh
figma-lens teams add "https://www.figma.com/design/FILE_KEY/File?node-id=1-2"
```

figma-lens names the file and folder that link belongs to, then prints the request to send you: paste the URL of the team page that holds that folder. A design link cannot reveal the team ID, because Figma's file data leaves out the parent team. Naming the file and folder needs the `file_metadata:read` scope. Once you have the team URL, run `teams add` with it.

Other team commands:

```sh
figma-lens teams list
figma-lens teams remove TEAM_ID
```

For a one-off search, `--team` takes team IDs or URLs without saving them, and `FIGMA_LENS_TEAM_IDS` adds teams from the environment, for example in CI.

## Search

```sh
figma-lens find "recruiter filters candidates and sees no results" \
  --scope "Product Design / Recruitment"
```

`--scope` narrows the search to a team, folder or file name. It matches loosely, so you do not need the exact name. Leave it out to search every registered team.

The result is a short ranked list with at most two screenshots. Open the first screenshot, and the second only if the first is wrong. `next.focus` holds the commands that focus on each of the top two matches, and `coverage` reports how many files were indexed.

## How much it searches

The first call reads up to eight files that are not cached yet, and every later call reuses the cached ones, so coverage grows over time. The index covers names, visible text, component metadata, hierarchy and annotations down to depth 3.

- `--max-files 20` indexes more files in one call.
- `--offline` searches only the cache and never calls Figma.
- `--refresh` rebuilds the cache when the files have changed.

The result's `status` is `complete` when every file in scope was indexed and `partial` otherwise. When it is `partial` and nothing fits, run `find` again with a larger `--max-files`.

## Search with a reference screenshot

Figma has no image-similarity search. Give your agent the screenshot instead. The agent reads the visible text, the purpose and state of the screen, and its main controls, then runs `find` with a short query built from those. It compares the returned screenshots with your reference by eye. See [Use with coding agents](agents.md) for the exact steps.

## Next

Once you have a match, move on to the [Design-to-code workflow](design-to-code.md), starting from the `focus` command in the result.
