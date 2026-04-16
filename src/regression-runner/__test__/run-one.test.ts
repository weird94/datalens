import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { REGRESSION_MCP_TOOL_NAMES, type RegressionMcpToolClient } from '../mcp-client'
import { runOneCase } from '../run-one'
import type { RegressionPreDetectArtifact, RegressionPreDetectService } from '../playwright-pre-detect'
import type { RegressionCaseRow, RegressionJsonObject, RegressionJsonValue } from '../types'

class MockRegressionMcpClient implements RegressionMcpToolClient {
  readonly calls: Array<{ toolName: string; args: RegressionJsonObject }> = []

  constructor(
    private readonly responses: Partial<
      Record<(typeof REGRESSION_MCP_TOOL_NAMES)[keyof typeof REGRESSION_MCP_TOOL_NAMES], RegressionJsonValue[]>
    >
  ) {}

  async connect(): Promise<void> {}

  async callTool(
    toolName: (typeof REGRESSION_MCP_TOOL_NAMES)[keyof typeof REGRESSION_MCP_TOOL_NAMES],
    args: RegressionJsonObject
  ): Promise<RegressionJsonValue> {
    this.calls.push({ toolName, args })
    const toolResponses = this.responses[toolName]
    if (!toolResponses || toolResponses.length === 0) {
      throw new Error(`Unexpected tool call: ${toolName}`)
    }

    const nextResponse = toolResponses.shift()
    if (nextResponse === undefined) {
      throw new Error(`Missing tool response: ${toolName}`)
    }

    return nextResponse
  }

  async close(): Promise<void> {}
}

class MockRegressionPreDetectService implements RegressionPreDetectService {
  readonly calls: Array<{ url: string; caseDirPath: string }> = []

  constructor(private readonly artifact: RegressionPreDetectArtifact | null) {}

  async prepareArtifacts(input: {
    url: string
    caseDirPath: string
  }): Promise<RegressionPreDetectArtifact | null> {
    this.calls.push(input)
    return this.artifact
  }
}

function createCase(): RegressionCaseRow {
  return {
    rowIndex: 2,
    environment: 'global',
    site: 'google',
    page: 'maps',
    category: 'local',
    url: 'https://example.com/maps',
    scrapePrompt: 'Extract rows.',
    level: 'P0(Major)',
  }
}

function createSuccessResponses(
  artifactDirPath: string
): Partial<
  Record<
    (typeof REGRESSION_MCP_TOOL_NAMES)[keyof typeof REGRESSION_MCP_TOOL_NAMES],
    RegressionJsonValue[]
  >
> {
  return {
    [REGRESSION_MCP_TOOL_NAMES.DEBUG_CLEAR_LOGS]: [{ clearedCount: 1 }],
    [REGRESSION_MCP_TOOL_NAMES.BROWSER_OPEN_TAB]: [
      {
        tab: {
          id: 77,
          windowId: 1,
          active: true,
          title: 'Maps',
          url: 'https://example.com/maps',
        },
      },
    ],
    [REGRESSION_MCP_TOOL_NAMES.SCRAPE_DETECT_TABLES]: [
      {
        tables: [
          {
            index: 0,
            name: 'Places',
            itemSelector: 'div.card',
            itemCount: 3,
            rootSelector: 'div.results',
            documentInfoPath: 'window.document',
            itemRows: ['item1', 'item2'],
          },
        ],
        tabId: 77,
        url: 'https://example.com/maps',
        title: 'Maps',
        selectedTableIndex: 0,
      },
    ],
    [REGRESSION_MCP_TOOL_NAMES.SCRAPE_GET_TABLE_TREE]: [
      {
        root: {
          name: 'tree',
        },
      },
    ],
    [REGRESSION_MCP_TOOL_NAMES.SCRAPE_ANALYZE_COLUMNS]: [
      {
        jobId: 'job-prepare-1',
        jobDraft: {
          scraperConfig: {
            pageInfo: {
              url: 'https://example.com/maps',
            },
          },
        },
      },
    ],
    [REGRESSION_MCP_TOOL_NAMES.SCRAPE_START]: [
      {
        job: {
          jobId: 'job-run-1',
          state: 'RUNNING',
        },
      },
    ],
    [REGRESSION_MCP_TOOL_NAMES.SCRAPE_STATUS]: [
      {
        job: {
          jobId: 'job-run-1',
          state: 'COMPLETED',
        },
      },
    ],
    [REGRESSION_MCP_TOOL_NAMES.SCRAPE_EXPORT_TO_FILE]: [
      {
        filePath: path.join(artifactDirPath, 'data.json'),
      },
    ],
    [REGRESSION_MCP_TOOL_NAMES.DEBUG_EXPORT_LOGS_TO_FILE]: [
      {
        filePath: path.join(artifactDirPath, 'debug.log'),
      },
    ],
    [REGRESSION_MCP_TOOL_NAMES.BROWSER_CLOSE_TAB]: [{ tabId: 77 }],
  }
}

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async dirPath => {
      await fs.rm(dirPath, { recursive: true, force: true })
    })
  )
})

describe('runOneCase', () => {
  it('closes the opened tab after a case-level detect failure', async () => {
    const outputRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'run-one-close-tab-'))
    tempDirs.push(outputRoot)
    const sleep = vi.fn(async (_delayMs: number) => {})
    const client = new MockRegressionMcpClient({
      [REGRESSION_MCP_TOOL_NAMES.DEBUG_CLEAR_LOGS]: [{ clearedCount: 1 }],
      [REGRESSION_MCP_TOOL_NAMES.BROWSER_OPEN_TAB]: [
        {
          tab: {
            id: 77,
            windowId: 1,
            active: true,
            title: 'Maps',
            url: 'https://example.com/maps',
          },
        },
      ],
      [REGRESSION_MCP_TOOL_NAMES.SCRAPE_DETECT_TABLES]: [
        {
          tables: [
            {
              index: 0,
              name: 'Navigation',
              itemSelector: 'button.nav',
              itemCount: 3,
              rootSelector: 'div.nav',
              documentInfoPath: 'window.document',
              itemRows: ['item1'],
            },
          ],
          tabId: 77,
          url: 'https://example.com/maps',
          title: 'Maps',
          selectedTableIndex: -1,
        },
      ],
      [REGRESSION_MCP_TOOL_NAMES.DEBUG_EXPORT_LOGS_TO_FILE]: [
        {
          filePath: path.join(outputRoot, '20260327', '001-google-maps', 'debug.log'),
        },
      ],
      [REGRESSION_MCP_TOOL_NAMES.BROWSER_CLOSE_TAB]: [{ tabId: 77 }],
    })

    const result = await runOneCase({
      client,
      testCase: createCase(),
      outputRoot,
      dateKey: '20260327',
      maxRecords: 100,
      timeoutMs: 60_000,
      waitMs: 1_000,
      dependencies: {
        sleep,
      },
    })

    expect(result.manifestEntry.runnerState).toBe('FAILED_DETECT')
    expect(result.manifestEntry.errorMessage).toBe('detectTables did not return a valid selected table')
    expect(sleep).toHaveBeenCalledWith(30_000)
    expect(client.calls.map(call => call.toolName)).toEqual([
      REGRESSION_MCP_TOOL_NAMES.DEBUG_CLEAR_LOGS,
      REGRESSION_MCP_TOOL_NAMES.BROWSER_OPEN_TAB,
      REGRESSION_MCP_TOOL_NAMES.SCRAPE_DETECT_TABLES,
      REGRESSION_MCP_TOOL_NAMES.DEBUG_EXPORT_LOGS_TO_FILE,
      REGRESSION_MCP_TOOL_NAMES.BROWSER_CLOSE_TAB,
    ])
    expect(client.calls[1]?.args).toEqual({
      url: 'https://example.com/maps',
      openMode: 'create_new',
    })
    expect(client.calls[2]?.args).toEqual({
      tabId: 77,
      prompt: 'Extract rows.',
    })
    expect(client.calls[4]?.args).toEqual({ tabId: 77 })
  })

  it('omits blank scrape prompts from detect and analyze requests', async () => {
    const outputRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'run-one-blank-prompt-'))
    tempDirs.push(outputRoot)
    const sleep = vi.fn(async (_delayMs: number) => {})
    const client = new MockRegressionMcpClient(
      createSuccessResponses(path.join(outputRoot, '20260327', '001-google-maps'))
    )

    const result = await runOneCase({
      client,
      testCase: {
        ...createCase(),
        scrapePrompt: '',
      },
      outputRoot,
      dateKey: '20260327',
      maxRecords: 100,
      timeoutMs: 60_000,
      waitMs: 1_000,
      dependencies: {
        sleep,
      },
    })

    expect(result.manifestEntry.runnerState).toBe('COMPLETED')

    const detectCall = client.calls.find(
      call => call.toolName === REGRESSION_MCP_TOOL_NAMES.SCRAPE_DETECT_TABLES
    )
    const analyzeCall = client.calls.find(
      call => call.toolName === REGRESSION_MCP_TOOL_NAMES.SCRAPE_ANALYZE_COLUMNS
    )

    expect(detectCall?.args).toEqual({
      tabId: 77,
    })
    expect(analyzeCall?.args).toEqual({
      tabId: 77,
      rootSelector: 'div.results',
      itemSelector: 'div.card',
      documentInfoPath: 'window.document',
    })
  })

  it('passes an absolute artifact directory to export tools', async () => {
    const outputRootAbsolute = await fs.mkdtemp(path.join(os.tmpdir(), 'run-one-absolute-output-'))
    tempDirs.push(outputRootAbsolute)
    const outputRootRelative = path.relative(process.cwd(), outputRootAbsolute)
    const sleep = vi.fn(async (_delayMs: number) => {})
    const expectedArtifactDir = path.resolve(outputRootRelative, '20260327', '001-google-maps')
    const client = new MockRegressionMcpClient(createSuccessResponses(expectedArtifactDir))

    const result = await runOneCase({
      client,
      testCase: createCase(),
      outputRoot: outputRootRelative,
      dateKey: '20260327',
      maxRecords: 100,
      timeoutMs: 60_000,
      waitMs: 1_000,
      dependencies: {
        sleep,
      },
    })

    expect(result.manifestEntry.runnerState).toBe('COMPLETED')

    const exportCall = client.calls.find(
      call => call.toolName === REGRESSION_MCP_TOOL_NAMES.SCRAPE_EXPORT_TO_FILE
    )
    const debugExportCall = client.calls.find(
      call => call.toolName === REGRESSION_MCP_TOOL_NAMES.DEBUG_EXPORT_LOGS_TO_FILE
    )

    expect(exportCall?.args).toEqual({
      jobId: 'job-run-1',
      outputDir: expectedArtifactDir,
      fileName: 'data.json',
      format: 'json',
    })
    expect(debugExportCall?.args).toEqual({
      outputDir: expectedArtifactDir,
      fileName: 'debug.log',
      jobId: 'job-run-1',
    })
  })

  it('runs playwright pre-detect preparation before detectTables and records screenshot path', async () => {
    const outputRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'run-one-pre-detect-'))
    tempDirs.push(outputRoot)
    const sleep = vi.fn(async (_delayMs: number) => {})
    const caseDirPath = path.join(outputRoot, '20260327', '001-google-maps')
    const screenshotPath = path.join(caseDirPath, 'pre-detect.png')
    const client = new MockRegressionMcpClient(createSuccessResponses(caseDirPath))
    const preDetectService = new MockRegressionPreDetectService({
      screenshotPath,
    })

    const result = await runOneCase({
      client,
      testCase: createCase(),
      outputRoot,
      dateKey: '20260327',
      maxRecords: 100,
      timeoutMs: 60_000,
      waitMs: 1_000,
      preDetectService,
      dependencies: {
        sleep,
      },
    })

    expect(result.manifestEntry.runnerState).toBe('COMPLETED')
    expect(preDetectService.calls).toEqual([
      {
        url: 'https://example.com/maps',
        caseDirPath,
      },
    ])
    expect(client.calls.map(call => call.toolName)).not.toContain(
      REGRESSION_MCP_TOOL_NAMES.BROWSER_OPEN_TAB
    )

    const detectCall = client.calls.find(
      call => call.toolName === REGRESSION_MCP_TOOL_NAMES.SCRAPE_DETECT_TABLES
    )
    expect(detectCall?.args).toEqual({
      url: 'https://example.com/maps',
      tabOpenMode: 'reuse_or_create',
      prompt: 'Extract rows.',
    })
    expect(result.caseRecord.preDetectScreenshotPath).toBe(screenshotPath)
  })
})
