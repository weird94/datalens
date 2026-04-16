# DataLens Skill

An agent skill that teaches AI coding agents how to use [DataLens](https://datalens.uk) to scrape structured data from any website open in Chrome.

## Install

```bash
npx skills add weird94/datalens --skill datalens
```

## What It Does

Once installed, your agent will know how to:

- Detect scrapable tables and lists on any webpage
- Analyze and auto-configure column schemas via AI
- Start, monitor, pause, resume, and stop scraping jobs
- Export results as JSON, CSV, or XLSX
- Handle nested/tree data with expand-button automation
- Manage browser tabs for multi-page workflows

## Requirements

1. [`datalens-mcp-server`](https://www.npmjs.com/package/datalens-mcp-server) installed globally or available via `npx`
2. DataLens Chrome extension installed and active
3. Chrome open with the target page loaded
4. Node.js ≥ 18

## Usage

After installing the skill, just ask your agent:

> "Scrape the product list from this page: https://example.com/products"

The agent will follow the guided workflow: detect → analyze → preview → export.
