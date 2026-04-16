# DataLens MCP Server

Node MCP server for DataLens. The recommended runtime is a shared local daemon plus a lightweight `stdio` proxy per MCP client. The daemon owns the browser bridge, and each Codex instance talks to the daemon through its own proxy session.

## Quick Start

> **Prerequisites**: Install the DataLens Chrome extension and keep the browser open. The daemon communicates with the extension through a fixed local WebSocket bridge.

### Configure your MCP client

The npm package is not published yet. For now, point your MCP client at a local checkout of this repository.

Replace every `/ABSOLUTE/PATH/TO/general-scraping` below with your local repository root.

Pick the config that matches your client:

#### Codex

Add the server with the CLI:

```bash
codex mcp add datalens-mcp -- \
  pnpm --dir /ABSOLUTE/PATH/TO/general-scraping exec tsx \
  /ABSOLUTE/PATH/TO/general-scraping/packages/mcp-server/src/proxy-cli.ts
```

Or add it directly to `~/.codex/config.toml`:

```toml
[mcp_servers.datalens-mcp]
command = "pnpm"
args = ["--dir", "/ABSOLUTE/PATH/TO/general-scraping", "exec", "tsx", "/ABSOLUTE/PATH/TO/general-scraping/packages/mcp-server/src/proxy-cli.ts"]
```

#### Cursor / Windsurf

Create or edit `~/.cursor/mcp.json` (Cursor) or `~/.codeium/windsurf/mcp_config.json` (Windsurf):

```jsonc
{
  "mcpServers": {
    "datalens-mcp": {
      "command": "pnpm",
      "args": [
        "--dir",
        "/ABSOLUTE/PATH/TO/general-scraping",
        "exec",
        "tsx",
        "/ABSOLUTE/PATH/TO/general-scraping/packages/mcp-server/src/proxy-cli.ts"
      ]
    },
  }
}
```

#### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```jsonc
{
  "mcpServers": {
    "datalens-mcp": {
      "command": "pnpm",
      "args": [
        "--dir",
        "/ABSOLUTE/PATH/TO/general-scraping",
        "exec",
        "tsx",
        "/ABSOLUTE/PATH/TO/general-scraping/packages/mcp-server/src/proxy-cli.ts"
      ]
    },
  }
}
```

#### VS Code (GitHub Copilot)

Add to your VS Code `settings.json` (user or workspace):

```jsonc
{
  "mcp": {
    "servers": {
      "datalens-mcp": {
        "command": "pnpm",
        "args": [
          "--dir",
          "/ABSOLUTE/PATH/TO/general-scraping",
          "exec",
          "tsx",
          "/ABSOLUTE/PATH/TO/general-scraping/packages/mcp-server/src/cli.ts"
        ]
      },
    }
  }
}
```

Or create a `.vscode/mcp.json` file in your project root:

```jsonc
{
  "servers": {
    "datalens-mcp": {
      "command": "pnpm",
      "args": [
        "--dir",
        "/ABSOLUTE/PATH/TO/general-scraping",
        "exec",
        "tsx",
        "/ABSOLUTE/PATH/TO/general-scraping/packages/mcp-server/src/proxy-cli.ts"
      ]
    },
  }
}
```

#### Cline

Edit `~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`:

```jsonc
{
  "mcpServers": {
    "datalens-mcp": {
      "command": "pnpm",
      "args": [
        "--dir",
        "/ABSOLUTE/PATH/TO/general-scraping",
        "exec",
        "tsx",
        "/ABSOLUTE/PATH/TO/general-scraping/packages/mcp-server/src/proxy-cli.ts"
      ]
    },
  }
}
```

## Runtime Modes

### Recommended: shared daemon + `stdio` proxy

- Each MCP client launches `proxy-cli.ts` over `stdio`.
- The proxy checks daemon health and auto-starts `daemon-cli.ts` if needed.
- The daemon owns the fixed browser bridge port and the local control port.
- Multiple Codex clients can run concurrently because only the daemon touches the browser bridge.
- Session state is isolated per proxy session.

### Standalone compatibility mode

- `cli.ts` still exists for direct single-process startup.
- Standalone mode is still single-client because it owns the browser bridge directly.

## Session Isolation

- selected tabs are tracked per proxy session
- protected tab tools acquire an exclusive tab lease
- started jobs are bound to the creating session
- cross-session access to leased tabs or owned jobs returns a structured error

## Quick Verification

### Codex

```bash
codex exec --json \
  "Call the MCP tool named datalens-mcp.browser_list_tabs exactly once. Do not call any other MCP tool."
```

Expected outcomes:

- Success: returns a real tab list from the extension bridge.
- Extension not attached: returns `Bridge unavailable: extension not connected`.
- Daemon control port occupied by a non-DataLens process: the proxy fails before startup.
- Standalone `cli.ts` already owning the bridge port: daemon startup times out and the proxy exits with an error.

## Environment Variables

| Variable                    | Default     | Description                                       |
| --------------------------- | ----------- | ------------------------------------------------- |
| `MCP_BRIDGE_HOST`           | `127.0.0.1` | WebSocket bridge listen host                      |
| `MCP_BRIDGE_PORT`           | `17373`     | WebSocket bridge listen port                      |
| `MCP_BRIDGE_PATH`           | `/bridge`   | WebSocket bridge URL path                         |
| `MCP_DAEMON_CONTROL_HOST`   | `127.0.0.1` | Daemon control listen host                        |
| `MCP_DAEMON_CONTROL_PORT`   | `17374`     | Daemon control listen port                        |
| `MCP_BRIDGE_TOKEN`          | _(none)_    | Shared token for extension handshake (optional)   |
| `MCP_ALLOWED_EXTENSION_IDS` | _(none)_    | Comma-separated extension ID allowlist (optional) |

## Tools

| Tool                            | Description                                             |
| ------------------------------- | ------------------------------------------------------- |
| `browser_open_tab`              | Open a browser tab and make it active                   |
| `browser_list_tabs`             | List all available browser tabs                         |
| `browser_use_tab`               | Select and activate a browser tab                       |
| `browser_close_tab`             | Close a browser tab                                     |
| `debug_get_logs`                | Query structured extension debug logs                   |
| `debug_clear_logs`              | Clear all or filtered extension debug logs              |
| `debug_export_logs_to_file`     | Export extension debug logs directly to a local file    |
| `scrape_detect_tables`          | Detect candidate tables in the active tab               |
| `scrape_get_table_tree`         | Fetch the UID-annotated simplified table tree           |
| `scrape_click_expand_and_redetect` | Click expand buttons and re-detect the table        |
| `scrape_analyze_columns`        | Analyze columns and build a scraper config draft        |
| `scrape_start`                  | Start a scraping job from a config                      |
| `scrape_status`                 | Get status and counters of a scraping job (supports optional `waitMs`) |
| `scrape_pause`                  | Pause a running scraping job                            |
| `scrape_resume`                 | Resume a paused scraping job                            |
| `scrape_stop`                   | Stop a scraping job                                     |
| `scrape_result`                 | Fetch paginated rows from a job result                  |
| `scrape_export`                 | Export job results to JSON/CSV/XLSX                     |
| `scrape_export_to_file`         | Export job results directly to a local file             |

### Step-by-step `next_action` hints

For step-by-step scraping tools:

- `scrape_detect_tables`
- `scrape_get_table_tree`
- `scrape_click_expand_and_redetect`
- `scrape_analyze_columns`

the MCP response includes a top-level `next_action` string in English. The text always contains:

- `Primary: ...`
- `Alternatives:`

Only successful responses include `next_action`. Error responses are unchanged. Other tools are unchanged.
