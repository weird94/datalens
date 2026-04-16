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
  type RegressionExportToFileResult,
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
} as const

const REGRESSION_TAB_OPEN_MODE_VALUES = {
  CREATE_NEW: 'create_new',
  REUSE_OR_CREATE: 'reuse_or_create',
} as const

const REGRESSION_INITIAL_PAGE_SETTLE_MS = 30_000

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

function readStatusResult(value: RegressionJsonValue): RegressionScrapeStatusResult {
  const objectValue = readObject(value, 'scrape status response')
  const job = readObject(objectValue.job, 'scrape status job')
  return {
    job: {
      ...job,
      jobId: readString(job.jobId, 'scrape status jobId'),
      state: readString(job.state, 'scrape status state'),
      ...(job.error ? { error: readObject(job.error, 'scrape status error') } : {}),
    },
  }
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
  const objectValue = readObject(value, 'detect tables response')
  const tablesValue = objectValue.tables
  if (!Array.isArray(tablesValue)) {
    throw new Error('Invalid detect tables response: tables must be an array')
  }

  return {
    tables: tablesValue.map(item => {
      const table = readObject(item, 'detected table')
      const itemRows = table.itemRows
      if (!Array.isArray(itemRows)) {
        throw new Error('Invalid detect tables response: itemRows must be an array')
      }

      return {
        index: readNumber(table.index, 'detected table index'),
        ...(readOptionalString(table.name) ? { name: readOptionalString(table.name) } : {}),
        itemSelector: readString(table.itemSelector, 'detected table itemSelector'),
        itemCount: readNumber(table.itemCount, 'detected table itemCount'),
        ...(readOptionalString(table.rootSelector)
          ? { rootSelector: readOptionalString(table.rootSelector) }
          : {}),
        ...(readOptionalString(table.documentInfoPath)
          ? { documentInfoPath: readOptionalString(table.documentInfoPath) }
          : {}),
        itemRows: itemRows.map(row => readString(row, 'detected table row')),
      }
    }),
    tabId: readNumber(objectValue.tabId, 'detect tables tabId'),
    url: readString(objectValue.url, 'detect tables url'),
    title: readString(objectValue.title, 'detect tables title'),
    selectedTableIndex: readNumber(
      objectValue.selectedTableIndex,
      'detect tables selectedTableIndex'
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

function readExportResult(value: RegressionJsonValue): RegressionExportToFileResult {
  const objectValue = readObject(value, 'export result')
  return {
    ...objectValue,
    filePath: readString(objectValue.filePath, 'export filePath'),
  }
}

function isTerminalJobState(state: string): boolean {
  return (
    state === REGRESSION_JOB_STATES.COMPLETED ||
    state === REGRESSION_JOB_STATES.ERROR ||
    state === REGRESSION_JOB_STATES.CANCELED
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
  let exportedLogPath: string | undefined
  let preDetectArtifact: RegressionPreDetectArtifact | null = null
  const sleep = input.dependencies?.sleep ?? waitForMs

  await ensureDirectory(caseDirPath)
  await input.client.callTool(REGRESSION_MCP_TOOL_NAMES.DEBUG_CLEAR_LOGS, {})

  try {
    if (input.preDetectService) {
      preDetectArtifact = await input.preDetectService.prepareArtifacts({
        url: input.testCase.url,
        caseDirPath,
      })
    }

    if (!preDetectArtifact) {
      const openTabResult = readBrowserOpenTabResult(
        await input.client.callTool(REGRESSION_MCP_TOOL_NAMES.BROWSER_OPEN_TAB, {
          url: input.testCase.url,
          openMode: REGRESSION_TAB_OPEN_MODE_VALUES.CREATE_NEW,
        })
      )
      caseTabId = openTabResult.tab.id
      await sleep(REGRESSION_INITIAL_PAGE_SETTLE_MS)
    }

    const detectResult = readDetectTablesResult(
      await input.client.callTool(REGRESSION_MCP_TOOL_NAMES.SCRAPE_DETECT_TABLES, {
        ...(preDetectArtifact
          ? {
              url: preDetectArtifact.resolvedUrl || input.testCase.url,
              tabOpenMode: REGRESSION_TAB_OPEN_MODE_VALUES.REUSE_OR_CREATE,
            }
          : {
              tabId: caseTabId,
            }),
        ...(normalizedPrompt ? { prompt: normalizedPrompt } : {}),
      })
    )
    caseTabId = detectResult.tabId
    await writeJsonFile(
      path.join(caseDirPath, REGRESSION_ARTIFACT_FILE_NAMES.DETECT_TABLES_JSON),
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
      throw new Error('detectTables did not return a valid selected table')
    }

    await writeJsonFile(
      path.join(caseDirPath, REGRESSION_ARTIFACT_FILE_NAMES.SELECTED_TABLE_JSON),
      selectedTable
    )

    const treeResult = await input.client.callTool(REGRESSION_MCP_TOOL_NAMES.SCRAPE_GET_TABLE_TREE, {
      tabId: detectResult.tabId,
      rootSelector: selectedTable.rootSelector,
      itemSelector: selectedTable.itemSelector,
      documentInfoPath: selectedTable.documentInfoPath,
    })
    await writeJsonFile(
      path.join(caseDirPath, REGRESSION_ARTIFACT_FILE_NAMES.DOM_TREE_JSON),
      treeResult
    )

    const analyzedColumns = readAnalyzeColumnsResult(
      await input.client.callTool(REGRESSION_MCP_TOOL_NAMES.SCRAPE_ANALYZE_COLUMNS, {
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
      await input.client.callTool(REGRESSION_MCP_TOOL_NAMES.SCRAPE_START, {
        jobDraft: analyzedColumns.jobDraft,
        maxRecords: input.maxRecords,
      })
    )
    jobId = startResult.job.jobId
    jobState = startResult.job.state

    const deadline = Date.now() + input.timeoutMs
    while (Date.now() <= deadline) {
      lastStatus = readStatusResult(
        await input.client.callTool(REGRESSION_MCP_TOOL_NAMES.SCRAPE_STATUS, {
          jobId,
          waitMs: input.waitMs,
        })
      )
      jobState = lastStatus.job.state

      if (isTerminalJobState(jobState)) {
        break
      }
    }

    if (!lastStatus || !jobState) {
      throw new Error('scrape_status did not return a job state')
    }

    if (!isTerminalJobState(jobState)) {
      runnerState = REGRESSION_RUNNER_STATES.FAILED_RUNTIME
      errorMessage = `Scrape job timed out in state ${jobState}`
      await input.client.callTool(REGRESSION_MCP_TOOL_NAMES.SCRAPE_STOP, { jobId })
    } else if (jobState !== REGRESSION_JOB_STATES.COMPLETED) {
      runnerState = REGRESSION_RUNNER_STATES.FAILED_RUNTIME
      errorMessage = readOptionalString(lastStatus.job.error?.message) || `Scrape ended in ${jobState}`
    }

    try {
      const exportResult = readExportResult(
        await input.client.callTool(REGRESSION_MCP_TOOL_NAMES.SCRAPE_EXPORT_TO_FILE, {
          jobId,
          outputDir: caseDirPath,
          fileName: REGRESSION_ARTIFACT_FILE_NAMES.DATA_JSON,
          format: 'json',
        })
      )
      exportedDataPath = exportResult.filePath
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
    } else {
      runnerState = REGRESSION_RUNNER_STATES.FAILED_DETECT
    }
  } finally {
    try {
      const logExportResult = readExportResult(
        await input.client.callTool(REGRESSION_MCP_TOOL_NAMES.DEBUG_EXPORT_LOGS_TO_FILE, {
          outputDir: caseDirPath,
          fileName: REGRESSION_ARTIFACT_FILE_NAMES.DEBUG_LOG,
          ...(jobId ? { jobId } : {}),
        })
      )
      exportedLogPath = logExportResult.filePath
    } catch (error) {
      if (runnerState === REGRESSION_RUNNER_STATES.COMPLETED) {
        runnerState = REGRESSION_RUNNER_STATES.FAILED_EXPORT
        errorMessage = error instanceof Error ? error.message : String(error)
      }
    }

    if (caseTabId !== undefined) {
      try {
        await input.client.callTool(REGRESSION_MCP_TOOL_NAMES.BROWSER_CLOSE_TAB, {
          tabId: caseTabId,
        })
      } catch (error) {
        if (runnerState === REGRESSION_RUNNER_STATES.COMPLETED) {
          runnerState = REGRESSION_RUNNER_STATES.FAILED_EXPORT
          errorMessage = error instanceof Error ? error.message : String(error)
        }
      }
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
    ...(exportedLogPath ? { logPath: exportedLogPath } : {}),
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
