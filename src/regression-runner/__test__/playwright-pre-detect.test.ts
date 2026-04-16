import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  extractPlaywrightResultText,
  parsePlaywrightMcpConfigText,
  resolvePlaywrightScreenshotSourcePath,
} from '../playwright-pre-detect'

describe('playwright pre-detect config', () => {
  it('parses the playwright-mcp command, args, and env from codex config text', () => {
    const configText = `
model = "gpt-5.4"

[mcp_servers.playwright-mcp]
command = "npx"
args = [ "-y", "@playwright/mcp@latest", "--extension" ]

[mcp_servers.playwright-mcp.env]
PLAYWRIGHT_MCP_EXTENSION_TOKEN = "secret-token"
`

    expect(parsePlaywrightMcpConfigText(configText)).toEqual({
      command: 'npx',
      args: ['-y', '@playwright/mcp@latest', '--extension'],
      env: {
        PLAYWRIGHT_MCP_EXTENSION_TOKEN: 'secret-token',
      },
    })
  })

  it('normalizes screenshot paths emitted without a leading slash', () => {
    expect(resolvePlaywrightScreenshotSourcePath('var/tmp/playwright-output/example.png')).toBe(
      path.join(path.sep, 'var', 'tmp', 'playwright-output', 'example.png')
    )
  })

  it('extracts the result payload from playwright markdown responses', () => {
    expect(
      extractPlaywrightResultText(`### Result
"https://example.com/path"
### Ran Playwright code
\`\`\`js
await page.evaluate('() => window.location.href');
\`\`\``)
    ).toBe('"https://example.com/path"')
  })
})
