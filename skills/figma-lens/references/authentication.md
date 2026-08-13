# Setup and authentication

Figma Lens is read-only and headless. It calls Figma's REST API, so Figma
Desktop is not installed or opened. The file must be saved/imported on Figma's
servers and the token owner must already be able to open it. A personal access
token never bypasses file permissions.

## Install

Use one of these equivalent installs:

```bash
npm install --global figma-lens
# or without a global install:
npx figma-lens@latest --help
# or from GitHub:
curl -fsSL https://raw.githubusercontent.com/khanglvm/figma-lens/main/install.sh | sh
```

A Node.js script may install it without a shell popup:

```js
import { execFileSync } from "node:child_process";
execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", [
  "install", "--global", "figma-lens@latest",
], { stdio: "inherit" });
```

## Create a Figma personal access token

In Figma's file browser, open the account menu, choose **Settings**, open
**Security**, find **Personal access tokens**, and select **Generate new token**.
Choose an expiration and grant `file_content:read`; add `current_user:read` so
Figma Lens can validate the account during login. Copy the token immediately:
Figma only shows it once.

Never ask the user to paste a token into chat. Ask them to run:

```bash
figma-lens auth login
```

Input is hidden. The validated token is stored for later CLI and local MCP use
in an OS config directory with directory mode `0700` and file mode `0600`:

- macOS: `~/Library/Application Support/figma-lens/credentials.json`
- Linux: `${XDG_CONFIG_HOME:-~/.config}/figma-lens/credentials.json`
- Windows: `%APPDATA%\figma-lens\credentials.json`

Safe management commands:

```bash
figma-lens auth status
figma-lens auth path
figma-lens auth logout
figma-lens doctor
```

For CI or one-shot use, keep the token out of argv and shell history:

```bash
printf '%s' "$SECRET_FROM_VAULT" | figma-lens scout "$FIGMA_URL" --token-stdin
figma-lens scout "$FIGMA_URL" --token-file /protected/path/token
FIGMA_TOKEN="$SECRET_FROM_VAULT" figma-lens scout "$FIGMA_URL"
```

An env file is read only when explicitly selected with
`FIGMA_LENS_ENV_FILE=/protected/path/figma.env`; Figma Lens never auto-loads a
project `.env`.

Credential precedence is: `--token-stdin`, `--token-file`, `FIGMA_TOKEN` /
`FIGMA_ACCESS_TOKEN`, saved login, then `FIGMA_LENS_ENV_FILE`.

## Limitations

Figma Lens cannot read an unsaved local `.fig` file, private content the token
owner cannot access, uncommitted Figma Desktop state, or content outside the
token's scopes. It does not edit designs, simulate the full prototype runtime,
or bypass Figma API rate limits. Cold reads require network access; cached
follow-up searches and trees can run offline.

