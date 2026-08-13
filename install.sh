#!/bin/sh
set -eu

package="figma-lens"
version="latest"
prefix=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --version)
      version="$2"
      shift 2
      ;;
    --prefix)
      prefix="$2"
      shift 2
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 2
      ;;
  esac
done

command -v node >/dev/null 2>&1 || { echo "figma-lens requires Node.js 20+." >&2; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "figma-lens requires npm." >&2; exit 1; }

node -e 'const major=Number(process.versions.node.split(".")[0]); if (major < 20) process.exit(1)' || {
  echo "figma-lens requires Node.js 20+." >&2
  exit 1
}

if [ -n "$prefix" ]; then
  npm install --global --prefix "$prefix" "$package@$version"
else
  npm install --global "$package@$version"
fi

figma-lens --version 2>/dev/null || true
echo "Run 'figma-lens auth login' to connect a Figma personal access token."

