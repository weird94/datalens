# DataLens MCP Server

MCP access to the same 10 frontend tools used by the DataLens chat page.

## Install

```bash
npx skills add weird94/datalens --skill datalens
```

## Exposed Tools

The default tool list is intentionally identical to the chat UI tool set:

- `openAiWorkspaceTab`
- `readPageA11yTree`
- `operatePage`
- `detectScrapeTargets`
- `analyzeScrapeConfig`
- `applyDrillDownScrape`
- `startScrape`
- `listWorkspaceAssets`
- `inspectWorkspaceAsset`
- `runDataCode`

## Requirements

1. [`datalens-mcp-server`](https://www.npmjs.com/package/datalens-mcp-server) installed globally or available via `npx`
2. DataLens Chrome extension installed and active
3. DataLens extension signed in, for data workspace tools
4. Node.js ≥ 18

## Usage

After installing the skill, just ask your agent:

> "Scrape the product list from this page: https://example.com/products"

The core flow is `openAiWorkspaceTab` → `detectScrapeTargets` → `analyzeScrapeConfig` → `startScrape`.
Scrape outputs are saved to the DataLens workspace and can be checked with `listWorkspaceAssets`,
`inspectWorkspaceAsset`, and `runDataCode`.
