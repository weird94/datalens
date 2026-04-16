import { execSync } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { REGRESSION_ARTIFACT_FILE_NAMES } from './artifacts'

const PLAYWRIGHT_MCP_CLIENT_NAME = 'regression-pre-detect'
const PLAYWRIGHT_MCP_CLIENT_VERSION = '1.0.0'
const PLAYWRIGHT_MCP_CONFIG_PATH = path.join(os.homedir(), '.codex', 'config.toml')

const PLAYWRIGHT_MCP_SECTION_NAMES = {
  ROOT: 'mcp_servers.playwright-mcp',
  ENV: 'mcp_servers.playwright-mcp.env',
} as const

const PLAYWRIGHT_MCP_FIELD_NAMES = {
  ARGS: 'args',
  COMMAND: 'command',
} as const

const PLAYWRIGHT_MCP_TOOL_NAMES = {
  EVALUATE: 'browser_evaluate',
  NAVIGATE: 'browser_navigate',
  TAKE_SCREENSHOT: 'browser_take_screenshot',
  WAIT_FOR: 'browser_wait_for',
} as const

const PLAYWRIGHT_PRE_DETECT_WAIT_SECONDS = {
  INITIAL: 3,
  POST_SCROLL: 1,
} as const

const PLAYWRIGHT_CURRENT_URL_FUNCTION = '() => window.location.href'

const PLAYWRIGHT_SCREENSHOT_MARKDOWN_PATH_PATTERN = /\(([^)\n]+)\)/
const PLAYWRIGHT_RESULT_SECTION_PATTERN = /### Result\s*([\s\S]*?)(?:\n### |\s*$)/
const TOML_SECTION_HEADER_PATTERN = /^\[(.+)\]$/
const TOML_KEY_VALUE_PATTERN = /^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/
const TOML_DOUBLE_QUOTED_STRING_PATTERN = /^"(.*)"$/
const TOML_SINGLE_QUOTED_STRING_PATTERN = /^'(.*)'$/

const PLAYWRIGHT_PRE_DETECT_SCROLL_FUNCTION = `
async () => {
  const WINDOW_TARGET = '__window__'
  const delay = ms =>
    new Promise(resolve => {
      window.setTimeout(resolve, ms)
    })
  const getPageMetrics = () => {
    const docElement = document.documentElement
    const body = document.body
    const scrollingElement = document.scrollingElement || docElement || body
    return {
      scrollTop: window.scrollY,
      clientHeight: window.innerHeight,
      scrollHeight: Math.max(
        scrollingElement ? scrollingElement.scrollHeight : 0,
        docElement ? docElement.scrollHeight : 0,
        body ? body.scrollHeight : 0
      ),
    }
  }
  const getElementMetrics = element => ({
    scrollTop: element.scrollTop,
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
  })
  const scrollTarget = async (target, maxPasses) => {
    let stablePasses = 0
    let highestScrollHeight = 0
    for (let pass = 0; pass < maxPasses; pass += 1) {
      const beforeMetrics =
        target === WINDOW_TARGET ? getPageMetrics() : getElementMetrics(target)
      highestScrollHeight = Math.max(highestScrollHeight, beforeMetrics.scrollHeight)
      const nextTop = Math.max(0, beforeMetrics.scrollHeight - beforeMetrics.clientHeight)
      if (target === WINDOW_TARGET) {
        window.scrollTo(0, nextTop)
      } else {
        target.scrollTop = nextTop
      }
      await delay(700)
      const afterMetrics =
        target === WINDOW_TARGET ? getPageMetrics() : getElementMetrics(target)
      const reachedBottom =
        afterMetrics.scrollTop + afterMetrics.clientHeight >= afterMetrics.scrollHeight - 8
      const heightStable = afterMetrics.scrollHeight <= highestScrollHeight + 8
      highestScrollHeight = Math.max(highestScrollHeight, afterMetrics.scrollHeight)
      stablePasses = reachedBottom && heightStable ? stablePasses + 1 : 0
      if (stablePasses >= 2) {
        break
      }
    }
  }
  const scrollableElements = Array.from(document.querySelectorAll('*'))
    .filter(element => {
      const style = window.getComputedStyle(element)
      const allowsVerticalScroll = /(auto|scroll|overlay)/.test(style.overflowY)
      if (!allowsVerticalScroll) {
        return false
      }
      if (element.scrollHeight <= element.clientHeight + 240) {
        return false
      }
      const rect = element.getBoundingClientRect()
      return rect.width >= 120 && rect.height >= 120
    })
    .sort((left, right) => {
      const leftOverflow = left.scrollHeight - left.clientHeight
      const rightOverflow = right.scrollHeight - right.clientHeight
      return rightOverflow - leftOverflow
    })
    .slice(0, 3)

  await scrollTarget(WINDOW_TARGET, 18)
  for (const element of scrollableElements) {
    await scrollTarget(element, 6)
  }
  await scrollTarget(WINDOW_TARGET, 12)

  return {
    url: window.location.href,
    pageScrollHeight: getPageMetrics().scrollHeight,
    scrollableContainerCount: scrollableElements.length,
  }
}
`

type PlaywrightMcpToolName =
  (typeof PLAYWRIGHT_MCP_TOOL_NAMES)[keyof typeof PLAYWRIGHT_MCP_TOOL_NAMES]

interface PlaywrightMcpTextContent {
  type: string
  text?: string
}

interface PlaywrightMcpToolCallResult {
  content?: PlaywrightMcpTextContent[]
}

interface PlaywrightMcpConfig {
  command: string
  args: string[]
  env: Record<string, string>
}

function buildPlaywrightTransportEnv(
  envOverrides: Record<string, string>
): Record<string, string> {
  const mergedEnv: Record<string, string> = {}

  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string') {
      mergedEnv[key] = value
    }
  }

  return {
    ...mergedEnv,
    ...envOverrides,
  }
}

export interface RegressionPreDetectArtifact {
  screenshotPath: string
  resolvedUrl?: string
}

export interface RegressionPreDetectService {
  prepareArtifacts(input: {
    url: string
    caseDirPath: string
  }): Promise<RegressionPreDetectArtifact | null>
}

function unescapeTomlDoubleQuotedString(value: string): string {
  return value
    .replace(/\\\\/g, '\\')
    .replace(/\\"/g, '"')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
}

function parseTomlString(rawValue: string, label: string): string {
  const trimmedValue = rawValue.trim()
  const doubleQuotedMatch = trimmedValue.match(TOML_DOUBLE_QUOTED_STRING_PATTERN)
  if (doubleQuotedMatch) {
    return unescapeTomlDoubleQuotedString(doubleQuotedMatch[1])
  }

  const singleQuotedMatch = trimmedValue.match(TOML_SINGLE_QUOTED_STRING_PATTERN)
  if (singleQuotedMatch) {
    return singleQuotedMatch[1]
  }

  throw new Error(`Invalid ${label}: expected TOML string`)
}

function parseTomlStringArray(rawValue: string, label: string): string[] {
  const trimmedValue = rawValue.trim()
  if (!trimmedValue.startsWith('[') || !trimmedValue.endsWith(']')) {
    throw new Error(`Invalid ${label}: expected TOML array`)
  }

  const innerValue = trimmedValue.slice(1, -1)
  const items: string[] = []
  let index = 0

  while (index < innerValue.length) {
    while (index < innerValue.length && /[\s,]/.test(innerValue[index] || '')) {
      index += 1
    }

    if (index >= innerValue.length) {
      break
    }

    const quote = innerValue[index]
    if (quote !== '"' && quote !== '\'') {
      throw new Error(`Invalid ${label}: only string array items are supported`)
    }

    index += 1
    let itemValue = ''
    let escaped = false
    let itemClosed = false

    while (index < innerValue.length) {
      const character = innerValue[index]
      index += 1

      if (quote === '"' && escaped) {
        itemValue += `\\${character}`
        escaped = false
        continue
      }

      if (quote === '"' && character === '\\') {
        escaped = true
        continue
      }

      if (character === quote) {
        items.push(
          quote === '"' ? unescapeTomlDoubleQuotedString(itemValue) : itemValue
        )
        itemClosed = true
        break
      }

      itemValue += character
    }

    if (quote === '"' && escaped) {
      throw new Error(`Invalid ${label}: unterminated escape sequence`)
    }

    if (!itemClosed) {
      throw new Error(`Invalid ${label}: unterminated string item`)
    }
  }

  return items
}

function parseCurrentSection(line: string): string | null {
  const matched = line.match(TOML_SECTION_HEADER_PATTERN)
  return matched ? matched[1].trim() : null
}

function parseTomlKeyValue(line: string): { key: string; value: string } | null {
  const matched = line.match(TOML_KEY_VALUE_PATTERN)
  if (!matched) {
    return null
  }

  return {
    key: matched[1].trim(),
    value: matched[2].trim(),
  }
}

function isArrayValueComplete(value: string): boolean {
  return value.trim().endsWith(']')
}

function readMultilineValue(lines: string[], startIndex: number, firstValue: string): {
  lineIndex: number
  value: string
} {
  let lineIndex = startIndex
  let value = firstValue

  while (!isArrayValueComplete(value) && lineIndex + 1 < lines.length) {
    lineIndex += 1
    value = `${value} ${lines[lineIndex]?.trim() || ''}`.trim()
  }

  return {
    lineIndex,
    value,
  }
}

export function parsePlaywrightMcpConfigText(configText: string): PlaywrightMcpConfig {
  const lines = configText.split(/\r?\n/)
  let currentSection: string | null = null
  let command: string | null = null
  let args: string[] | null = null
  const env: Record<string, string> = {}

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const trimmedLine = lines[lineIndex]?.trim() || ''
    if (trimmedLine.length === 0 || trimmedLine.startsWith('#')) {
      continue
    }

    const nextSection = parseCurrentSection(trimmedLine)
    if (nextSection) {
      currentSection = nextSection
      continue
    }

    const keyValue = parseTomlKeyValue(trimmedLine)
    if (!keyValue || !currentSection) {
      continue
    }

    if (
      currentSection === PLAYWRIGHT_MCP_SECTION_NAMES.ROOT &&
      keyValue.key === PLAYWRIGHT_MCP_FIELD_NAMES.COMMAND
    ) {
      command = parseTomlString(keyValue.value, PLAYWRIGHT_MCP_FIELD_NAMES.COMMAND)
      continue
    }

    if (
      currentSection === PLAYWRIGHT_MCP_SECTION_NAMES.ROOT &&
      keyValue.key === PLAYWRIGHT_MCP_FIELD_NAMES.ARGS
    ) {
      const multilineValue = readMultilineValue(lines, lineIndex, keyValue.value)
      lineIndex = multilineValue.lineIndex
      args = parseTomlStringArray(multilineValue.value, PLAYWRIGHT_MCP_FIELD_NAMES.ARGS)
      continue
    }

    if (currentSection === PLAYWRIGHT_MCP_SECTION_NAMES.ENV) {
      env[keyValue.key] = parseTomlString(keyValue.value, `env.${keyValue.key}`)
    }
  }

  if (!command) {
    throw new Error('Missing playwright-mcp command in ~/.codex/config.toml')
  }

  if (!args) {
    throw new Error('Missing playwright-mcp args in ~/.codex/config.toml')
  }

  return {
    command,
    args,
    env,
  }
}

function extractToolText(result: PlaywrightMcpToolCallResult): string {
  const textItem = result.content?.find(item => {
    return item.type === 'text' && typeof item.text === 'string'
  })

  if (!textItem || typeof textItem.text !== 'string') {
    throw new Error('Unexpected playwright-mcp tool result payload')
  }

  return textItem.text
}

export function extractPlaywrightResultText(text: string): string {
  const trimmedText = text.trim()
  const matchedSection = trimmedText.match(PLAYWRIGHT_RESULT_SECTION_PATTERN)
  return matchedSection ? matchedSection[1].trim() : trimmedText
}

function readJsonEncodedString(text: string, label: string): string {
  const trimmedText = extractPlaywrightResultText(text)
  if (
    trimmedText.length >= 2 &&
    trimmedText.startsWith('"') &&
    trimmedText.endsWith('"')
  ) {
    return unescapeTomlDoubleQuotedString(trimmedText.slice(1, -1))
  }

  if (trimmedText.length === 0) {
    throw new Error(`Invalid ${label}: expected non-empty string`)
  }

  return trimmedText
}

function readScreenshotMarkdownPath(text: string): string {
  const trimmedText = extractPlaywrightResultText(text)
  const matchedPath = trimmedText.match(PLAYWRIGHT_SCREENSHOT_MARKDOWN_PATH_PATTERN)
  if (matchedPath) {
    return matchedPath[1]
  }

  if (trimmedText.length === 0) {
    throw new Error('Invalid playwright screenshot result: missing file path')
  }

  return trimmedText
}

export function resolvePlaywrightScreenshotSourcePath(sourcePath: string): string {
  const trimmedPath = sourcePath.trim()
  if (trimmedPath.length === 0) {
    throw new Error('Invalid playwright screenshot path: empty path')
  }

  return path.normalize(
    path.isAbsolute(trimmedPath) ? trimmedPath : path.resolve(path.sep, trimmedPath)
  )
}

class PlaywrightMcpClient {
  private readonly transport: StdioClientTransport

  private readonly client = new Client({
    name: PLAYWRIGHT_MCP_CLIENT_NAME,
    version: PLAYWRIGHT_MCP_CLIENT_VERSION,
  })

  private readonly transportPid: number | undefined

  constructor(config: PlaywrightMcpConfig) {
    this.transport = new StdioClientTransport({
      command: config.command,
      args: config.args,
      env: buildPlaywrightTransportEnv(config.env),
      cwd: process.cwd(),
      stderr: 'pipe',
    })
    this.transportPid = this.transport.pid ?? undefined
  }

  async connect(): Promise<void> {
    if (this.transport.stderr) {
      this.transport.stderr.on('data', chunk => {
        process.stderr.write(chunk)
      })
    }

    await this.client.connect(this.transport)
  }

  async callToolText(toolName: PlaywrightMcpToolName, args: Record<string, string | number | boolean>): Promise<string> {
    const result = (await this.client.callTool({
      name: toolName,
      arguments: args,
    })) as PlaywrightMcpToolCallResult

    return extractToolText(result)
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

export class PlaywrightRegressionPreDetectService implements RegressionPreDetectService {
  async prepareArtifacts(input: {
    url: string
    caseDirPath: string
  }): Promise<RegressionPreDetectArtifact> {
    const configText = await fs.readFile(PLAYWRIGHT_MCP_CONFIG_PATH, 'utf8')
    const config = parsePlaywrightMcpConfigText(configText)
    const client = new PlaywrightMcpClient(config)
    const screenshotPath = path.join(
      input.caseDirPath,
      REGRESSION_ARTIFACT_FILE_NAMES.PRE_DETECT_SCREENSHOT_PNG
    )

    await client.connect()

    try {
      await client.callToolText(PLAYWRIGHT_MCP_TOOL_NAMES.NAVIGATE, {
        url: input.url,
      })
      await client.callToolText(PLAYWRIGHT_MCP_TOOL_NAMES.WAIT_FOR, {
        time: PLAYWRIGHT_PRE_DETECT_WAIT_SECONDS.INITIAL,
      })
      await client.callToolText(PLAYWRIGHT_MCP_TOOL_NAMES.EVALUATE, {
        function: PLAYWRIGHT_PRE_DETECT_SCROLL_FUNCTION,
      })
      await client.callToolText(PLAYWRIGHT_MCP_TOOL_NAMES.WAIT_FOR, {
        time: PLAYWRIGHT_PRE_DETECT_WAIT_SECONDS.POST_SCROLL,
      })
      const resolvedUrlText = await client.callToolText(PLAYWRIGHT_MCP_TOOL_NAMES.EVALUATE, {
        function: PLAYWRIGHT_CURRENT_URL_FUNCTION,
      })
      const screenshotResultText = await client.callToolText(
        PLAYWRIGHT_MCP_TOOL_NAMES.TAKE_SCREENSHOT,
        {
          type: 'png',
          fullPage: true,
        }
      )
      const screenshotSourcePath = resolvePlaywrightScreenshotSourcePath(
        readScreenshotMarkdownPath(screenshotResultText)
      )
      await fs.copyFile(screenshotSourcePath, screenshotPath)

      return {
        screenshotPath,
        resolvedUrl: readJsonEncodedString(resolvedUrlText, 'playwright resolved url'),
      }
    } finally {
      await client.close()
    }
  }
}
