#!/usr/bin/env node
/**
 * DataLens MCP tool caller — published bin entry point
 *
 * Invokes a single DataLens MCP tool over stdio without requiring an MCP
 * client to be configured. Handles the MCP initialization handshake
 * automatically.
 *
 * Usage (after npm install -g datalens-mcp-server):
 *   datalens-mcp-call <tool_name> [args_json]
 *
 * Usage (via npx):
 *   npx datalens-mcp-server call <tool_name> [args_json]   (via datalens-mcp-call alias)
 *
 * Examples:
 *   datalens-mcp-call openAiWorkspaceTab '{"url":"https://example.com"}'
 *   datalens-mcp-call detectScrapeTargets '{"tabId":123,"prompt":"product cards"}'
 *   datalens-mcp-call startScrape '{"jobId":"abc123","maxRecords":20}'
 *
 * Requires:
 *   - DataLens Chrome extension installed and Chrome open
 *   - The daemon/proxy is started automatically if not already running
 */

import { spawn } from 'child_process'
import path from 'path'
import { createInterface } from 'readline'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

const toolName = process.argv[2]
const toolArgs = process.argv[3] ? JSON.parse(process.argv[3]) : {}
const timeoutMs = parseInt(process.env.DATALENS_TIMEOUT ?? '120000', 10)

if (!toolName) {
  console.error('Usage: datalens-mcp-call <tool_name> [args_json]')
  console.error('Example: datalens-mcp-call openAiWorkspaceTab \'{"url":"https://example.com"}\'')
  process.exit(1)
}

// ---------------------------------------------------------------------------
// Resolve proxy-cli (sibling in dist/, or falls back to cli directly)
// ---------------------------------------------------------------------------

// When installed from npm, this file lives at <pkg>/dist/call-cli.js
// proxy-cli.js is a sibling in the same dist/ directory.
const proxyCli = path.resolve(__dirname, 'proxy-cli.js')
const serverArgs = ['node', proxyCli]

// ---------------------------------------------------------------------------
// Spawn MCP server process
// ---------------------------------------------------------------------------

const server = spawn(serverArgs[0], serverArgs.slice(1), {
  stdio: ['pipe', 'pipe', 'inherit'],
  env: process.env,
})

const rl = createInterface({ input: server.stdout!, crlfDelay: Infinity })

let buffer = ''
rl.on('line', (line: string) => {
  const trimmed = line.trim()
  if (!trimmed) return
  buffer += trimmed
  try {
    handleMessage(JSON.parse(buffer))
    buffer = ''
  } catch {
    // Incomplete JSON — keep buffering
  }
})

// ---------------------------------------------------------------------------
// MCP protocol
// ---------------------------------------------------------------------------

function send(msg: unknown) {
  server.stdin.write(JSON.stringify(msg) + '\n')
}

function handleMessage(msg: Record<string, unknown>) {
  // Ignore server-side notifications (no id)
  if (!('id' in msg)) return

  if (msg.id === 1) {
    // Initialize response received — send initialized notification then call tool
    send({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} })
    send({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: toolName, arguments: toolArgs },
    })
    return
  }

  if (msg.id === 2) {
    clearTimeout(timer)
    const error = msg.error as Record<string, unknown> | undefined
    if (error) {
      console.error(JSON.stringify(error, null, 2))
      server.kill()
      process.exit(1)
    }
    const result = msg.result as { content?: Array<{ type: string; text: string }> } | undefined
    if (Array.isArray(result?.content)) {
      const text = result!.content
        .filter(c => c.type === 'text')
        .map(c => c.text)
        .join('\n')
      try {
        console.log(JSON.stringify(JSON.parse(text), null, 2))
      } catch {
        console.log(text)
      }
    } else {
      console.log(JSON.stringify(result, null, 2))
    }
    server.kill()
    process.exit(0)
  }
}

// ---------------------------------------------------------------------------
// Handshake
// ---------------------------------------------------------------------------

send({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'datalens-call-cli', version: '1.0.0' },
  },
})

// ---------------------------------------------------------------------------
// Timeout
// ---------------------------------------------------------------------------

const timer = setTimeout(() => {
  console.error(`ERROR: Timed out after ${timeoutMs}ms. Is the Chrome extension connected?`)
  server.kill()
  process.exit(1)
}, timeoutMs)

server.on('close', (code: number | null) => {
  clearTimeout(timer)
  if (code !== 0 && code !== null) {
    process.exit(code)
  }
})
