import path from 'node:path'
import {
  buildCaseDirName,
  buildCaseDirPath,
  ensureDirectory,
  REGRESSION_ARTIFACT_FILE_NAMES,
  writeJsonFile,
} from './artifacts'
import { REGRESSION_MCP_TOOL_NAMES, type RegressionMcpToolClient } from './mcp-client'
import type {
  RegressionPreDetectArtifact,
  RegressionPreDetectService,
} from './playwright-pre-detect'
import {
  REGRESSION_RUNNER_STATES,
  type RegressionAnalyzeColumnsResult,
  type RegressionCaseResult,
  type RegressionCaseRow,
  type RegressionDetectTablesResult,
  type RegressionJsonObject,
  type RegressionJsonValue,
  type RegressionRunnerState,
  type RegressionScrapeStartResult,
  type RegressionScrapeStatusResult,
} from './types'

const REGRESSION_JOB_STATES = {
  CANCELED: 'CANCELED',
  COMPLETED: 'COMPLETED',
  ERROR: 'ERROR',
  STOPPED: 'STOPPED',
} as const

const REGRESSION_TAB_OPEN_MODE_VALUES = {
  CREATE_NEW: 'create_new',
  REUSE_OR_CREATE: 'reuse_or_create',
} as const

const REGRESSION_INITIAL_PAGE_SETTLE_MS = 30_000
const REGRESSION_WORKSPACE_INSPECT_SAMPLE_LIMIT = 50

function readObject(value: RegressionJsonValue | undefined, label: string): RegressionJsonObject {
  if (!value || Array.isArray(value) || typeof value !== 'object') {
    throw new Error(`Invalid ${label}: expected object`)
  }

  return value
}

function readString(value: RegressionJsonValue | undefined, label: string): string {
  if (typeof value !== 'string') {
    throw new Error(`Invalid ${label}: expected string`)
  }

  return value
}

function readOptionalString(value: RegressionJsonValue | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function readNumber(value: RegressionJsonValue | undefined, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Invalid ${label}: expected number`)
  }

  return value
}

interface RegressionBrowserOpenTabResult {
  tab: {
    id: number
    active: boolean
    title: string
    url: string
    windowId: number
    favIconUrl?: string
  }
}

function readBrowserOpenTabResult(value: RegressionJsonValue): RegressionBrowserOpenTabResult {
  const objectValue = readObject(value, 'browser open tab response')
  const tab = readObject(objectValue.tab, 'browser open tab payload')

  return {
    tab: {
      id: readNumber(tab.id, 'browser open tab id'),
      active: Boolean(tab.active),
      title: readString(tab.title, 'browser open tab title'),
      url: readString(tab.url, 'browser open tab url'),
      windowId: readNumber(tab.windowId, 'browser open tab windowId'),
      ...(readOptionalString(tab.favIconUrl) ? { favIconUrl: readOptionalString(tab.favIconUrl) } : {}),
    },
  }
}

function readDetectTablesResult(value: RegressionJsonValue): RegressionDetectTablesResult {
  const objectValue = readObject(value, 'detect scrape targets response')
  const targetsValue = objectValue.targets
  if (!Array.isArray(targetsValue)) {
    throw new Error('Invalid detect scrape targets response: targets must be an array')
  }

  return {
    tables: targetsValue.map(item => {
      const target = readObject(item, 'detected scrape target')
      const itemRows = target.itemRows
      if (!Array.isArray(itemRows)) {
        throw new Error('Invalid detect scrape targets response: itemRows must be an array')
      }

      return {
        index: readNumber(target.index, 'detected scrape target index'),
        ...(readOptionalString(target.name) ? { name: readOptionalString(target.name) } : {}),
        itemSelector: readString(target.itemSelector, 'detected scrape target itemSelector'),
        itemCount: readNumber(target.itemCount, 'detected scrape target itemCount'),
        ...(readOptionalString(target.rootSelector)
          ? { rootSelector: readOptionalString(target.rootSelector) }
          : {}),
        ...(readOptionalString(target.documentInfoPath)
          ? { documentInfoPath: readOptionalString(target.documentInfoPath) }
          : {}),
        itemRows: itemRows.map(row => readString(row, 'detected scrape target row')),
      }
    }),
    tabId: readNumber(objectValue.tabId, 'detect scrape targets tabId'),
    url: readString(objectValue.url, 'detect scrape targets url'),
    title: readString(objectValue.title, 'detect scrape targets title'),
    selectedTableIndex: readNumber(
      objectValue.selectedTargetIndex,
      'detect scrape targets selectedTargetIndex'
    ),
    ...(typeof objectValue.selectionConfidence === 'number'
      ? { selectionConfidence: objectValue.selectionConfidence }
      : {}),
    ...(readOptionalString(objectValue.selectionReason)
      ? { selectionReason: readOptionalString(objectValue.selectionReason) }
      : {}),
  }
}

function readAnalyzeColumnsResult(value: RegressionJsonValue): RegressionAnalyzeColumnsResult {
  const objectValue = readObject(value, 'analyze columns response')
  const jobDraft = readObject(objectValue.jobDraft, 'analyze columns job draft')
  return {
    jobId: readString(objectValue.jobId, 'analyze columns jobId'),
    jobDraft: {
      ...jobDraft,
      scraperConfig: readObject(jobDraft.scraperConfig, 'analyze columns scraper config'),
    },
  }
}

function readStartResult(value: RegressionJsonValue): RegressionScrapeStartResult {
  const objectValue = readObject(value, 'scrape start response')
  const job = readObject(objectValue.job, 'scrape start job')
  return {
    job: {
      ...job,
      jobId: readString(job.jobId, 'scrape start jobId'),
      state: readString(job.state, 'scrape start state'),
    },
  }
}

function readFirstWorkspaceFileName(value: RegressionJsonValue): string | undefined {
  const objectValue = readObject(value, 'workspace assets response')
  const filesValue = objectValue.files
  if (!Array.isArray(filesValue)) {
    return undefined
  }

  for (const item of filesValue) {
    const file = readObject(item, 'workspace file')
    const fileName = readOptionalString(file.fileName)
    if (fileName) {
      return fileName
    }
  }

  return undefined
}

function isTerminalJobState(state: string): boolean {
  return (
    state === REGRESSION_JOB_STATES.COMPLETED ||
    state === REGRESSION_JOB_STATES.ERROR ||
    state === REGRESSION_JOB_STATES.CANCELED ||
    state === REGRESSION_JOB_STATES.STOPPED
  )
}

export interface RunOneCaseInput {
  client: RegressionMcpToolClient
  testCase: RegressionCaseRow
  outputRoot: string
  dateKey: string
  maxRecords: number
  timeoutMs: number
  waitMs: number
  preDetectService?: RegressionPreDetectService
  dependencies?: {
    sleep: (delayMs: number) => Promise<void>
  }
}

function waitForMs(delayMs: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, delayMs)
  })
}

export async function runOneCase(input: RunOneCaseInput): Promise<RegressionCaseResult> {
  const caseDirName = buildCaseDirName(input.testCase)
  const caseDirPath = path.resolve(buildCaseDirPath(input.outputRoot, input.dateKey, input.testCase))
  const normalizedPrompt = input.testCase.scrapePrompt.trim()
  let caseTabId: number | undefined
  let jobId: string | undefined
  let jobState: string | undefined
  let runnerState: RegressionRunnerState = REGRESSION_RUNNER_STATES.COMPLETED
  let errorMessage: string | undefined
  let lastStatus: RegressionScrapeStatusResult | null = null
  let exportedDataPath: string | undefined
  let preDetectArtifact: RegressionPreDetectArtifact | null = null
  const sleep = input.dependencies?.sleep ?? waitForMs

  await ensureDirectory(caseDirPath)

  try {
    if (input.preDetectService) {
      preDetectArtifact = await input.preDetectService.prepareArtifacts({
        url: input.testCase.url,
        caseDirPath,
      })
    }

    const openTabResult = readBrowserOpenTabResult(
      await input.client.callTool(REGRESSION_MCP_TOOL_NAMES.OPEN_AI_WORKSPACE_TAB, {
        url: preDetectArtifact?.resolvedUrl || input.testCase.url,
        openMode: preDetectArtifact
          ? REGRESSION_TAB_OPEN_MODE_VALUES.REUSE_OR_CREATE
          : REGRESSION_TAB_OPEN_MODE_VALUES.CREATE_NEW,
      })
    )
    caseTabId = openTabResult.tab.id
    await sleep(REGRESSION_INITIAL_PAGE_SETTLE_MS)

    const detectResult = readDetectTablesResult(
      await input.client.callTool(REGRESSION_MCP_TOOL_NAMES.DETECT_SCRAPE_TARGETS, {
        tabId: caseTabId,
        ...(normalizedPrompt ? { prompt: normalizedPrompt } : {}),
      })
    )
    caseTabId = detectResult.tabId
    await writeJsonFile(
      path.join(caseDirPath, REGRESSION_ARTIFACT_FILE_NAMES.DETECT_TARGETS_JSON),
      detectResult
    )

    const selectedTable = detectResult.tables.find(
      table => table.index === detectResult.selectedTableIndex
    )
    if (
      !selectedTable ||
      !selectedTable.rootSelector ||
      !selectedTable.documentInfoPath
    ) {
      throw new Error('detectScrapeTargets did not return a valid selected target')
    }

    await writeJsonFile(
      path.join(caseDirPath, REGRESSION_ARTIFACT_FILE_NAMES.SELECTED_TABLE_JSON),
      selectedTable
    )

    const treeResult = await input.client.callTool(REGRESSION_MCP_TOOL_NAMES.READ_PAGE_A11Y_TREE, {
      tabId: detectResult.tabId,
      scope: 'target',
      rootSelector: selectedTable.rootSelector,
      itemSelector: selectedTable.itemSelector,
      documentInfoPath: selectedTable.documentInfoPath,
    })
    await writeJsonFile(
      path.join(caseDirPath, REGRESSION_ARTIFACT_FILE_NAMES.DOM_TREE_JSON),
      treeResult
    )

    const analyzedColumns = readAnalyzeColumnsResult(
      await input.client.callTool(REGRESSION_MCP_TOOL_NAMES.ANALYZE_SCRAPE_CONFIG, {
        tabId: detectResult.tabId,
        ...(normalizedPrompt ? { prompt: normalizedPrompt } : {}),
        rootSelector: selectedTable.rootSelector,
        itemSelector: selectedTable.itemSelector,
        documentInfoPath: selectedTable.documentInfoPath,
      })
    )
    await writeJsonFile(
      path.join(caseDirPath, REGRESSION_ARTIFACT_FILE_NAMES.SCRAPER_CONFIG_JSON),
      readObject(analyzedColumns.jobDraft.scraperConfig, 'scraper config')
    )

    const startResult = readStartResult(
      await input.client.callTool(
        REGRESSION_MCP_TOOL_NAMES.START_SCRAPE,
        {
          jobId: analyzedColumns.jobId,
          maxRecords: input.maxRecords,
        },
        {
          timeoutMs: input.timeoutMs,
        }
      )
    )
    jobId = startResult.job.jobId
    jobState = startResult.job.state

    lastStatus = {
      job: startResult.job,
    }

    if (!isTerminalJobState(jobState)) {
      runnerState = REGRESSION_RUNNER_STATES.FAILED_RUNTIME
      errorMessage = `Scrape job timed out in state ${jobState}`
    } else if (jobState !== REGRESSION_JOB_STATES.COMPLETED) {
      runnerState = REGRESSION_RUNNER_STATES.FAILED_RUNTIME
      errorMessage = readOptionalString(lastStatus.job.error?.message) || `Scrape ended in ${jobState}`
    }

    try {
      const workspaceAssets = await input.client.callTool(
        REGRESSION_MCP_TOOL_NAMES.LIST_WORKSPACE_ASSETS,
        {}
      )
      const firstFileName = readFirstWorkspaceFileName(workspaceAssets)
      const inspectedAsset = firstFileName
        ? await input.client.callTool(REGRESSION_MCP_TOOL_NAMES.INSPECT_WORKSPACE_ASSET, {
            fileName: firstFileName,
            sampleLimit: REGRESSION_WORKSPACE_INSPECT_SAMPLE_LIMIT,
          })
        : undefined
      exportedDataPath = path.join(caseDirPath, REGRESSION_ARTIFACT_FILE_NAMES.DATA_JSON)
      await writeJsonFile(exportedDataPath, {
        job: startResult.job,
        workspaceAssets,
        ...(inspectedAsset ? { inspectedAsset } : {}),
      })
    } catch (error) {
      if (runnerState === REGRESSION_RUNNER_STATES.COMPLETED) {
        runnerState = REGRESSION_RUNNER_STATES.FAILED_EXPORT
        errorMessage = error instanceof Error ? error.message : String(error)
      }
    }
  } catch (error) {
    if (errorMessage === undefined) {
      errorMessage = error instanceof Error ? error.message : String(error)
    }

    if (jobId) {
      runnerState = REGRESSION_RUNNER_STATES.FAILED_RUNTIME
    } else if (errorMessage.toLowerCase().includes('timeout')) {
      runnerState = REGRESSION_RUNNER_STATES.FAILED_RUNTIME
    } else {
      runnerState = REGRESSION_RUNNER_STATES.FAILED_DETECT
    }
  }

  const caseRecord: RegressionJsonObject = {
    rowIndex: input.testCase.rowIndex,
    environment: input.testCase.environment,
    site: input.testCase.site,
    page: input.testCase.page,
    category: input.testCase.category,
    url: input.testCase.url,
    prompt: input.testCase.scrapePrompt,
    runnerState,
    ...(jobId ? { jobId } : {}),
    ...(jobState ? { jobState } : {}),
    ...(errorMessage ? { errorMessage } : {}),
    ...(exportedDataPath ? { dataPath: exportedDataPath } : {}),
    ...(preDetectArtifact?.screenshotPath
      ? { preDetectScreenshotPath: preDetectArtifact.screenshotPath }
      : {}),
    ...(preDetectArtifact?.resolvedUrl
      ? { preDetectResolvedUrl: preDetectArtifact.resolvedUrl }
      : {}),
    caseDirName,
  }

  await writeJsonFile(path.join(caseDirPath, REGRESSION_ARTIFACT_FILE_NAMES.CASE_JSON), caseRecord)

  return {
    manifestEntry: {
      rowIndex: input.testCase.rowIndex,
      caseDirName,
      runnerState,
      ...(jobState ? { jobState } : {}),
      ...(errorMessage ? { errorMessage } : {}),
      ...(jobId ? { jobId } : {}),
    },
    caseDirPath,
    caseRecord,
  }
}
