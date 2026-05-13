---
name: datalens
description: Use DataLens MCP tools to scrape structured data from websites through the same frontend tools exposed by the DataLens chat page.
---

# DataLens Scraping Skill

## How Tool Calls Work

Every DataLens tool is invoked by running a terminal command. No MCP client configuration is required.

The `datalens-mcp-call` binary handles the MCP stdio handshake and returns the tool result as YAML/JSON to stdout.

```bash
datalens-mcp-call <tool_name> '<args_json>'
```

If `datalens-mcp-call` is not on PATH, use npx:

```bash
npx datalens-mcp-call <tool_name> '<args_json>'
```

## Available Tools

DataLens MCP exposes exactly the same default tools as the chat page:

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

## Standard Scraping Workflow

Follow these steps in order. Do not skip `analyzeScrapeConfig` before `startScrape`.

### Step 1 - Open the website

```bash
datalens-mcp-call openAiWorkspaceTab '{"url":"https://example.com/products","openMode":"reuse_or_create"}'
```

Copy the returned `tab.id`.

### Step 2 - Detect scrape targets

```bash
datalens-mcp-call detectScrapeTargets '{"tabId":123,"prompt":"product cards"}'
```

Pick the best target and copy `rootSelector`, `itemSelector`, and `documentInfoPath`.

### Step 3 - Analyze the scrape config

```bash
datalens-mcp-call analyzeScrapeConfig '{"tabId":123,"rootSelector":"...","itemSelector":"...","documentInfoPath":"...","prompt":"product cards"}'
```

This returns a `jobId`, `scrapeConfig`, `jobDraft`, and preview rows. Preview rows validate the config only; they do not satisfy requested record counts.

### Step 4 - Optional drill-down extraction

Use this when the user asks for detail-page fields such as full text, body content, product details, company profiles, or job descriptions.

```bash
datalens-mcp-call applyDrillDownScrape '{"tabId":123,"scrapeConfig":<paste scrapeConfig>,"fieldKey":"link","prompt":"full article body"}'
```

Pass the returned `scrapeConfig` to `startScrape`.

### Step 5 - Start collection

```bash
datalens-mcp-call startScrape '{"jobId":"<jobId>","maxRecords":20}'
```

`startScrape` polls internally until the scrape reaches a terminal state. Use `maxRecords` for requested counts instead of manual scrolling.

### Step 6 - Inspect saved workspace output

```bash
datalens-mcp-call listWorkspaceAssets '{}'
datalens-mcp-call inspectWorkspaceAsset '{"fileName":"rows.csv","inspectLevel":"sample","sampleLimit":20}'
```

Use `runDataCode` for validation, cleaning, merging, and chart or CSV outputs:

```bash
datalens-mcp-call runDataCode '{"fileNames":["rows.csv"],"language":"python","mode":"preview","code":"import pandas as pd\nprint(pd.read_csv(\"/workspace/input/rows.csv\").head())"}'
```

## Agent Decision Rules

- Always use `openAiWorkspaceTab` before detecting a new website.
- Use `operatePage` only for setup actions such as login, search, filtering, accepting dialogs, or positioning the page before detection.
- Do not use `operatePage` scrolling to satisfy requested record counts; `startScrape` handles collection.
- Do not fabricate selectors or configs. Use values returned by `detectScrapeTargets`, `analyzeScrapeConfig`, or `applyDrillDownScrape`.
- Use `scope: "workspace"` in workspace tools only when the user explicitly asks for all workspace data or files from another task.

Set `DATALENS_TIMEOUT=180000` before running if a tool call takes longer than the default 120 seconds:

```bash
DATALENS_TIMEOUT=180000 datalens-mcp-call startScrape '{"jobId":"<jobId>","maxRecords":100}'
```
