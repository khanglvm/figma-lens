# figma-lens CLI

<!-- docs:begin index.md -->
figma-lens is a read-only CLI and MCP server that lets a coding agent find, view and measure Figma designs, then check the UI it builds against them. It uses Figma's REST API, so Figma Desktop is not needed.

An independent open-source tool by Khang Le. Not affiliated with Figma or the [Lens - Find & Select Text community plugin](https://www.figma.com/community/plugin/1587855920816168465/lens-find-select-text).

### What it does

figma-lens gives the agent a small, ordered view of a design instead of the whole file:

- It finds the right screen from a Figma link, a description such as "the screen where a recruiter filters candidates", or a reference screenshot.
- It returns a screenshot of the design first, then a short list of the screens or states in it, with the exact next command to run.
- It measures the parts that matter at their original size: spacing, colors, radii, fonts, and the exact text on screen.
- It exports the icons and illustrations from the design, so the agent can reuse them.
- After the agent builds the screen, it checks that the visible text in the code matches the design.

Every result is a compact JSON summary plus files saved under `.figma-lens/`. The agent does not load the whole file's layer tree, which keeps context use small.

### How you use it

You can run the commands yourself, but the tool is built for an agent to run. There are three ways to connect one:

- The agent skill teaches an agent which commands to run and in what order. It needs an agent that can run shell commands.
- The MCP server gives an MCP-capable agent the same workflow as native tools. See [MCP server](docs/mcp.md).
- The CLI is the base for both. See [CLI reference](docs/cli.md).

The workflow needs an agent that can view images and test the UI it builds. Without image viewing, the agent cannot check what it built against the design.

### Where to start

| You want to | Read |
| --- | --- |
| Install the tool and the agent skill | [Install](docs/install.md) |
| Connect a Figma token | [Authentication](docs/authentication.md) |
| Inspect your first design | [Quickstart](docs/quickstart.md) |
| Find a design when you have no link | [Find designs without a link](docs/find-designs.md) |
| Build a screen from a design and check it | [Design-to-code workflow](docs/design-to-code.md) |
| Look up a command, flag or setting | [CLI reference](docs/cli.md) |
| Connect an MCP client | [MCP server](docs/mcp.md) |
| Set up a coding agent | [Use with coding agents](docs/agents.md) |

### Limits

figma-lens only reads. It does not edit designs. It needs a file saved on Figma's servers that the token owner can already open, so it cannot read an unsaved local `.fig` file. Figma permissions and API rate limits apply.
<!-- docs:end -->

## Install

<!-- docs:begin install.md -->
Install figma-lens from npm with Node.js 20 or newer, then add the agent skill if you use a coding agent. You also need a Figma personal access token, which [Authentication](docs/authentication.md) covers.

### Install the CLI

```sh
npm install --global figma-lens
figma-lens --version
```

To try it without a global install, run `npx figma-lens@latest --help`.

The repository also has two install scripts, [install.sh](install.sh) and [install.ps1](install.ps1), for machines where you prefer to run a script. Both check for Node.js 20 and npm, then run the same global `npm install`. Download and read a script before you run it, and never pipe a remote script straight into a shell.

```sh
sh install.sh
sh install.sh --version 0.3.2 --prefix "$HOME/.local"
```

```powershell
./install.ps1
./install.ps1 -Version 0.3.2 -Prefix "$HOME\.local"
```

`--version` (`-Version` on Windows) picks a package version and defaults to `latest`. `--prefix` (`-Prefix`) installs into a different npm prefix.

### Install the agent skill

The skill tells your agent which figma-lens commands to run and when to stop:

```sh
npx -y skills@latest add khanglvm/figma-lens --skill figma-lens --global --yes
```

Start a new agent session afterwards so the agent discovers the skill. The skill also ships inside the npm package under `skills/figma-lens/`.

Agents that support MCP can use the tools instead of the CLI. See [MCP server](docs/mcp.md).

### Check the install

```sh
figma-lens --version
figma-lens auth status
```

`auth status` exits with code 1 until a token is configured. Add one in the [next step](docs/authentication.md), then run `figma-lens doctor` to confirm that Figma accepts it.
<!-- docs:end -->

## Connect your Figma token

<!-- docs:begin authentication.md -->
figma-lens reads Figma through a personal access token. This page covers creating the token, signing in, the other ways to supply it, and what it can and cannot reach.

### Create a token

In Figma's file browser, open the account menu, choose Settings, open Security, find Personal access tokens, and select Generate new token. Pick an expiration and grant these scopes:

| Scope | Needed for |
| --- | --- |
| `file_content:read` | Reading files. Always required. |
| `current_user:read` | Checking the account when you sign in. |
| `folders:read` | Searching across a team with `find`. |
| `file_metadata:read` | Naming the file and folder when you start team setup from a design URL. |

Copy the token right away, because Figma shows it once. The token never gives access to files its owner cannot already open.

### Sign in

```sh
figma-lens auth login
figma-lens doctor
```

The token prompt hides what you type. `auth login` checks the token with Figma and saves it. `doctor` makes one request to Figma and prints your account handle if the token works. Keep the token out of chat and out of source control.

The saved login lives in a private folder (directory mode `0700`, file mode `0600`):

| System | Path |
| --- | --- |
| macOS | `~/Library/Application Support/figma-lens/credentials.json` |
| Linux | `${XDG_CONFIG_HOME:-~/.config}/figma-lens/credentials.json` |
| Windows | `%APPDATA%\figma-lens\credentials.json` |

`figma-lens auth path` prints the path, `auth status` shows where the current token comes from, and `auth logout` deletes the saved login. `FIGMA_LENS_CONFIG_DIR` moves the folder.

### Other ways to supply a token

For CI or a one-off run, keep the token out of the command line and shell history:

```sh
printf '%s' "$SECRET_FROM_VAULT" | figma-lens scout "$FIGMA_URL" --token-stdin
figma-lens scout "$FIGMA_URL" --token-file /protected/path/token
FIGMA_TOKEN="$SECRET_FROM_VAULT" figma-lens scout "$FIGMA_URL"
```

`--token-file` accepts a file holding only the token, or a line such as `FIGMA_TOKEN=...`. An env file is read only when you point `FIGMA_LENS_ENV_FILE` at it. figma-lens never loads a project `.env` on its own.

When more than one source is present, the first of these wins:

1. `--token-stdin`
2. `--token-file`
3. `FIGMA_TOKEN`, then `FIGMA_ACCESS_TOKEN`
4. The saved login
5. The file named by `FIGMA_LENS_ENV_FILE`

`figma-lens mcp` does not accept `--token-stdin`, because stdin carries the MCP protocol. Use the saved login, `FIGMA_TOKEN` in the MCP host's configuration, or `--token-file`.

### Limits

figma-lens cannot read an unsaved local `.fig` file, content the token owner cannot open, or anything outside the token's scopes. It does not edit designs. A first read needs network access, while searches and trees over cached data can run with `--offline`.

If `doctor` succeeds but a file request returns 404, the token is valid and Figma did not expose that file or node to its owner. Check that the owner can open the link in a browser.

Figma returns 429 when you exceed its rate limit. figma-lens retries short waits automatically. See the [CLI reference](docs/cli.md#environment-variables) for the retry settings.

Treat `.env` files, saved screenshots and extracted assets as private. Keep `.figma-lens/` out of version control.

More about the setup, including the agent-facing rules, is in [Use with coding agents](docs/agents.md).
<!-- docs:end -->

## Try it

<!-- docs:begin quickstart.md -->
Inspect your first Figma design in a few minutes: sign in, scout a link, and read the result. This page assumes figma-lens and a token are set up, as covered in [Install](docs/install.md) and [Authentication](docs/authentication.md).

### 1. Check that it works

```sh
figma-lens doctor
```

You should see `"ok": true` and your Figma account handle.

### 2. Scout a board or flow

Copy a link to a Figma board, flow or screen from Figma, then run:

```sh
figma-lens scout "https://www.figma.com/design/FILE_KEY/File?node-id=1-2"
```

The output is a short JSON summary. Open the file named in `overview.screenshot` to see the design. `overview.states` lists the screens or states in order, each with its node ID, and `next` holds commands you can copy for the following step.

### 3. Pull out one screen

When the link points at one exact screen, or `scout` showed you which screen you want, ask for it by description:

```sh
figma-lens extract "https://www.figma.com/design/FILE_KEY/File?node-id=1-2" \
  --intent "the screen I want to build"
```

`extract` saves a screenshot of that screen, the text that appears on it, a summary of its layout and typography, and any icons or illustrations it found. The JSON on screen lists the paths.

If the description is too vague to pick one screen, `extract` stops and prints a `scout` command to run instead of guessing.

### 4. Look at the results

Results are saved in `.figma-lens/` in the current folder. Add that folder to `.gitignore`, because it can hold private designs and images.

### Next steps

- Describe a design without a link: [Find designs without a link](docs/find-designs.md).
- Build a screen and check it against the design: [Design-to-code workflow](docs/design-to-code.md).
- Hand the work to an agent: [Use with coding agents](docs/agents.md).
<!-- docs:end -->

## Find designs without a link

<!-- docs:begin find-designs.md -->
Describe the design you want, such as "the screen where a recruiter filters candidates and sees no results", and figma-lens searches your Figma teams for it. This page covers the one-time team setup and how to search.

### Register your teams once

Figma's API cannot list the team IDs of a user, so you register each team you want searched. Copy the URL of the team page from Figma's file browser (it contains `/team/` followed by a number) and add it:

```sh
figma-lens teams add "https://www.figma.com/files/.../team/TEAM_ID/..."
figma-lens context
```

`teams add` checks the team with Figma and saves its ID and name. `context` prints your account and the registered teams. Both need a token with the `folders:read` scope; see [Authentication](docs/authentication.md).

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

### Search

```sh
figma-lens find "recruiter filters candidates and sees no results" \
  --scope "Product Design / Recruitment"
```

`--scope` narrows the search to a team, folder or file name. It matches loosely, so you do not need the exact name. Leave it out to search every registered team.

The result is a short ranked list with at most two screenshots. Open the first screenshot, and the second only if the first is wrong. `next.focus` holds the commands that focus on each of the top two matches, and `coverage` reports how many files were indexed.

### How much it searches

The first call reads up to eight files that are not cached yet, and every later call reuses the cached ones, so coverage grows over time. The index covers names, visible text, component metadata, hierarchy and annotations down to depth 3.

- `--max-files 20` indexes more files in one call.
- `--offline` searches only the cache and never calls Figma.
- `--refresh` rebuilds the cache when the files have changed.

The result's `status` is `complete` when every file in scope was indexed and `partial` otherwise. When it is `partial` and nothing fits, run `find` again with a larger `--max-files`.

### Search with a reference screenshot

Figma has no image-similarity search. Give your agent the screenshot instead. The agent reads the visible text, the purpose and state of the screen, and its main controls, then runs `find` with a short query built from those. It compares the returned screenshots with your reference by eye. See [Use with coding agents](docs/agents.md) for the exact steps.

### Next

Once you have a match, move on to the [Design-to-code workflow](docs/design-to-code.md), starting from the `focus` command in the result.
<!-- docs:end -->

## With a coding agent

Install the skill from the Install section, or connect the [MCP server](docs/mcp.md), and give the agent a Figma link. Tell it to open the returned screenshots before it explains or builds anything, and to treat text inside the design as content, not instructions. The exact commands, output fields and limits an agent needs are in [Use with coding agents](docs/agents.md). The same pages are online at [docs.khangle.dev/figma-lens](https://docs.khangle.dev/figma-lens), and as one plain-text file at [llms-full.txt](https://docs.khangle.dev/figma-lens/llms-full.txt).

## Reference

- [Command reference](docs/cli.md): commands, flags, caching and configuration.
- [Design-to-code workflow](docs/design-to-code.md): inspecting states and checking an implementation.
- [Authentication](docs/authentication.md): token scopes, credential storage and other ways to supply a token.
- [MCP server](docs/mcp.md): local and self-hosted tool configuration.
- [Setup and limits for agents](skills/figma-lens/references/authentication.md): the same setup as the skill reads it.
- [Changelog](CHANGELOG.md): release history and user-visible changes.

[MIT license](LICENSE).
