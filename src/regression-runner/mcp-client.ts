import { execSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { parse } from 'yaml'
import type { RegressionJsonObject, RegressionJsonValue } from './types'

const REGRESSION_MCP_CLIENT_NAME = 'regression-runner'
const REGRESSION_MCP_CLIENT_VERSION = '1.0.0'

export const REGRESSION_MCP_TOOL_NAMES = {
  BROWSER_OPEN_TAB: 'browser_open_tab',
  BROWSER_CLOSE_TAB: 'browser_close_tab',
  DEBUG_CLEAR_LOGS: 'debug_clear_logs',
  DEBUG_EXPORT_LOGS_TO_FILE: 'debug_export_logs_to_file',
  SCRAPE_DETECT_TABLES: 'scrape_detect_tables',
  SCRAPE_EXPORT_TO_FILE: 'scrape_export_to_file',
  SCRAPE_GET_TABLE_TREE: 'scrape_get_table_tree',
  SCRAPE_ANALYZE_COLUMNS: 'scrape_analyze_columns',
  SCRAPE_START: 'scrape_start',
  SCRAPE_STATUS: 'scrape_status',
  SCRAPE_STOP: 'scrape_stop',
} as const

type RegressionMcpToolName =
  (typeof REGRESSION_MCP_TOOL_NAMES)[keyof typeof REGRESSION_MCP_TOOL_NAMES]

export interface RegressionMcpToolClient {
  connect(): Promise<void>
  callTool(toolName: RegressionMcpToolName, args: RegressionJsonObject): Promise<RegressionJsonValue>
  close(): Promise<void>
}

interface ToolTextContent {
  type: string
  text?: string
}

interface ToolCallResult {
  content?: ToolTextContent[]
}

function extractToolText(result: ToolCallResult): string {
  const firstItem = result.content?.[0]
  if (!firstItem || firstItem.type !== 'text' || typeof firstItem.text !== 'string') {
    throw new Error('Unexpected MCP tool result payload')
  }

  return firstItem.text
}

function parseToolText(text: string): RegressionJsonValue {
  const trimmed = text.trim()
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return JSON.parse(trimmed) as RegressionJsonValue
  }

  return parse(trimmed) as RegressionJsonValue
}

function resolveProxyCliPath(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../proxy-cli.ts')
}

function resolvePackageRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
}

export class RegressionMcpClient implements RegressionMcpToolClient {
  private readonly transport = new StdioClientTransport({
    command: 'pnpm',
    args: ['exec', 'tsx', resolveProxyCliPath()],
    cwd: resolvePackageRoot(),
    stderr: 'pipe',
  })

  private readonly client = new Client({
    name: REGRESSION_MCP_CLIENT_NAME,
    version: REGRESSION_MCP_CLIENT_VERSION,
  })

  private readonly transportPid = this.transport.pid

  async connect(): Promise<void> {
    if (this.transport.stderr) {
      this.transport.stderr.on('data', chunk => {
        process.stderr.write(chunk)
      })
    }

    await this.client.connect(this.transport)
  }

  async callTool(
    toolName: RegressionMcpToolName,
    args: RegressionJsonObject
  ): Promise<RegressionJsonValue> {
    const result = (await this.client.callTool({
      name: toolName,
      arguments: args,
    })) as ToolCallResult

    return parseToolText(extractToolText(result))
  }

  async close(): Promise<void> {
    try {
      await this.transport.close()
    } catch {
      // Ignore transport close errors during cleanup.
    }

    if (this.transportPid) {
      try {
        execSync(`pkill -P ${this.transportPid} || true`)
      } catch {
        // Ignore child process cleanup failures.
      }

      try {
        process.kill(this.transportPid, 'SIGTERM')
      } catch {
        // Ignore already-closed process cleanup failures.
      }
    }
  }
}
