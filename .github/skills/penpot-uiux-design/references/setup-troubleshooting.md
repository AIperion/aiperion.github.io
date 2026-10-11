# Penpot MCP Server Setup & Troubleshooting

Setup and troubleshooting for Penpot's official MCP server. Sources: [Penpot Help Center – MCP](https://help.penpot.app/mcp/) and [penpot/penpot `mcp/` README](https://github.com/penpot/penpot/tree/develop/mcp).

> The standalone `penpot/penpot-mcp` repository was **archived on 2026-02-03**; the server now lives in `penpot/penpot/mcp` and is published as `@penpot/mcp`. The legacy `/sse` and `/messages` endpoints are **no longer supported** — clients must use Streamable HTTP.

## Architecture Overview

Three pieces work together:

```text
┌──────────────────┐  Streamable HTTP  ┌──────────────────┐  WebSocket  ┌──────────────────────┐
│ MCP client       │ ────────────────► │ Penpot MCP server│ ◄─────────► │ MCP plugin in Penpot │
│ (VS Code Copilot)│                   │ (hosted / local) │             │ (your browser tab)   │
└──────────────────┘                   └──────────────────┘             └──────────────────────┘
```

- **MCP server** — exposes tools to the AI client and forwards requests to Penpot.
- **MCP plugin** — runs inside your open Penpot file; gives the server access to the **currently focused page**.
- **MCP client** — VS Code (Copilot agent mode), Claude Code, Cursor, etc.

## Remote vs Local

| | Remote (hosted) — **used in this workspace** | Local |
| - | - | - |
| Runs | On Penpot's infrastructure | On your machine (Node.js 22+) |
| Endpoint | `https://<penpot-domain>/mcp/stream?userToken=<MCP key>` (SaaS: `design.penpot.app`) | `http://localhost:4401/mcp` |
| Auth | Personal MCP key | Your active Penpot session |
| Plugin | Built in: **File → MCP Server → Connect** | Load `http://localhost:4400/manifest.json` via **Plugins** |
| File-system access | None — `import_image` is not exposed (verified: tools are `execute_code`, `high_level_overview`, `penpot_api_info`, `export_shape`); `export_shape` can't write to local paths | Full |
| Pick when | Design-only work (default) | The agent must import/export local files, or for self-hosted Penpot development |

## Remote Setup (default)

1. **Enable MCP**: in Penpot go to **Your account → Integrations → MCP Server** and enable it.
2. **Generate an MCP key**: shown **only once** — store it in a password manager. One key per user; generating a new one invalidates the old one.
3. **Store the key locally**: `cp .env.example .env` at the repo root and set `PENPOT_MCP_KEY=<MCP key>`. `.env` is gitignored. An exported `PENPOT_MCP_KEY` takes precedence over the file.
4. **Start the agent harness** in this repository and trust the workspace when asked. The root `.mcp.json` starts `.github/mcp/penpot.sh`, which reads the key and bridges the hosted server to stdio with [`mcp-remote`](https://www.npmjs.com/package/mcp-remote) (pinned; needs Node.js/`npx`).
5. **Connect the plugin**: open a design file in Penpot and choose **File → MCP Server → Connect**.
6. **Verify**: ask the agent to run a read-only `execute_code`, e.g. `return { file: penpot.currentFile?.name, page: penpot.currentPage?.name };`. (`high_level_overview` returns static guidance and succeeds even without a connected file.)

> **Never commit the key.** Only `.env.example` (empty value) is tracked; `.env` and `.env.*` are gitignored. The bridge masks `userToken=` in its stderr so the key does not land in harness MCP logs.

### Why a stdio bridge instead of a plain `url` entry

No harness loads a `.env` file for **remote HTTP** servers — VS Code's `envFile` applies to stdio servers only, and Copilot CLI / Claude Code expand `${VAR}` from the process environment only. Penpot accepts the key only as the `userToken` query parameter, so the key cannot move into a header either. A stdio server that reads `.env` itself is the one setup every harness runs the same way.

### Which harnesses pick it up

| Harness | Reads root `.mcp.json` |
| ------- | ---------------------- |
| VS Code (Copilot chat + Agent Host) | Yes — the recommended portable format (`.vscode/mcp.json` is deprecated) |
| GitHub Copilot CLI | Yes (`.mcp.json` or `.github/mcp.json`, walking up to the repo root) — verified with this bridge |
| Claude Code | Yes (project scope; approve the server on first run) |
| Cursor | No — add the same `command`/`args` to `.cursor/mcp.json` |
| Codex CLI, Gemini CLI | No — add the same `command`/`args` to `config.toml` / `.gemini/settings.json` |
| Copilot coding agent (github.com) | No — repository settings → Copilot → MCP, secrets as `COPILOT_MCP_*` |

Workspace servers only start in a **trusted** workspace/folder. The bridge needs a POSIX shell (macOS, Linux, WSL, Git Bash).

### Limitations

- The key is part of `mcp-remote`'s command line and therefore visible to other local users via `ps` while it runs. Fine on a single-user machine; on shared hosts prefer a per-user setup.
- If the hosted server rejects the key, `mcp-remote` may try OAuth discovery and open a browser — fix the key instead.

### Alternative: no `.env`, key from the macOS Keychain

The bridge uses an exported `PENPOT_MCP_KEY` when present, so you can skip `.env` entirely:

```bash
security add-generic-password -a "$USER" -s penpot-mcp -w '<MCP key>'
# ~/.zprofile
export PENPOT_MCP_KEY="$(security find-generic-password -a "$USER" -s penpot-mcp -w 2>/dev/null)"
```

### Alternative: register per user instead of per repository

To use Penpot from every workspace without the bridge, add a remote entry to `~/.copilot/mcp-config.json` (read by VS Code, the Agent Host and Copilot CLI) with the key taken from an exported variable, or run:

```bash
npx -y add-mcp -g -n penpot 'https://design.penpot.app/mcp/stream?userToken=${PENPOT_MCP_KEY}'
```

Keep the `${PENPOT_MCP_KEY}` reference rather than pasting the literal key.

## Local Setup (advanced)

```bash
# Latest released version (matches design.penpot.app)
npx -y @penpot/mcp@latest
```

This starts the MCP server (`4401`), the WebSocket server for the plugin (`4402`) and the plugin web server (`4400`). Then:

1. In Penpot, open a design file → **Plugins** → load `http://localhost:4400/manifest.json`.
2. Open the plugin UI and click **Connect to MCP server** — status changes to "Connected". Keep the plugin UI open.
3. Point the client at `http://localhost:4401/mcp`:

```json
{
  "servers": {
    "penpot-local": {
      "type": "http",
      "url": "http://localhost:4401/mcp"
    }
  }
}
```

Clients that only support stdio can proxy with `npx -y mcp-remote http://localhost:4401/mcp --allow-http`.

### Local configuration

| Variable | Purpose | Default |
| -------- | ------- | ------- |
| `PENPOT_MCP_SERVER_PORT` | MCP server port | `4401` |
| `PENPOT_MCP_WEBSOCKET_PORT` | Plugin WebSocket port | `4402` |
| `PENPOT_MCP_REMOTE_MODE` | Disable file-system tools | `false` |

See the [`mcp/` README](https://github.com/penpot/penpot/tree/develop/mcp#configuration) for the full list.

## Troubleshooting

| Symptom | Fix |
| ------- | --- |
| Tools don't appear | VS Code: **MCP: List Servers** → `penpot` → status / **Show Output**. Copilot CLI: `copilot mcp list`. Claude Code: `claude mcp list` (approve the project server first). Check the workspace is trusted. |
| `penpot-mcp: PENPOT_MCP_KEY is not set` in the server output | Create `.env` from `.env.example` at the repo root (or export the variable) and restart the server. |
| `401` / unauthorized, or a browser OAuth window opens | Key wrong or regenerated in Penpot — update `.env` and restart the server. |
| `npx: command not found` | Install Node.js; GUI-launched editors may not see a shell-only `PATH` — start the editor from a terminal or fix its `PATH`. |
| "No Penpot plugin instance is connected" | Open a design file and use **File → MCP Server → Connect** (remote) or reconnect the plugin UI (local). |
| "Penpot tab appears to be suspended" / tasks fail fast | Browser froze or unloaded the tab. Focus the tab, wait for reconnect, retry. Chrome: **Settings → Performance → Always keep these sites active**; Edge: add Penpot to *never sleep*; pin the tab. |
| Agent edits the wrong page | MCP follows the **focused page**, and only one tab can own MCP — focus the right page/tab before prompting. |
| Plugin can't reach `localhost` (local only) | Chromium 142+ private-network-access prompt — allow it. In Brave disable Shields for Penpot, or use Firefox. |
| Using `/sse` URL | Removed. Use `/mcp` (local) or `/mcp/stream?userToken=…` (remote). |
| Port in use (local) | `lsof -i :4401` then stop that process, or change `PENPOT_MCP_*_PORT`. |
| `No Penpot instance connected for user token` | Server and key are fine; open a design file and use **File → MCP Server → Connect** with the same Penpot account the key belongs to. Keep that tab focused. |
| Poor or broken results | Use a frontier, vision-capable model; split large requests into small, reviewable steps. |

## Verifying the Setup

Start read-only:

1. "Which Penpot file and page are you connected to?" (read-only `execute_code`)
2. "List the components and color styles in this file."
3. "Export the main board as PNG so you can check it." (`export_shape`)

Only then try small write operations, asking the agent to describe changes before applying them.

## Getting Help

- [Penpot Help Center – MCP](https://help.penpot.app/mcp/)
- [Penpot MCP video playlist](https://www.youtube.com/playlist?list=PLgcCPfOv5v57SKMuw1NmS0-lkAXevpn10)
- [penpot/penpot issues](https://github.com/penpot/penpot/issues)
