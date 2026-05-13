import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { REGRESSION_MCP_TOOL_NAMES, type RegressionMcpToolClient } from '../mcp-client'
import { runOneCase } from '../run-one'
import type { RegressionPreDetectArtifact, RegressionPreDetectService } from '../playwright-pre-detect'
import type { RegressionCaseRow, RegressionJsonObject, RegressionJsonValue } from '../types'

type MockRegressionResponse = RegressionJsonValue | Error

class MockRegressionMcpClient implements RegressionMcpToolClient {
  readonly calls: Array<{
    toolName: string
    args: RegressionJsonObject
    options?: { timeoutMs?: number }
  }> = []

  constructor(
    private readonly responses: Partial<
      Record<
        (typeof REGRESSION_MCP_TOOL_NAMES)[keyof typeof REGRESSION_MCP_TOOL_NAMES],
        MockRegressionResponse[]
      >
    >
  ) {}

  async connect(): Promise<void> {}

  async callTool(
    toolName: (typeof REGRESSION_MCP_TOOL_NAMES)[keyof typeof REGRESSION_MCP_TOOL_NAMES],
    args: RegressionJsonObject,
    options?: { timeoutMs?: number }
  ): Promise<RegressionJsonValue> {
    this.calls.push({ toolName, args, ...(options ? { options } : {}) })
    const toolResponses = this.responses[toolName]
    if (!toolResponses || toolResponses.length === 0) {
      throw new Error(`Unexpected tool call: ${toolName}`)
    }

    const nextResponse = toolResponses.shift()
    if (nextResponse === undefined) {
      throw new Error(`Missing tool response: ${toolName}`)
    }

    if (nextResponse instanceof Error) {
      throw nextResponse
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

function createSuccessResponses(): Partial<
  Record<
    (typeof REGRESSION_MCP_TOOL_NAMES)[keyof typeof REGRESSION_MCP_TOOL_NAMES],
    MockRegressionResponse[]
  >
> {
  return {
    [REGRESSION_MCP_TOOL_NAMES.OPEN_AI_WORKSPACE_TAB]: [
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
    [REGRESSION_MCP_TOOL_NAMES.DETECT_SCRAPE_TARGETS]: [
      {
        targets: [
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
        selectedTargetIndex: 0,
      },
    ],
    [REGRESSION_MCP_TOOL_NAMES.READ_PAGE_A11Y_TREE]: [
      {
        tree: 'document tree',
      },
    ],
    [REGRESSION_MCP_TOOL_NAMES.ANALYZE_SCRAPE_CONFIG]: [
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
    [REGRESSION_MCP_TOOL_NAMES.START_SCRAPE]: [
      {
        job: {
          jobId: 'job-run-1',
          state: 'COMPLETED',
        },
      },
    ],
    [REGRESSION_MCP_TOOL_NAMES.LIST_WORKSPACE_ASSETS]: [
      {
        files: [
          {
            fileName: 'rows.csv',
            status: 'uploaded',
          },
        ],
        scope: 'current_thread',
      },
    ],
    [REGRESSION_MCP_TOOL_NAMES.INSPECT_WORKSPACE_ASSET]: [
      {
        file: {
          fileName: 'rows.csv',
        },
        sample: [],
        schema: [],
      },
    ],
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
  it('reports a case-level detect failure after opening the AI workspace tab', async () => {
    const outputRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'run-one-detect-failure-'))
    tempDirs.push(outputRoot)
    const sleep = vi.fn(async (_delayMs: number) => {})
    const client = new MockRegressionMcpClient({
      [REGRESSION_MCP_TOOL_NAMES.OPEN_AI_WORKSPACE_TAB]: [
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
      [REGRESSION_MCP_TOOL_NAMES.DETECT_SCRAPE_TARGETS]: [
        {
          targets: [
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
          selectedTargetIndex: -1,
        },
      ],
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
    expect(result.manifestEntry.errorMessage).toBe(
      'detectScrapeTargets did not return a valid selected target'
    )
    expect(sleep).toHaveBeenCalledWith(30_000)
    expect(client.calls.map(call => call.toolName)).toEqual([
      REGRESSION_MCP_TOOL_NAMES.OPEN_AI_WORKSPACE_TAB,
      REGRESSION_MCP_TOOL_NAMES.DETECT_SCRAPE_TARGETS,
    ])
    expect(client.calls[0]?.args).toEqual({
      url: 'https://example.com/maps',
      openMode: 'create_new',
    })
    expect(client.calls[1]?.args).toEqual({
      tabId: 77,
      prompt: 'Extract rows.',
    })
  })

  it('omits blank scrape prompts from detect and analyze requests', async () => {
    const outputRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'run-one-blank-prompt-'))
    tempDirs.push(outputRoot)
    const sleep = vi.fn(async (_delayMs: number) => {})
    const client = new MockRegressionMcpClient(createSuccessResponses())

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
      call => call.toolName === REGRESSION_MCP_TOOL_NAMES.DETECT_SCRAPE_TARGETS
    )
    const analyzeCall = client.calls.find(
      call => call.toolName === REGRESSION_MCP_TOOL_NAMES.ANALYZE_SCRAPE_CONFIG
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

    const startCall = client.calls.find(
      call => call.toolName === REGRESSION_MCP_TOOL_NAMES.START_SCRAPE
    )
    expect(startCall?.options).toEqual({ timeoutMs: 60_000 })
  })

  it('writes workspace inspection artifacts to the absolute case directory', async () => {
    const outputRootAbsolute = await fs.mkdtemp(path.join(os.tmpdir(), 'run-one-absolute-output-'))
    tempDirs.push(outputRootAbsolute)
    const outputRootRelative = path.relative(process.cwd(), outputRootAbsolute)
    const sleep = vi.fn(async (_delayMs: number) => {})
    const expectedArtifactDir = path.resolve(outputRootRelative, '20260327', '001-google-maps')
    const client = new MockRegressionMcpClient(createSuccessResponses())

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
    expect(result.caseRecord.dataPath).toBe(path.join(expectedArtifactDir, 'data.json'))

    const dataArtifact = JSON.parse(
      await fs.readFile(path.join(expectedArtifactDir, 'data.json'), 'utf8')
    ) as RegressionJsonObject

    expect(dataArtifact).toMatchObject({
      job: {
        jobId: 'job-run-1',
        state: 'COMPLETED',
      },
      workspaceAssets: {
        scope: 'current_thread',
      },
      inspectedAsset: {
        file: {
          fileName: 'rows.csv',
        },
      },
    })
  })

  it('classifies startScrape request timeouts as runtime failures', async () => {
    const outputRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'run-one-start-timeout-'))
    tempDirs.push(outputRoot)
    const sleep = vi.fn(async (_delayMs: number) => {})
    const responses = createSuccessResponses()
    responses[REGRESSION_MCP_TOOL_NAMES.START_SCRAPE] = [new Error('MCP request timeout')]
    const client = new MockRegressionMcpClient(responses)

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

    expect(result.manifestEntry.runnerState).toBe('FAILED_RUNTIME')
    expect(result.manifestEntry.errorMessage).toBe('MCP request timeout')
  })

  it('runs playwright pre-detect preparation before detectScrapeTargets and records screenshot path', async () => {
    const outputRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'run-one-pre-detect-'))
    tempDirs.push(outputRoot)
    const sleep = vi.fn(async (_delayMs: number) => {})
    const caseDirPath = path.join(outputRoot, '20260327', '001-google-maps')
    const screenshotPath = path.join(caseDirPath, 'pre-detect.png')
    const client = new MockRegressionMcpClient(createSuccessResponses())
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
    expect(client.calls[0]?.toolName).toBe(REGRESSION_MCP_TOOL_NAMES.OPEN_AI_WORKSPACE_TAB)
    expect(client.calls[0]?.args).toEqual({
      url: 'https://example.com/maps',
      openMode: 'reuse_or_create',
    })

    const detectCall = client.calls.find(
      call => call.toolName === REGRESSION_MCP_TOOL_NAMES.DETECT_SCRAPE_TARGETS
    )
    expect(detectCall?.args).toEqual({
      tabId: 77,
      prompt: 'Extract rows.',
    })
    expect(result.caseRecord.preDetectScreenshotPath).toBe(screenshotPath)
  })
})
