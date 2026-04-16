export interface RegressionCaseRow {
  rowIndex: number
  environment: string
  site: string
  page: string
  category: string
  url: string
  scrapePrompt: string
  level: string
}

export type RegressionJsonValue =
  | string
  | number
  | boolean
  | null
  | RegressionJsonObject
  | RegressionJsonValue[]

export interface RegressionJsonObject {
  [key: string]: RegressionJsonValue | undefined
}

export const REGRESSION_RUNNER_STATES = {
  COMPLETED: 'COMPLETED',
  FAILED_INPUT: 'FAILED_INPUT',
  FAILED_DETECT: 'FAILED_DETECT',
  FAILED_PREPARE: 'FAILED_PREPARE',
  FAILED_START: 'FAILED_START',
  FAILED_RUNTIME: 'FAILED_RUNTIME',
  FAILED_EXPORT: 'FAILED_EXPORT',
} as const

export type RegressionRunnerState =
  (typeof REGRESSION_RUNNER_STATES)[keyof typeof REGRESSION_RUNNER_STATES]

export interface RegressionManifestCaseEntry extends RegressionJsonObject {
  rowIndex: number
  caseDirName: string
  runnerState: RegressionRunnerState
  jobState?: string
  errorMessage?: string
  jobId?: string
}

export interface RegressionManifest extends RegressionJsonObject {
  startedAt: string
  finishedAt?: string
  csvPath: string
  outputRoot: string
  dateKey: string
  maxRecords: number
  caseLimit: number
  cases: RegressionManifestCaseEntry[]
}

export interface RegressionDetectTable extends RegressionJsonObject {
  index: number
  name?: string
  itemSelector: string
  itemCount: number
  rootSelector?: string
  documentInfoPath?: string
  itemRows: string[]
}

export interface RegressionDetectTablesResult extends RegressionJsonObject {
  tables: RegressionDetectTable[]
  tabId: number
  url: string
  title: string
  selectedTableIndex: number
  selectionConfidence?: number
  selectionReason?: string
}

export interface RegressionAnalyzeColumnsDraft extends RegressionJsonObject {
  scraperConfig: RegressionJsonObject
}

export interface RegressionAnalyzeColumnsResult extends RegressionJsonObject {
  jobId: string
  jobDraft: RegressionAnalyzeColumnsDraft
}

export interface RegressionScrapeStartJob extends RegressionJsonObject {
  jobId: string
  state: string
}

export interface RegressionScrapeStartResult extends RegressionJsonObject {
  job: RegressionScrapeStartJob
}

export interface RegressionScrapeStatusError extends RegressionJsonObject {
  message?: string
}

export interface RegressionScrapeStatusJob extends RegressionJsonObject {
  jobId: string
  state: string
  error?: RegressionScrapeStatusError
}

export interface RegressionScrapeStatusResult extends RegressionJsonObject {
  job: RegressionScrapeStatusJob
}

export interface RegressionExportToFileResult extends RegressionJsonObject {
  filePath: string
}

export interface RegressionCaseResult {
  manifestEntry: RegressionManifestCaseEntry
  caseDirPath: string
  caseRecord: RegressionJsonObject
}
