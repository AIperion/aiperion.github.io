#!/bin/sh
# Bridges Penpot's hosted MCP server to stdio via mcp-remote, so the key can come
# from the repo-root .env file instead of the harness environment.
# Key lookup order: exported PENPOT_MCP_KEY, then PENPOT_MCP_KEY=... in <repo>/.env.
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
env_file="$root/.env"

read_env() {
  [ -f "$env_file" ] || return 0
  value=$(sed -n "s/^[[:space:]]*\(export[[:space:]][[:space:]]*\)\{0,1\}$1[[:space:]]*=[[:space:]]*//p" "$env_file" | tail -n 1 | tr -d '\r')
  case $value in
    \"*\") value=${value#\"}; value=${value%\"} ;;
    \'*\') value=${value#\'}; value=${value%\'} ;;
  esac
  printf '%s' "$value"
}

key=${PENPOT_MCP_KEY:-$(read_env PENPOT_MCP_KEY)}
url=${PENPOT_MCP_URL:-$(read_env PENPOT_MCP_URL)}
url=${url:-https://design.penpot.app/mcp/stream}

if [ -z "$key" ]; then
  echo "penpot-mcp: PENPOT_MCP_KEY is not set. Export it or add it to $env_file (see .env.example)." >&2
  exit 1
fi

# mcp-remote logs the full URL to stderr, which harnesses persist in their MCP logs:
# keep stdout (the MCP protocol stream) untouched and mask the token on stderr.
{ npx -y mcp-remote@0.14.3 "$url?userToken=$key" "$@" 2>&1 1>&3 3>&- |
    sed -u 's/userToken=[^&[:space:]]*/userToken=***/g' >&2; } 3>&1
