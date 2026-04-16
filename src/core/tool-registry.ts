import { promises as fs } from 'node:fs'
import path from 'node:path'
import * as z from 'zod'
import { stringify } from 'yaml'
import type { BridgeCommandName, JsonObject } from '../bridge/protocol'

const JsonObjectSchema = z.record(z.string(), z.unknown())
const MCP_TAB_OPEN_MODE_OPTIONS = ['reuse_or_create', 'create_new'] as const

export interface SendCommandOptions {
  requestId?: string
  jobId?: string
  timeoutMs?: number
}

export interface ToolCallContext {
  requestId: string
  selectedTabId: number | null
  sendCommand: (
    name: BridgeCommandName,
    payload: JsonObject,
    options?: SendCommandOptions
  ) => Promise<JsonObject>
}

export interface ToolCommand {
  commandName: BridgeCommandName
  payload: JsonObject
  requestId: string
}

export interface ToolDefinition {
  name: string
  description: string
  inputShape: z.ZodRawShape
  parseArgs: (raw: unknown) => JsonObject
  buildCommand?: (args: JsonObject, context: ToolCallContext) => ToolCommand
  execute?: (
    args: JsonObject,
    context: ToolCallContext
  ) => Promise<ToolExecutionResult> | ToolExecutionResult
}

export const TOOL_EXECUTION_RESULT_KIND_TEXT = 'text'

export interface ToolTextResult {
  kind: typeof TOOL_EXECUTION_RESULT_KIND_TEXT
  text: string
}

export type ToolExecutionResult = JsonObject | ToolTextResult

type ToolRuntimeDefinition =
  | {
      buildCommand: (args: JsonObject, context: ToolCallContext) => ToolCommand
      execute?: never
    }
  | {
      buildCommand?: never
      execute: (
        args: JsonObject,
        context: ToolCallContext
      ) => Promise<ToolExecutionResult> | ToolExecutionResult
    }

export function createToolTextResult(text: string): ToolTextResult {
  return {
    kind: TOOL_EXECUTION_RESULT_KIND_TEXT,
    text,
  }
}

export function isToolTextResult(result: ToolExecutionResult): result is ToolTextResult {
  return (
    typeof result === 'object' &&
    result !== null &&
    'kind' in result &&
    'text' in result &&
    result.kind === TOOL_EXECUTION_RESULT_KIND_TEXT &&
    typeof result.text === 'string'
  )
}

function createTool(
  definition: {
    name: string
    description: string
    inputShape?: z.ZodRawShape
  } & ToolRuntimeDefinition
): ToolDefinition {
  const inputShape = definition.inputShape || {}
  const schema = z.object(inputShape)

  return {
    ...definition,
    inputShape,
    parseArgs(raw: unknown) {
      return schema.parse(raw) as JsonObject
    },
  }
}

function readOptionalNumber(args: JsonObject, key: string): number | undefined {
  const value = args[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function readRequiredNumber(args: JsonObject, key: string): number {
  const value = args[key]
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Missing required numeric argument: ${key}`)
  }

  return value
}

function readOptionalString(args: JsonObject, key: string): string | undefined {
  const value = args[key]
  return typeof value === 'string' ? value : undefined
}

function readRequiredString(args: JsonObject, key: string): string {
  const value = args[key]
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Missing required argument: ${key}`)
  }

  return value
}

function readOptionalObject(args: JsonObject, key: string): JsonObject | undefined {
  const value = args[key]

  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as JsonObject
  }

  return undefined
}

function resolveExportFormat(raw: string | undefined): 'json' | 'csv' | 'xlsx' {
  if (!raw) {
    return 'json'
  }

  if (raw === 'json' || raw === 'csv' || raw === 'xlsx') {
    return raw
  }

  throw new Error('format must be one of: json, csv, xlsx')
}

function normalizeFileName(input: {
  preferredFileName?: string
  fallbackFileName?: string
  extension: 'json' | 'csv' | 'xlsx' | 'log'
}): string {
  const raw = (input.preferredFileName || input.fallbackFileName || '').trim()
  const candidate = raw.length > 0 ? raw : `scrape_result_${Date.now()}.${input.extension}`
  const baseName = path.basename(candidate)
  const normalized =
    baseName === '.' || baseName === '..' ? `scrape_result_${Date.now()}` : baseName
  return path.extname(normalized).length > 0 ? normalized : `${normalized}.${input.extension}`
}

function inferMimeType(format: 'json' | 'csv' | 'xlsx'): string {
  if (format === 'json') {
    return 'application/json'
  }
  if (format === 'csv') {
    return 'text/csv'
  }
  return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
}

function waitForMs(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, ms)
  })
}

const DEBUG_LOG_LEVEL_OPTIONS = ['debug', 'info', 'warn', 'error'] as const
const DEBUG_LOG_SOURCE_OPTIONS = ['background', 'content', 'sidepanel'] as const
const DEBUG_LOG_EXPORT_DEFAULT_LIMIT = 5000
const DEBUG_LOG_EXPORT_MAX_LIMIT = 5000
const DEBUG_LOG_EXPORT_TIMEOUT_MS = 10 * 60_000
const DEBUG_LOG_EXPORT_DEFAULT_FILE_PREFIX = 'debug_logs'
const DEBUG_LOG_EXPORT_FORMAT_LOG = 'log'
const DEBUG_LOG_RESULT_EMPTY_ENTRIES_LABEL = '(no log entries)'
const DEBUG_LOG_QUERY_SUMMARY_RETURNED_KEY = 'returned'
const DEBUG_LOG_QUERY_SUMMARY_TOTAL_MATCHED_KEY = 'totalMatched'
const DEBUG_LOG_QUERY_SUMMARY_HAS_MORE_KEY = 'hasMore'
const DEBUG_LOG_QUERY_SUMMARY_TOTAL_STORED_KEY = 'totalStored'
const DEBUG_LOG_QUERY_SUMMARY_FILTERS_KEY = 'filters'
const DEBUG_LOG_QUERY_SUMMARY_EXPORTED_AT_KEY = 'exportedAt'
const DEBUG_LOG_QUERY_SUMMARY_REQUEST_ID_KEY = 'requestId'
const DEBUG_LOG_ENTRY_MESSAGE_KEY = 'message'
const DEBUG_LOG_ENTRY_CONTEXT_KEY = 'context'
const DEBUG_LOG_ENTRY_REQUEST_ID_KEY = 'requestId'
const DEBUG_LOG_ENTRY_JOB_ID_KEY = 'jobId'
const DEBUG_LOG_ENTRY_TAB_ID_KEY = 'tabId'

function buildDebugLogQueryPayload(args: JsonObject, defaultLimit?: number): JsonObject {
  const levels = args['levels']
  const sources = args['sources']
  const scope = readOptionalString(args, 'scope')
  const requestId = readOptionalString(args, 'requestId')
  const jobId = readOptionalString(args, 'jobId')
  const tabId = readOptionalNumber(args, 'tabId')
  const since = readOptionalString(args, 'since')
  const until = readOptionalString(args, 'until')
  const searchText = readOptionalString(args, 'searchText')
  const limit = readOptionalNumber(args, 'limit')

  return {
    ...(Array.isArray(levels) ? { levels } : {}),
    ...(Array.isArray(sources) ? { sources } : {}),
    ...(scope ? { scope } : {}),
    ...(requestId ? { requestId } : {}),
    ...(jobId ? { jobId } : {}),
    ...(tabId !== undefined ? { tabId } : {}),
    ...(since ? { since } : {}),
    ...(until ? { until } : {}),
    ...(searchText ? { searchText } : {}),
    ...(limit !== undefined ? { limit } : defaultLimit !== undefined ? { limit: defaultLimit } : {}),
  }
}

function buildDebugLogClearPayload(args: JsonObject): JsonObject {
  const queryPayload = buildDebugLogQueryPayload(args)
  const { limit: _limit, ...clearPayload } = queryPayload
  return clearPayload
}

function isJsonObjectValue(value: JsonObject[string]): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

interface DebugLogQueryResponse {
  items: JsonObject[]
  totalMatched: number
  returned: number
  hasMore: boolean
  totalStored: number
}

function parseDebugLogQueryResponse(response: JsonObject): DebugLogQueryResponse {
  const itemsRaw = response.items
  const totalMatched = response.totalMatched
  const returned = response.returned
  const hasMore = response.hasMore
  const totalStored = response.totalStored

  if (!Array.isArray(itemsRaw) || !itemsRaw.every(item => isJsonObjectValue(item))) {
    throw new Error('Invalid debug.get_logs response: missing items')
  }

  if (typeof totalMatched !== 'number' || !Number.isFinite(totalMatched)) {
    throw new Error('Invalid debug.get_logs response: missing totalMatched')
  }

  if (typeof returned !== 'number' || !Number.isFinite(returned)) {
    throw new Error('Invalid debug.get_logs response: missing returned')
  }

  if (typeof hasMore !== 'boolean') {
    throw new Error('Invalid debug.get_logs response: missing hasMore')
  }

  if (typeof totalStored !== 'number' || !Number.isFinite(totalStored)) {
    throw new Error('Invalid debug.get_logs response: missing totalStored')
  }

  return {
    items: itemsRaw,
    totalMatched,
    returned,
    hasMore,
    totalStored,
  }
}

function formatYamlBlock(value: JsonObject): string {
  const yamlText = stringify(value).trimEnd()
  return yamlText.length > 0 ? yamlText : DEBUG_LOG_RESULT_EMPTY_ENTRIES_LABEL
}

function indentBlock(text: string): string {
  return text
    .split('\n')
    .map(line => `  ${line}`)
    .join('\n')
}

function formatScalarLine(label: string, value: JsonObject[string] | string | number | boolean): string {
  return `${label}: ${String(value)}`
}

function filterDebugLogContext(entry: JsonObject): JsonObject {
  const context = readOptionalObject(entry, DEBUG_LOG_ENTRY_CONTEXT_KEY)
  if (!context) {
    return {}
  }

  const requestId = readOptionalString(entry, DEBUG_LOG_ENTRY_REQUEST_ID_KEY)
  const jobId = readOptionalString(entry, DEBUG_LOG_ENTRY_JOB_ID_KEY)
  const tabId = readOptionalNumber(entry, DEBUG_LOG_ENTRY_TAB_ID_KEY)
  const filteredContext: JsonObject = {}

  Object.entries(context).forEach(([key, value]) => {
    if (key === DEBUG_LOG_ENTRY_REQUEST_ID_KEY && value === requestId) {
      return
    }

    if (key === DEBUG_LOG_ENTRY_JOB_ID_KEY && value === jobId) {
      return
    }

    if (key === DEBUG_LOG_ENTRY_TAB_ID_KEY && value === tabId) {
      return
    }

    filteredContext[key] = value
  })

  return filteredContext
}

function formatDebugLogEntry(entry: JsonObject): string {
  const timestamp = readOptionalString(entry, 'timestamp') || 'unknown-timestamp'
  const level = (readOptionalString(entry, 'level') || 'info').toUpperCase()
  const source = readOptionalString(entry, 'source') || 'unknown-source'
  const scope = readOptionalString(entry, 'scope') || 'unknown-scope'
  const message = readOptionalString(entry, DEBUG_LOG_ENTRY_MESSAGE_KEY) || ''
  const requestId = readOptionalString(entry, DEBUG_LOG_ENTRY_REQUEST_ID_KEY)
  const jobId = readOptionalString(entry, DEBUG_LOG_ENTRY_JOB_ID_KEY)
  const tabId = readOptionalNumber(entry, DEBUG_LOG_ENTRY_TAB_ID_KEY)
  const filteredContext = filterDebugLogContext(entry)
  const lines = [`[${timestamp}] ${level} ${source} ${scope}`]

  if (message.length > 0) {
    lines.push(formatScalarLine(DEBUG_LOG_ENTRY_MESSAGE_KEY, message))
  }

  if (requestId) {
    lines.push(formatScalarLine(DEBUG_LOG_ENTRY_REQUEST_ID_KEY, requestId))
  }

  if (jobId) {
    lines.push(formatScalarLine(DEBUG_LOG_ENTRY_JOB_ID_KEY, jobId))
  }

  if (tabId !== undefined) {
    lines.push(formatScalarLine(DEBUG_LOG_ENTRY_TAB_ID_KEY, tabId))
  }

  if (Object.keys(filteredContext).length > 0) {
    lines.push(`${DEBUG_LOG_ENTRY_CONTEXT_KEY}:`)
    lines.push(indentBlock(formatYamlBlock(filteredContext)))
  }

  return lines.join('\n')
}

function buildDebugLogHeader(input: {
  queryPayload: JsonObject
  queryResult: DebugLogQueryResponse
  requestId?: string
  exportedAt?: string
  format?: string
}): string {
  const lines = [
    formatScalarLine(DEBUG_LOG_QUERY_SUMMARY_RETURNED_KEY, input.queryResult.returned),
    formatScalarLine(DEBUG_LOG_QUERY_SUMMARY_TOTAL_MATCHED_KEY, input.queryResult.totalMatched),
    formatScalarLine(DEBUG_LOG_QUERY_SUMMARY_HAS_MORE_KEY, input.queryResult.hasMore),
    formatScalarLine(DEBUG_LOG_QUERY_SUMMARY_TOTAL_STORED_KEY, input.queryResult.totalStored),
  ]

  if (input.exportedAt) {
    lines.push(formatScalarLine(DEBUG_LOG_QUERY_SUMMARY_EXPORTED_AT_KEY, input.exportedAt))
  }

  if (input.format) {
    lines.push(formatScalarLine('format', input.format))
  }

  if (input.requestId) {
    lines.push(formatScalarLine(DEBUG_LOG_QUERY_SUMMARY_REQUEST_ID_KEY, input.requestId))
  }

  if (Object.keys(input.queryPayload).length > 0) {
    lines.push(`${DEBUG_LOG_QUERY_SUMMARY_FILTERS_KEY}:`)
    lines.push(indentBlock(formatYamlBlock(input.queryPayload)))
  }

  return lines.join('\n')
}

function buildDebugLogText(input: {
  queryPayload: JsonObject
  queryResult: DebugLogQueryResponse
  requestId?: string
  exportedAt?: string
  format?: string
}): string {
  const header = buildDebugLogHeader(input)
  const entries =
    input.queryResult.items.length > 0
      ? input.queryResult.items.map(item => formatDebugLogEntry(item)).join('\n\n')
      : DEBUG_LOG_RESULT_EMPTY_ENTRIES_LABEL

  return `${header}\n\n${entries}`
}

function buildDebugLogExportResultText(input: {
  requestId: string
  outputDir: string
  fileName: string
  filePath: string
  bytes: number
  queryResult: DebugLogQueryResponse
}): string {
  return [
    'status: ok',
    formatScalarLine(DEBUG_LOG_QUERY_SUMMARY_REQUEST_ID_KEY, input.requestId),
    formatScalarLine('outputDir', input.outputDir),
    formatScalarLine('fileName', input.fileName),
    formatScalarLine('filePath', input.filePath),
    formatScalarLine('bytes', input.bytes),
    formatScalarLine('format', DEBUG_LOG_EXPORT_FORMAT_LOG),
    formatScalarLine(DEBUG_LOG_QUERY_SUMMARY_TOTAL_MATCHED_KEY, input.queryResult.totalMatched),
    formatScalarLine(DEBUG_LOG_QUERY_SUMMARY_RETURNED_KEY, input.queryResult.returned),
    formatScalarLine(DEBUG_LOG_QUERY_SUMMARY_HAS_MORE_KEY, input.queryResult.hasMore),
    formatScalarLine(DEBUG_LOG_QUERY_SUMMARY_TOTAL_STORED_KEY, input.queryResult.totalStored),
  ].join('\n')
}

export class ToolRegistry {
  private readonly tools: ToolDefinition[] = [
    createTool({
      name: 'browser_open_tab',
      description: 'Open one browser tab for a URL and make it the active selected tab.',
      inputShape: {
        url: z.string().url(),
        openMode: z.enum(MCP_TAB_OPEN_MODE_OPTIONS).optional(),
      },
      buildCommand: (args, context) => {
        const payload: JsonObject = {
          url: readRequiredString(args, 'url'),
        }
        const openMode = readOptionalString(args, 'openMode')
        if (openMode) {
          payload.openMode = openMode
        }

        return {
          commandName: 'browser.open_tab',
          payload,
          requestId: context.requestId,
        }
      },
    }),
    createTool({
      name: 'browser_list_tabs',
      description: 'List browser tabs available to the extension bridge.',
      inputShape: {
        currentWindowOnly: z.boolean().optional(),
      },
      buildCommand: (_args, context) => ({
        commandName: 'browser.list_tabs',
        payload: {},
        requestId: context.requestId,
      }),
    }),
    createTool({
      name: 'browser_use_tab',
      description: 'Select and activate one browser tab by tabId.',
      inputShape: {
        tabId: z.number().int().positive(),
      },
      buildCommand: (args, context) => ({
        commandName: 'browser.use_tab',
        payload: {
          tabId: readRequiredNumber(args, 'tabId'),
        },
        requestId: context.requestId,
      }),
    }),
    createTool({
      name: 'browser_close_tab',
      description: 'Close one browser tab by tabId.',
      inputShape: {
        tabId: z.number().int().positive(),
      },
      buildCommand: (args, context) => ({
        commandName: 'browser.close_tab',
        payload: {
          tabId: readRequiredNumber(args, 'tabId'),
        },
        requestId: context.requestId,
      }),
    }),
    createTool({
      name: 'debug_get_logs',
      description: 'Query structured extension debug logs stored in the background worker.',
      inputShape: {
        levels: z.array(z.enum(DEBUG_LOG_LEVEL_OPTIONS)).optional(),
        sources: z.array(z.enum(DEBUG_LOG_SOURCE_OPTIONS)).optional(),
        scope: z.string().optional(),
        requestId: z.string().optional(),
        jobId: z.string().optional(),
        tabId: z.number().int().positive().optional(),
        since: z.string().optional(),
        until: z.string().optional(),
        searchText: z.string().optional(),
        limit: z.number().int().positive().max(DEBUG_LOG_EXPORT_MAX_LIMIT).optional(),
      },
      execute: async (args, context) => {
        const jobId = readOptionalString(args, 'jobId')
        const queryPayload = buildDebugLogQueryPayload(args)
        const queryResponse = await context.sendCommand('debug.get_logs', queryPayload, {
          requestId: context.requestId,
          ...(jobId ? { jobId } : {}),
          timeoutMs: DEBUG_LOG_EXPORT_TIMEOUT_MS,
        })
        const queryResult = parseDebugLogQueryResponse(queryResponse)

        return createToolTextResult(
          buildDebugLogText({
            queryPayload,
            queryResult,
          })
        )
      },
    }),
    createTool({
      name: 'debug_clear_logs',
      description: 'Clear structured extension debug logs stored in the background worker.',
      inputShape: {
        levels: z.array(z.enum(DEBUG_LOG_LEVEL_OPTIONS)).optional(),
        sources: z.array(z.enum(DEBUG_LOG_SOURCE_OPTIONS)).optional(),
        scope: z.string().optional(),
        requestId: z.string().optional(),
        jobId: z.string().optional(),
        tabId: z.number().int().positive().optional(),
        since: z.string().optional(),
        until: z.string().optional(),
        searchText: z.string().optional(),
      },
      buildCommand: (args, context) => ({
        commandName: 'debug.clear_logs',
        payload: buildDebugLogClearPayload(args),
        requestId: context.requestId,
      }),
    }),
    createTool({
      name: 'debug_export_logs_to_file',
      description:
        'Export extension debug logs to a local multiline text log file and return the saved file path.',
      inputShape: {
        levels: z.array(z.enum(DEBUG_LOG_LEVEL_OPTIONS)).optional(),
        sources: z.array(z.enum(DEBUG_LOG_SOURCE_OPTIONS)).optional(),
        scope: z.string().optional(),
        requestId: z.string().optional(),
        jobId: z.string().optional(),
        tabId: z.number().int().positive().optional(),
        since: z.string().optional(),
        until: z.string().optional(),
        searchText: z.string().optional(),
        limit: z.number().int().positive().max(DEBUG_LOG_EXPORT_MAX_LIMIT).optional(),
        outputDir: z.string(),
        fileName: z.string().optional(),
      },
      execute: async (args, context) => {
        const outputDir = readRequiredString(args, 'outputDir')
        const fileName = readOptionalString(args, 'fileName')
        const jobId = readOptionalString(args, 'jobId')
        const queryPayload = buildDebugLogQueryPayload(args, DEBUG_LOG_EXPORT_DEFAULT_LIMIT)
        const exportResponse = await context.sendCommand('debug.get_logs', queryPayload, {
          requestId: context.requestId,
          ...(jobId ? { jobId } : {}),
          timeoutMs: DEBUG_LOG_EXPORT_TIMEOUT_MS,
        })
        const queryResult = parseDebugLogQueryResponse(exportResponse)
        const normalizedFileName = normalizeFileName({
          preferredFileName: fileName,
          fallbackFileName: `${DEBUG_LOG_EXPORT_DEFAULT_FILE_PREFIX}_${Date.now()}.${DEBUG_LOG_EXPORT_FORMAT_LOG}`,
          extension: DEBUG_LOG_EXPORT_FORMAT_LOG,
        })
        const resolvedOutputDir = path.resolve(outputDir)
        await fs.mkdir(resolvedOutputDir, { recursive: true })
        const filePath = path.join(resolvedOutputDir, normalizedFileName)
        const exportedAt = new Date().toISOString()
        const exportPayload = buildDebugLogText({
          queryPayload,
          queryResult,
          requestId: context.requestId,
          exportedAt,
          format: DEBUG_LOG_EXPORT_FORMAT_LOG,
        })

        await fs.writeFile(filePath, exportPayload, 'utf8')
        const stat = await fs.stat(filePath)

        return createToolTextResult(
          buildDebugLogExportResultText({
            requestId: context.requestId,
            outputDir: resolvedOutputDir,
            fileName: normalizedFileName,
            filePath,
            bytes: stat.size,
            queryResult,
          })
        )
      },
    }),
    createTool({
      name: 'scrape_detect_tables',
      description:
        'Step 1 of 3: Scan the current tab for table-like elements using DOM heuristics only (no backend API call). Returns a compact list of detected tables with selectors and sample item rows for the agent to inspect. Call scrape_get_table_tree to obtain the UID-annotated simplified DOM tree for a specific table when you need to identify expand buttons or inspect structure.',
      inputShape: {
        tabId: z.number().int().positive().optional(),
        url: z.string().url().optional(),
        prompt: z.string().optional(),
        tabOpenMode: z.enum(MCP_TAB_OPEN_MODE_OPTIONS).optional(),
      },
      buildCommand: (args, context) => {
        const tabId = readOptionalNumber(args, 'tabId')
        const url = readOptionalString(args, 'url')
        const prompt = readOptionalString(args, 'prompt')
        const tabOpenMode = readOptionalString(args, 'tabOpenMode')

        return {
          commandName: 'scrape.detect_tables',
          payload: {
            requestId: context.requestId,
            ...(tabId !== undefined
              ? { tabId }
              : context.selectedTabId !== null
                ? { tabId: context.selectedTabId }
                : {}),
            ...(url ? { url } : {}),
            ...(prompt ? { prompt } : {}),
            ...(tabOpenMode ? { tabOpenMode } : {}),
          },
          requestId: context.requestId,
        }
      },
    }),
    createTool({
      name: 'scrape_get_table_tree',
      description:
        'Fetch the UID-annotated simplified DOM tree for a specific table. Use this after scrape_detect_tables when you need to inspect the tree structure of a particular table — for example, to identify UIDs of expand/reply buttons to pass to scrape_click_expand_and_redetect. Returns the simplified tree with _uid annotations on every node.',
      inputShape: {
        tabId: z.number().int().positive().optional(),
        rootSelector: z.string(),
        itemSelector: z.string(),
        documentInfoPath: z.string(),
      },
      buildCommand: (args, context) => {
        return {
          commandName: 'scrape.get_table_tree',
          payload: {
            requestId: context.requestId,
            ...(context.selectedTabId !== null ? { tabId: context.selectedTabId } : {}),
            rootSelector: readRequiredString(args, 'rootSelector'),
            itemSelector: readRequiredString(args, 'itemSelector'),
            documentInfoPath: readRequiredString(args, 'documentInfoPath'),
          },
          requestId: context.requestId,
        }
      },
    }),
    createTool({
      name: 'scrape_click_expand_and_redetect',
      description:
        'Step 2 of 3 (optional): Click expand/reply buttons identified by the agent from the table tree, then re-detect the table. Call scrape_get_table_tree first to inspect the tree, identify the UIDs of expand buttons, then pass those UIDs here. Pass rootSelector, itemSelector, and documentInfoPath from the selected table.',
      inputShape: {
        tabId: z.number().int().positive().optional(),
        rootSelector: z.string(),
        itemSelector: z.string(),
        documentInfoPath: z.string(),
        expandButtonUids: z.array(
          z.object({
            type: z.string(),
            uids: z.array(z.string()),
          })
        ),
      },
      buildCommand: (args, context) => {
        return {
          commandName: 'scrape.click_expand_and_redetect',
          payload: {
            requestId: context.requestId,
            ...(context.selectedTabId !== null ? { tabId: context.selectedTabId } : {}),
            rootSelector: readRequiredString(args, 'rootSelector'),
            itemSelector: readRequiredString(args, 'itemSelector'),
            documentInfoPath: readRequiredString(args, 'documentInfoPath'),
            expandButtonUids: args['expandButtonUids'],
          },
          requestId: context.requestId,
        }
      },
    }),
    createTool({
      name: 'scrape_analyze_columns',
      description:
        'Step 3 of 3: Analyze columns and build a scraperConfig draft by calling the backend AI APIs (analyze-columns, detect-pagination). Pass rootSelector, itemSelector, documentInfoPath from the selected / post-expansion table, and optionally expandButtons from scrape_expand_replies.',
      inputShape: {
        tabId: z.number().int().positive().optional(),
        url: z.string().url().optional(),
        prompt: z.string().optional(),
        rootSelector: z.string(),
        itemSelector: z.string(),
        documentInfoPath: z.string(),
        expandButtons: z
          .array(
            z.object({
              type: z.string(),
              uids: z.array(z.string()),
            })
          )
          .optional(),
      },
      buildCommand: (args, context) => {
        const tabId = readOptionalNumber(args, 'tabId')
        const url = readOptionalString(args, 'url')
        const prompt = readOptionalString(args, 'prompt')
        const expandButtons = args['expandButtons']

        return {
          commandName: 'scrape.analyze_columns',
          payload: {
            requestId: context.requestId,
            ...(tabId !== undefined
              ? { tabId }
              : context.selectedTabId !== null
                ? { tabId: context.selectedTabId }
                : {}),
            ...(url ? { url } : {}),
            ...(prompt ? { prompt } : {}),
            rootSelector: readRequiredString(args, 'rootSelector'),
            itemSelector: readRequiredString(args, 'itemSelector'),
            documentInfoPath: readRequiredString(args, 'documentInfoPath'),
            ...(expandButtons !== undefined ? { expandButtons } : {}),
          },
          requestId: context.requestId,
        }
      },
    }),
    createTool({
      name: 'scrape_start',
      description:
        'Start a scraping job from a cached prepare jobId, a prepared draft, or an explicit scraperConfig.',
      inputShape: {
        requestId: z.string().optional(),
        jobId: z.string().optional(),
        tabId: z.number().int().positive().optional(),
        maxRecords: z.number().int().positive().optional(),
        jobDraft: JsonObjectSchema.optional(),
        scraperConfig: JsonObjectSchema.optional(),
      },
      buildCommand: (args, context) => {
        const requestId = readOptionalString(args, 'requestId') || context.requestId
        const jobId = readOptionalString(args, 'jobId')
        const tabId = readOptionalNumber(args, 'tabId')
        const maxRecords = readOptionalNumber(args, 'maxRecords')
        const jobDraft = readOptionalObject(args, 'jobDraft')
        const scraperConfig = readOptionalObject(args, 'scraperConfig')

        return {
          commandName: 'scrape.start',
          payload: {
            requestId,
            ...(tabId !== undefined
              ? { tabId }
              : context.selectedTabId !== null
                ? { tabId: context.selectedTabId }
                : {}),
            ...(jobId ? { jobId } : {}),
            ...(maxRecords !== undefined ? { maxRecords } : {}),
            ...(jobDraft ? { jobDraft } : {}),
            ...(scraperConfig ? { scraperConfig } : {}),
          },
          requestId,
        }
      },
    }),
    createTool({
      name: 'scrape_status',
      description:
        'Get latest state and counters of a scraping job. Supports optional waitMs to delay the status check.',
      inputShape: {
        jobId: z.string(),
        waitMs: z.number().int().min(0).max(300_000).optional(),
      },
      execute: async (args, context) => {
        const jobId = readRequiredString(args, 'jobId')
        const waitMs = readOptionalNumber(args, 'waitMs')

        if (waitMs !== undefined && waitMs > 0) {
          await waitForMs(waitMs)
        }

        return context.sendCommand(
          'scrape.status',
          {
            jobId,
          },
          {
            requestId: context.requestId,
            jobId,
          }
        )
      },
    }),
    createTool({
      name: 'scrape_pause',
      description: 'Pause a running scraping job.',
      inputShape: {
        jobId: z.string(),
      },
      buildCommand: (args, context) => ({
        commandName: 'scrape.pause',
        payload: {
          jobId: readRequiredString(args, 'jobId'),
        },
        requestId: context.requestId,
      }),
    }),
    createTool({
      name: 'scrape_resume',
      description: 'Resume a paused scraping job.',
      inputShape: {
        jobId: z.string(),
      },
      buildCommand: (args, context) => ({
        commandName: 'scrape.resume',
        payload: {
          jobId: readRequiredString(args, 'jobId'),
        },
        requestId: context.requestId,
      }),
    }),
    createTool({
      name: 'scrape_stop',
      description: 'Stop a running or paused scraping job.',
      inputShape: {
        jobId: z.string(),
      },
      buildCommand: (args, context) => ({
        commandName: 'scrape.stop',
        payload: {
          jobId: readRequiredString(args, 'jobId'),
        },
        requestId: context.requestId,
      }),
    }),
    createTool({
      name: 'scrape_result',
      description: 'Fetch paginated rows from a scraping job result set.',
      inputShape: {
        jobId: z.string(),
        cursor: z.string().optional(),
        limit: z.number().int().positive().max(1000).optional(),
      },
      buildCommand: (args, context) => {
        const cursor = readOptionalString(args, 'cursor')
        const limit = readOptionalNumber(args, 'limit')

        return {
          commandName: 'scrape.result',
          payload: {
            jobId: readRequiredString(args, 'jobId'),
            ...(cursor ? { cursor } : {}),
            ...(limit !== undefined ? { limit } : {}),
          },
          requestId: context.requestId,
        }
      },
    }),
    createTool({
      name: 'scrape_export',
      description: 'Export a scraping job result into json/csv/xlsx artifact.',
      inputShape: {
        jobId: z.string(),
        format: z.enum(['json', 'csv', 'xlsx']).optional(),
      },
      buildCommand: (args, context) => {
        const format = readOptionalString(args, 'format')

        return {
          commandName: 'scrape.export',
          payload: {
            jobId: readRequiredString(args, 'jobId'),
            ...(format ? { format } : {}),
          },
          requestId: context.requestId,
        }
      },
    }),
    createTool({
      name: 'scrape_export_to_file',
      description:
        'Export scraping result and save directly to local filesystem directory, returning file path instead of base64.',
      inputShape: {
        jobId: z.string(),
        format: z.enum(['json', 'csv', 'xlsx']).optional(),
        outputDir: z.string(),
        fileName: z.string().optional(),
      },
      execute: async (args, context) => {
        const jobId = readRequiredString(args, 'jobId')
        const outputDir = readRequiredString(args, 'outputDir')
        const fileName = readOptionalString(args, 'fileName')
        const format = resolveExportFormat(readOptionalString(args, 'format'))

        const exportResponse = await context.sendCommand(
          'scrape.export',
          {
            jobId,
            format,
          },
          {
            requestId: context.requestId,
            jobId,
            timeoutMs: 10 * 60_000,
          }
        )

        const artifactRaw = exportResponse.artifact
        if (!artifactRaw || typeof artifactRaw !== 'object' || Array.isArray(artifactRaw)) {
          throw new Error('Invalid scrape.export response: missing artifact')
        }

        const artifact = artifactRaw as JsonObject
        const contentBase64 = artifact.contentBase64
        if (typeof contentBase64 !== 'string' || contentBase64.length === 0) {
          throw new Error('Invalid scrape.export response: empty contentBase64')
        }

        const artifactFileName =
          typeof artifact.fileName === 'string' ? artifact.fileName : undefined
        const normalizedFileName = normalizeFileName({
          preferredFileName: fileName,
          fallbackFileName: artifactFileName,
          extension: format,
        })

        const resolvedOutputDir = path.resolve(outputDir)
        await fs.mkdir(resolvedOutputDir, { recursive: true })
        const filePath = path.join(resolvedOutputDir, normalizedFileName)

        await fs.writeFile(filePath, contentBase64, { encoding: 'base64' })
        const stat = await fs.stat(filePath)

        const artifactId = typeof artifact.artifactId === 'string' ? artifact.artifactId : undefined
        const mimeType =
          typeof artifact.mimeType === 'string' && artifact.mimeType.length > 0
            ? artifact.mimeType
            : inferMimeType(format)

        return {
          status: 'ok',
          requestId: context.requestId,
          jobId,
          format,
          outputDir: resolvedOutputDir,
          fileName: normalizedFileName,
          filePath,
          bytes: stat.size,
          mimeType,
          ...(artifactId ? { artifactId } : {}),
        }
      },
    }),
  ]

  list(): ToolDefinition[] {
    return this.tools
  }

  get(name: string): ToolDefinition | null {
    return this.tools.find(tool => tool.name === name) || null
  }
}
