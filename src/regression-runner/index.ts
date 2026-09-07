import fs from 'node:fs/promises'
import path from 'node:path'
import { buildDateOutputDir, writeManifestFile } from './artifacts'
import {
  parseWebsiteCsv,
  REGRESSION_DEFAULT_BATCH_LIMIT,
  REGRESSION_PRIORITY_VALUES,
  selectBatchCases,
} from './cases'
import { RegressionMcpClient } from './mcp-client'
import { PlaywrightRegressionPreDetectService } from './playwright-pre-detect'
import { runBatch } from './run-batch'
import { runOneCase } from './run-one'
import type {
  RegressionCaseRow,
  RegressionJsonObject,
  RegressionManifest,
  RegressionManifestCaseEntry,
} from './types'
import type { RegressionPriorityValue } from './cases'

const REGRESSION_RUNNER_MODES = {
  BATCH: 'batch',
  ONE: 'one',
} as const

/**
 * 预检测（滚动+截图）走 playwright-mcp。它在部分机器上必超时，而首采验证并不需要它——
 * `runOneCase` 的 preDetectService 本来就是可选的。所以默认 none：不构造那个 service，
 * 直接把 URL 交给扩展自己开页检测。要跑带预检测的老流程用 `--pre-detect playwright`。
 */
const REGRESSION_PRE_DETECT_VALUES = {
  NONE: 'none',
  PLAYWRIGHT: 'playwright',
} as const

type RegressionPreDetectValue =
  (typeof REGRESSION_PRE_DETECT_VALUES)[keyof typeof REGRESSION_PRE_DETECT_VALUES]

const REGRESSION_DEFAULT_MAX_RECORDS = 100
const REGRESSION_DEFAULT_TIMEOUT_MS = 10 * 60_000
const REGRESSION_DEFAULT_WAIT_MS = 5_000

type RegressionRunnerMode =
  (typeof REGRESSION_RUNNER_MODES)[keyof typeof REGRESSION_RUNNER_MODES]

interface ParsedCliArgs {
  mode: RegressionRunnerMode
  csvPath: string
  outputRoot: string
  dateKey: string
  rowNumber?: number
  batchLimit: number
  maxRecords: number
  timeoutMs: number
  waitMs: number
  batchPriority: RegressionPriorityValue
  preDetect: RegressionPreDetectValue
}

function parsePositiveInteger(raw: string | undefined, label: string): number {
  const value = Number(raw)
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer`)
  }

  return value
}

function getFlagValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag)
  return index >= 0 ? args[index + 1] : undefined
}

function parseBatchPriority(raw: string | undefined): RegressionPriorityValue {
  if (raw === undefined || raw === REGRESSION_PRIORITY_VALUES.P0) {
    return REGRESSION_PRIORITY_VALUES.P0
  }

  if (raw === REGRESSION_PRIORITY_VALUES.P1) {
    return REGRESSION_PRIORITY_VALUES.P1
  }

  if (raw === REGRESSION_PRIORITY_VALUES.P2) {
    return REGRESSION_PRIORITY_VALUES.P2
  }

  throw new Error('--priority must be one of p0, p1, p2')
}

function parsePreDetect(raw: string | undefined): RegressionPreDetectValue {
  if (raw === undefined || raw === REGRESSION_PRE_DETECT_VALUES.NONE) {
    return REGRESSION_PRE_DETECT_VALUES.NONE
  }

  if (raw === REGRESSION_PRE_DETECT_VALUES.PLAYWRIGHT) {
    return REGRESSION_PRE_DETECT_VALUES.PLAYWRIGHT
  }

  throw new Error('--pre-detect must be one of none, playwright')
}

function getTodayDateKey(): string {
  return new Date().toISOString().slice(0, 10).replace(/-/g, '')
}

function deriveOutputRoot(csvPath: string): string {
  return path.join(path.dirname(csvPath), 'test-result')
}

function parseCliArgs(argv: string[]): ParsedCliArgs {
  const mode = argv[0]
  if (mode !== REGRESSION_RUNNER_MODES.ONE && mode !== REGRESSION_RUNNER_MODES.BATCH) {
    throw new Error('Mode must be "one" or "batch"')
  }

  const csvPath = getFlagValue(argv, '--csv')
  if (!csvPath) {
    throw new Error('--csv is required')
  }

  const outputRoot = getFlagValue(argv, '--output-root') || deriveOutputRoot(csvPath)
  const dateKey = getFlagValue(argv, '--date') || getTodayDateKey()
  const batchLimit = getFlagValue(argv, '--limit')
    ? parsePositiveInteger(getFlagValue(argv, '--limit'), '--limit')
    : REGRESSION_DEFAULT_BATCH_LIMIT
  const maxRecords = getFlagValue(argv, '--max-records')
    ? parsePositiveInteger(getFlagValue(argv, '--max-records'), '--max-records')
    : REGRESSION_DEFAULT_MAX_RECORDS
  const timeoutMs = getFlagValue(argv, '--timeout-ms')
    ? parsePositiveInteger(getFlagValue(argv, '--timeout-ms'), '--timeout-ms')
    : REGRESSION_DEFAULT_TIMEOUT_MS
  const waitMs = getFlagValue(argv, '--wait-ms')
    ? parsePositiveInteger(getFlagValue(argv, '--wait-ms'), '--wait-ms')
    : REGRESSION_DEFAULT_WAIT_MS
  const rowNumber = getFlagValue(argv, '--row')
    ? parsePositiveInteger(getFlagValue(argv, '--row'), '--row')
    : undefined
  const batchPriority = parseBatchPriority(getFlagValue(argv, '--priority'))
  const preDetect = parsePreDetect(getFlagValue(argv, '--pre-detect'))

  if (mode === REGRESSION_RUNNER_MODES.ONE && rowNumber === undefined) {
    throw new Error('--row is required in one mode')
  }

  return {
    mode,
    csvPath,
    outputRoot,
    dateKey,
    ...(rowNumber !== undefined ? { rowNumber } : {}),
    batchLimit,
    maxRecords,
    timeoutMs,
    waitMs,
    batchPriority,
    preDetect,
  }
}

async function loadCases(csvPath: string): Promise<RegressionCaseRow[]> {
  const csvText = await fs.readFile(csvPath, 'utf8')
  return parseWebsiteCsv(csvText).rows
}

function findCaseByNumber(rows: RegressionCaseRow[], rowNumber: number): RegressionCaseRow {
  const matched = rows.find(row => row.rowIndex - 1 === rowNumber)
  if (!matched) {
    throw new Error(`No case found for row ${rowNumber}`)
  }

  return matched
}

/**
 * 「实收 / 请求」的汇总。分页控件挑错时不会报错，只会让这个比值塌掉，
 * 所以批量跑完先看这里：lowYieldCases 就是下一轮该查的案子。
 */
const LOW_YIELD_RATIO_THRESHOLD = 0.5

function summarizeYield(entries: RegressionManifestCaseEntry[]): RegressionJsonObject {
  const measured = entries.filter(
    (entry): entry is RegressionManifestCaseEntry & { yieldRatio: number } =>
      typeof entry.yieldRatio === 'number'
  )

  if (measured.length === 0) {
    return { measuredCases: 0 }
  }

  const totalRatio = measured.reduce((sum, entry) => sum + entry.yieldRatio, 0)
  const lowYieldCases = measured
    .filter(entry => entry.yieldRatio < LOW_YIELD_RATIO_THRESHOLD)
    .map(entry => ({
      rowIndex: entry.rowIndex,
      caseDirName: entry.caseDirName,
      yieldRatio: entry.yieldRatio,
      ...(typeof entry.collectedRows === 'number' ? { collectedRows: entry.collectedRows } : {}),
      ...(typeof entry.requestedMaxRecords === 'number'
        ? { requestedMaxRecords: entry.requestedMaxRecords }
        : {}),
    }))

  return {
    measuredCases: measured.length,
    averageYieldRatio: Number((totalRatio / measured.length).toFixed(3)),
    lowYieldThreshold: LOW_YIELD_RATIO_THRESHOLD,
    lowYieldCases,
  }
}

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2))
  const rows = await loadCases(args.csvPath)
  const outputDateDir = buildDateOutputDir(args.outputRoot, args.dateKey)
  const preDetectService =
    args.preDetect === REGRESSION_PRE_DETECT_VALUES.PLAYWRIGHT
      ? new PlaywrightRegressionPreDetectService()
      : undefined

  async function runCaseWithFreshClient(testCase: RegressionCaseRow) {
    const client = new RegressionMcpClient()
    await client.connect()

    try {
      return await runOneCase({
        client,
        testCase,
        outputRoot: args.outputRoot,
        dateKey: args.dateKey,
        maxRecords: args.maxRecords,
        timeoutMs: args.timeoutMs,
        waitMs: args.waitMs,
        ...(preDetectService ? { preDetectService } : {}),
      })
    } finally {
      await client.close()
    }
  }

  if (args.mode === REGRESSION_RUNNER_MODES.ONE) {
    const testCase = findCaseByNumber(rows, args.rowNumber || 1)
    const result = await runCaseWithFreshClient(testCase)
    console.log(
      JSON.stringify(
        {
          mode: args.mode,
          outputDateDir,
          result: result.manifestEntry,
        },
        null,
        2
      )
    )
    return
  }

  const selectedCases = selectBatchCases(rows, {
    limit: args.batchLimit,
    priorities: [args.batchPriority],
  })
  const manifest: RegressionManifest = {
    startedAt: new Date().toISOString(),
    csvPath: args.csvPath,
    outputRoot: args.outputRoot,
    dateKey: args.dateKey,
    maxRecords: args.maxRecords,
    caseLimit: args.batchLimit,
    cases: [],
  }

  await writeManifestFile(args.outputRoot, args.dateKey, manifest)

  const entries = await runBatch({
    cases: selectedCases,
    runOneCase: async testCase => {
      const result = await runCaseWithFreshClient(testCase)
      return result.manifestEntry
    },
    persistManifest: async entriesToPersist => {
      await writeManifestFile(args.outputRoot, args.dateKey, {
        ...manifest,
        cases: entriesToPersist,
      })
    },
  })

  await writeManifestFile(args.outputRoot, args.dateKey, {
    ...manifest,
    finishedAt: new Date().toISOString(),
    cases: entries,
  })

  console.log(
    JSON.stringify(
      {
        mode: args.mode,
        outputDateDir,
        yieldSummary: summarizeYield(entries),
        cases: entries,
      },
      null,
      2
    )
  )
}

void main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
