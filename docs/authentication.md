# Authentication

figma-lens reads Figma through a personal access token. This page covers creating the token, signing in, the other ways to supply it, and what it can and cannot reach.

## Create a token

In Figma's file browser, open the account menu, choose Settings, open Security, find Personal access tokens, and select Generate new token. Pick an expiration and grant these scopes:

| Scope | Needed for |
| --- | --- |
| `file_content:read` | Reading files. Always required. |
| `current_user:read` | Checking the account when you sign in. |
| `folders:read` | Searching across a team with `find`. |
| `file_metadata:read` | Naming the file and folder when you start team setup from a design URL. |

Copy the token right away, because Figma shows it once. The token never gives access to files its owner cannot already open.

## Sign in

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

## Other ways to supply a token

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

## Limits

figma-lens cannot read an unsaved local `.fig` file, content the token owner cannot open, or anything outside the token's scopes. It does not edit designs. A first read needs network access, while searches and trees over cached data can run with `--offline`.

If `doctor` succeeds but a file request returns 404, the token is valid and Figma did not expose that file or node to its owner. Check that the owner can open the link in a browser.

Figma returns 429 when you exceed its rate limit. figma-lens retries short waits automatically. See the [CLI reference](cli.md#environment-variables) for the retry settings.

Treat `.env` files, saved screenshots and extracted assets as private. Keep `.figma-lens/` out of version control.

More about the setup, including the agent-facing rules, is in [Use with coding agents](agents.md).
