import * as z from 'zod'
import type { BridgeCommandName, JsonObject } from '../bridge/protocol'

const JsonObjectSchema = z.record(z.string(), z.unknown())
const TAB_OPEN_MODE_OPTIONS = ['reuse_or_create', 'create_new'] as const
const A11Y_TREE_SCOPE_OPTIONS = ['page', 'target'] as const
const PAGE_OPERATION_OPTIONS = ['scrollTo', 'click', 'tap'] as const
const INPUT_TEXT_MODE_OPTIONS = ['replace', 'append'] as const
const CLICK_WAIT_MODE_OPTIONS = ['none', 'navigation', 'network_idle', 'dom_change'] as const
const ASSET_SCOPE_OPTIONS = ['current_thread', 'workspace'] as const
const DATA_CODE_LANGUAGE_OPTIONS = ['python'] as const
const DATA_CODE_MODE_OPTIONS = ['preview', 'persist'] as const
const DATA_CODE_OUTPUT_KIND_OPTIONS = ['cleaned_csv', 'merged_csv', 'analysis_output'] as const
const DEBUG_LOG_LEVEL_OPTIONS = ['debug', 'info', 'warn', 'error'] as const
const DEBUG_LOG_SOURCE_OPTIONS = ['background', 'content', 'sidepanel'] as const
const TERMINAL_SCRAPE_JOB_STATES = ['COMPLETED', 'STOPPED', 'ERROR', 'CANCELED'] as const
const START_SCRAPE_POLL_INTERVAL_MS = 2_000
const AI_TOOL_RPC_TIMEOUT_MS = 30_000
const AI_TOOL_LONG_RPC_TIMEOUT_MS = 120_000
const URL_PROTOCOL_PATTERN = /^[a-z][a-z\d+\-.]*:/i
const TRACE_INPUT_SHAPE = {
  traceId: z
    .string()
    .trim()
    .min(1)
    .describe('Optional diagnostics trace id returned by debugStartRun.')
    .optional(),
} satisfies z.ZodRawShape

export interface SendCommandOptions {
  requestId?: string
  jobId?: string
  timeoutMs?: number
}

export interface ToolCallContext {
  abortSignal?: AbortSignal
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
  timeoutMs?: number
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

function createTool(
  definition: {
    name: string
    description: string
    inputShape?: z.ZodRawShape
    validateArgs?: (args: JsonObject) => void
  } & ToolRuntimeDefinition
): ToolDefinition {
  const inputShape = definition.inputShape || {}
  const schema = z.object(inputShape).strict()

  return {
    ...definition,
    inputShape,
    parseArgs(raw: unknown) {
      const args = schema.parse(raw) as JsonObject
      definition.validateArgs?.(args)
      return args
    },
  }
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

function readRequiredObject(args: JsonObject, key: string): JsonObject {
  const value = readOptionalObject(args, key)
  if (!value) {
    throw new Error(`Missing required object argument: ${key}`)
  }

  return value
}

function includeOptionalString(payload: JsonObject, args: JsonObject, key: string): void {
  const value = readOptionalString(args, key)
  if (value !== undefined) {
    payload[key] = value
  }
}

function includeOptionalNumber(payload: JsonObject, args: JsonObject, key: string): void {
  const value = readOptionalNumber(args, key)
  if (value !== undefined) {
    payload[key] = value
  }
}

function includeOptionalObject(payload: JsonObject, args: JsonObject, key: string): void {
  const value = readOptionalObject(args, key)
  if (value !== undefined) {
    payload[key] = value
  }
}

function includeOptionalTraceId(payload: JsonObject, args: JsonObject): void {
  includeOptionalString(payload, args, 'traceId')
}

function waitForScrapePollInterval(abortSignal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (abortSignal?.aborted) {
      reject(new Error('Scrape wait was canceled'))
      return
    }

    const timeout = setTimeout(() => {
      abortSignal?.removeEventListener('abort', onAbort)
      resolve()
    }, START_SCRAPE_POLL_INTERVAL_MS)

    const onAbort = () => {
      clearTimeout(timeout)
      reject(new Error('Scrape wait was canceled'))
    }

    abortSignal?.addEventListener('abort', onAbort, { once: true })
  })
}

function normalizeToolUrl(url: string): string {
  const trimmed = url.trim()
  return URL_PROTOCOL_PATTERN.test(trimmed) ? trimmed : `https://${trimmed}`
}

function getJobFromResponse(response: JsonObject): JsonObject {
  const job = response.job
  if (!job || typeof job !== 'object' || Array.isArray(job)) {
    throw new Error('Invalid startScrape response: missing job')
  }

  return job as JsonObject
}

function getJobId(job: JsonObject): string {
  const jobId = job.jobId
  if (typeof jobId !== 'string' || jobId.trim().length === 0) {
    throw new Error('Invalid startScrape response: missing job.jobId')
  }

  return jobId
}

function getJobState(job: JsonObject): string {
  const state = job.state
  if (typeof state !== 'string' || state.trim().length === 0) {
    throw new Error('Invalid scrape job response: missing job.state')
  }

  return state
}

function isTerminalScrapeJobState(state: string): boolean {
  return TERMINAL_SCRAPE_JOB_STATES.includes(state as (typeof TERMINAL_SCRAPE_JOB_STATES)[number])
}

function normalizeScrapeJob(job: JsonObject): JsonObject {
  if (job.state !== 'CANCELED') {
    return job
  }

  const progress =
    job.progress && typeof job.progress === 'object' && !Array.isArray(job.progress)
      ? (job.progress as JsonObject)
      : {}

  return {
    ...job,
    progress: {
      ...progress,
      step: progress.step === 'state:canceled' ? 'state:stopped' : progress.step,
    },
    state: 'STOPPED',
  }
}

function getScrapeCompletionStatus(job: JsonObject): 'completed' | 'stopped' | 'failed' {
  if (job.state === 'COMPLETED') {
    return 'completed'
  }

  if (job.state === 'STOPPED' || job.state === 'CANCELED') {
    return 'stopped'
  }

  return 'failed'
}

function createStartScrapePayload(args: JsonObject, requestId: string): JsonObject {
  const payload: JsonObject = {
    requestId,
  }

  includeOptionalTraceId(payload, args)
  includeOptionalNumber(payload, args, 'tabId')
  includeOptionalString(payload, args, 'jobId')
  includeOptionalObject(payload, args, 'scrapeConfig')
  includeOptionalNumber(payload, args, 'maxRecords')

  return payload
}

function createStartScrapeFinalResponse(requestId: string, job: JsonObject): JsonObject {
  const normalizedJob = normalizeScrapeJob(job)
  const completionStatus = getScrapeCompletionStatus(normalizedJob)

  return {
    requestId,
    job: normalizedJob,
    completionStatus,
    ...(completionStatus === 'stopped' ? { stoppedByUser: true } : {}),
  }
}

async function stopScrapeJob(
  jobId: string,
  context: ToolCallContext,
  traceId?: string
): Promise<ToolExecutionResult> {
  const stopResponse = await context.sendCommand(
    'ai_tool.stop_scrape',
    {
      requestId: context.requestId,
      ...(traceId ? { traceId } : {}),
      jobId,
    },
    {
      requestId: context.requestId,
      jobId,
      timeoutMs: AI_TOOL_RPC_TIMEOUT_MS,
    }
  )
  const stoppedJob = getJobFromResponse(stopResponse)
  return createStartScrapeFinalResponse(context.requestId, stoppedJob)
}

function validateOperatePageArgs(args: JsonObject): void {
  const operation = readRequiredString(args, 'operation')

  if (operation === 'scrollTo') {
    if (!args.target) {
      throw new Error('target is required for scrollTo operation')
    }
    return
  }

  if (operation === 'click') {
    if (!args.target) {
      throw new Error('target is required for click operation')
    }
    return
  }

  if (operation === 'tap') {
    if (!args.target) {
      throw new Error('target is required for tap operation')
    }
    if (typeof args.text !== 'string') {
      throw new Error('text is required for tap operation')
    }
    return
  }
}

function validateStartScrapeArgs(args: JsonObject): void {
  if (!readOptionalString(args, 'jobId') && !readOptionalObject(args, 'scrapeConfig')) {
    throw new Error('jobId or scrapeConfig is required')
  }
}

function validateAnalyzeScrapeConfigArgs(args: JsonObject): void {
  const hasTableId = readOptionalNumber(args, 'tableId') !== undefined
  const hasSelectors =
    readOptionalString(args, 'rootSelector') !== undefined &&
    readOptionalString(args, 'itemSelector') !== undefined &&
    readOptionalString(args, 'documentInfoPath') !== undefined

  if (hasTableId === hasSelectors) {
    throw new Error('Exactly one of tableId or selectors is required')
  }
}

function createRequestTool(input: {
  name: string
  description: string
  commandName: BridgeCommandName
  inputShape: z.ZodRawShape
  payloadBuilder: (args: JsonObject, requestId: string) => JsonObject
  timeoutMs?: number
  validateArgs?: (args: JsonObject) => void
}): ToolDefinition {
  return createTool({
    name: input.name,
    description: input.description,
    inputShape: input.inputShape,
    validateArgs: input.validateArgs,
    buildCommand: (args, context) => ({
      commandName: input.commandName,
      payload: input.payloadBuilder(args, context.requestId),
      requestId: context.requestId,
      ...(input.timeoutMs ? { timeoutMs: input.timeoutMs } : {}),
    }),
  })
}

const ElementTargetSchema = z.union([
  z
    .object({
      selector: z.string().trim().min(1),
    })
    .strict(),
  z
    .object({
      snapshotId: z.string().trim().min(1),
      ref: z.string().trim().min(1),
    })
    .strict(),
])

export class ToolRegistry {
  private readonly tools: ToolDefinition[] = [
    createRequestTool({
      name: 'openAiWorkspaceTab',
      description:
        'Open a URL in the dedicated DataLens AI workspace window. Always use this before detecting or scraping a new website.',
      commandName: 'ai_tool.open_workspace_tab',
      inputShape: {
        ...TRACE_INPUT_SHAPE,
        url: z.string().trim().min(1),
        openMode: z.enum(TAB_OPEN_MODE_OPTIONS).optional(),
      },
      timeoutMs: AI_TOOL_RPC_TIMEOUT_MS,
      payloadBuilder: (args, requestId) => {
        const payload: JsonObject = {
          requestId,
          url: normalizeToolUrl(readRequiredString(args, 'url')),
        }
        includeOptionalTraceId(payload, args)
        includeOptionalString(payload, args, 'openMode')
        return payload
      },
    }),
    createRequestTool({
      name: 'readPageA11yTree',
      description:
        'Read the accessibility tree for a browser tab or selected scrape target to understand page structure.',
      commandName: 'ai_tool.read_page_a11y_tree',
      inputShape: {
        ...TRACE_INPUT_SHAPE,
        tabId: z.number().min(1),
        scope: z.enum(A11Y_TREE_SCOPE_OPTIONS).optional(),
        rootSelector: z.string().trim().min(1).optional(),
        itemSelector: z.string().trim().min(1).optional(),
        documentInfoPath: z.string().optional(),
      },
      timeoutMs: AI_TOOL_RPC_TIMEOUT_MS,
      payloadBuilder: (args, requestId) => {
        const payload: JsonObject = {
          requestId,
          tabId: readRequiredNumber(args, 'tabId'),
        }
        includeOptionalTraceId(payload, args)
        includeOptionalString(payload, args, 'scope')
        includeOptionalString(payload, args, 'rootSelector')
        includeOptionalString(payload, args, 'itemSelector')
        includeOptionalString(payload, args, 'documentInfoPath')
        return payload
      },
    }),
    createRequestTool({
      name: 'readPageRefPug',
      description:
        'Read simplified Pug for a cached a11y-tree ref from readPageA11yTree. Use after detectScrapeTargets returns no targets but the a11y tree shows a plausible repeated list/listitem group; infer rootSelector and itemSelector from the returned Pug, then call analyzeScrapeConfig with documentInfoPath: "".',
      commandName: 'ai_tool.read_page_ref_pug',
      inputShape: {
        ...TRACE_INPUT_SHAPE,
        tabId: z.number().min(1),
        snapshotId: z.string().trim().min(1),
        ref: z.string().trim().min(1),
        context: z.enum(['node', 'parent']).optional(),
      },
      timeoutMs: AI_TOOL_RPC_TIMEOUT_MS,
      payloadBuilder: (args, requestId) => {
        const payload: JsonObject = {
          requestId,
          tabId: readRequiredNumber(args, 'tabId'),
          snapshotId: readRequiredString(args, 'snapshotId'),
          ref: readRequiredString(args, 'ref'),
        }
        includeOptionalTraceId(payload, args)
        includeOptionalString(payload, args, 'context')
        return payload
      },
    }),
    createRequestTool({
      name: 'operatePage',
      description:
        'Operate on a browser page for setup before scrape detection: click tabs, log in, search, filter, accept dialogs, or scrollTo a specific target list. This is not a collection tool; do not use scrollTo to load more rows, increase preview size, or satisfy a requested scrape count because startScrape handles scrolling/pagination/loading during collection.',
      commandName: 'ai_tool.operate_page',
      inputShape: {
        ...TRACE_INPUT_SHAPE,
        tabId: z.number().min(1),
        operation: z.enum(PAGE_OPERATION_OPTIONS),
        target: ElementTargetSchema.optional(),
        waitFor: z.enum(CLICK_WAIT_MODE_OPTIONS).optional(),
        timeoutMs: z.number().min(1).optional(),
        text: z.string().optional(),
        mode: z.enum(INPUT_TEXT_MODE_OPTIONS).optional(),
      },
      validateArgs: validateOperatePageArgs,
      timeoutMs: AI_TOOL_RPC_TIMEOUT_MS,
      payloadBuilder: (args, requestId) => {
        const operation = readRequiredString(args, 'operation')
        const payload: JsonObject = {
          requestId,
          tabId: readRequiredNumber(args, 'tabId'),
          operation,
        }
        includeOptionalTraceId(payload, args)
        const target = args.target
        if (target !== undefined) {
          payload.target = target
        }
        includeOptionalString(payload, args, 'waitFor')
        includeOptionalNumber(payload, args, 'timeoutMs')
        includeOptionalString(payload, args, 'text')
        includeOptionalString(payload, args, 'mode')
        return payload
      },
    }),
    createRequestTool({
      name: 'detectScrapeTargets',
      description:
        'Detect repeated scrape targets such as tables, cards, listings, comments, or search results in an existing tab.',
      commandName: 'ai_tool.detect_scrape_targets',
      inputShape: {
        ...TRACE_INPUT_SHAPE,
        tabId: z.number().min(1),
        prompt: z.string().optional(),
      },
      timeoutMs: AI_TOOL_LONG_RPC_TIMEOUT_MS,
      payloadBuilder: (args, requestId) => {
        const payload: JsonObject = {
          requestId,
          tabId: readRequiredNumber(args, 'tabId'),
        }
        includeOptionalTraceId(payload, args)
        includeOptionalString(payload, args, 'prompt')
        return payload
      },
    }),
    createRequestTool({
      name: 'analyzeScrapeConfig',
      description:
        'Analyze a selected scrape target, expand detected expandable content, infer columns and pagination, and return a complete scrapeConfig plus preview rows. Preview rows validate the configuration only; they are not final collection and do not fulfill requested record counts.',
      commandName: 'ai_tool.analyze_scrape_config',
      inputShape: {
        ...TRACE_INPUT_SHAPE,
        tabId: z.number().min(1),
        tableId: z.number().min(1).optional(),
        rootSelector: z.string().trim().min(1).optional(),
        itemSelector: z.string().trim().min(1).optional(),
        documentInfoPath: z.string().optional(),
        prompt: z.string().optional(),
        previewLimit: z.number().min(1).optional(),
      },
      validateArgs: validateAnalyzeScrapeConfigArgs,
      timeoutMs: AI_TOOL_LONG_RPC_TIMEOUT_MS,
      payloadBuilder: (args, requestId) => {
        const payload: JsonObject = {
          requestId,
          tabId: readRequiredNumber(args, 'tabId'),
        }
        includeOptionalTraceId(payload, args)
        includeOptionalNumber(payload, args, 'tableId')
        includeOptionalString(payload, args, 'rootSelector')
        includeOptionalString(payload, args, 'itemSelector')
        includeOptionalString(payload, args, 'documentInfoPath')
        includeOptionalString(payload, args, 'prompt')
        includeOptionalNumber(payload, args, 'previewLimit')
        return payload
      },
    }),
    createRequestTool({
      name: 'applyDrillDownScrape',
      description:
        'Use this after analyzeScrapeConfig and before startScrape when the user wants fields from each row\'s linked detail page, such as body text, full text, article content, product details, company profiles, job detail pages, 正文, 详情页, 全文, 点开链接, or 每条新闻内容. This updates the latest scrapeConfig with drillDownFields; pass the returned scrapeConfig to startScrape instead of starting the original jobId/config.',
      commandName: 'ai_tool.apply_drill_down_scrape',
      inputShape: {
        ...TRACE_INPUT_SHAPE,
        tabId: z
          .number()
          .min(1)
          .describe('Browser tab containing the already analyzed list page.'),
        scrapeConfig: JsonObjectSchema.describe(
          'Latest scrapeConfig returned by analyzeScrapeConfig or by a previous applyDrillDownScrape call. Use the updated scrapeConfig returned by this tool for any later startScrape call.'
        ),
        fieldKey: z
          .string()
          .trim()
          .min(1)
          .describe(
            'Key of the root-level link field in scrapeConfig.tableInfo.fields to open for each row. Prefer fields whose extractType is "anchor" or "only_anchor".'
          ),
        prompt: z
          .string()
          .trim()
          .min(1)
          .describe(
            'Describe only the fields to extract from the opened detail page, for example price, description, full article content, author, company size, or job requirements.'
          ),
        sampleItemIndex: z
          .number()
          .min(0)
          .describe(
            'Zero-based row index to use as the sample link for detail-page analysis. Omit this unless the first row is not representative.'
          )
          .optional(),
      },
      timeoutMs: AI_TOOL_LONG_RPC_TIMEOUT_MS,
      payloadBuilder: (args, requestId) => {
        const payload: JsonObject = {
          requestId,
          tabId: readRequiredNumber(args, 'tabId'),
          scrapeConfig: readRequiredObject(args, 'scrapeConfig'),
          fieldKey: readRequiredString(args, 'fieldKey'),
          prompt: readRequiredString(args, 'prompt'),
        }
        includeOptionalTraceId(payload, args)
        includeOptionalNumber(payload, args, 'sampleItemIndex')
        return payload
      },
    }),
    createTool({
      name: 'startScrape',
      description:
        'Start the scraper and perform the actual data collection from a prior analysis jobId or a complete latest scrapeConfig. This is the only tool that collects requested records; use maxRecords for requested counts such as 20 items. Results are saved automatically after completion.',
      inputShape: {
        ...TRACE_INPUT_SHAPE,
        tabId: z
          .number()
          .min(1)
          .describe('Browser tab containing the analyzed list page.')
          .optional(),
        jobId: z
          .string()
          .trim()
          .min(1)
          .describe(
            'Prior analysis jobId to start only when no later config mutation, such as drill-down extraction, is needed.'
          )
          .optional(),
        scrapeConfig: JsonObjectSchema.describe(
          'Complete latest scrapeConfig to execute. Use this after applyDrillDownScrape or any config mutation so detail-page fields are included.'
        ).optional(),
        maxRecords: z
          .number()
          .min(1)
          .describe(
            'Requested number of records to collect, such as 20 for "20 items/articles". Use this instead of scrolling or loading more rows manually.'
          )
          .optional(),
      },
      validateArgs: validateStartScrapeArgs,
      execute: async (args, context) => {
        const traceId = readOptionalString(args, 'traceId')
        const startResponse = await context.sendCommand(
          'ai_tool.start_scrape',
          createStartScrapePayload(args, context.requestId),
          {
            requestId: context.requestId,
            timeoutMs: AI_TOOL_RPC_TIMEOUT_MS,
          }
        )
        let job = getJobFromResponse(startResponse)
        const jobId = getJobId(job)

        while (!isTerminalScrapeJobState(getJobState(job))) {
          try {
            await waitForScrapePollInterval(context.abortSignal)
          } catch {
            return await stopScrapeJob(jobId, context, traceId)
          }

          const statusResponse = await context.sendCommand(
            'ai_tool.get_scrape_job_status',
            {
              requestId: context.requestId,
              ...(traceId ? { traceId } : {}),
              jobId,
            },
            {
              requestId: context.requestId,
              jobId,
              timeoutMs: AI_TOOL_RPC_TIMEOUT_MS,
            }
          )
          job = getJobFromResponse(statusResponse)
        }

        return createStartScrapeFinalResponse(context.requestId, job)
      },
    }),
    createRequestTool({
      name: 'listWorkspaceAssets',
      description:
        'List DataLens data workspace assets. Defaults to current_thread; use scope "workspace" only when the user asks to view all workspace data or a file from another chat/task.',
      commandName: 'data_workbench.list_workspace_assets',
      inputShape: {
        ...TRACE_INPUT_SHAPE,
        limit: z.number().min(1).max(200).optional(),
        scope: z.enum(ASSET_SCOPE_OPTIONS).optional(),
      },
      payloadBuilder: args => {
        const payload: JsonObject = {}
        includeOptionalTraceId(payload, args)
        includeOptionalNumber(payload, args, 'limit')
        includeOptionalString(payload, args, 'scope')
        return payload
      },
    }),
    createRequestTool({
      name: 'inspectWorkspaceAsset',
      description:
        'Inspect a workspace CSV file by fileName. Defaults to current_thread scope; use scope "workspace" only for all-workspace or older-task files. Returns sample rows, schema, quality signals, and column statistics in one response.',
      commandName: 'data_workbench.inspect_workspace_asset',
      inputShape: {
        ...TRACE_INPUT_SHAPE,
        fileName: z.string().trim().min(1),
        sampleLimit: z.number().min(1).max(50).optional(),
        scope: z.enum(ASSET_SCOPE_OPTIONS).optional(),
      },
      payloadBuilder: args => {
        const payload: JsonObject = {
          fileName: readRequiredString(args, 'fileName'),
        }
        includeOptionalTraceId(payload, args)
        includeOptionalNumber(payload, args, 'sampleLimit')
        includeOptionalString(payload, args, 'scope')
        return payload
      },
    }),
    createRequestTool({
      name: 'runDataCode',
      description:
        'Run AI-generated Python code against selected workspace CSV files in the DataLens sandbox. Defaults to current_thread scope; use scope "workspace" only for all-workspace or older-task files. Input files are available as /workspace/input/{fileName}. Write preview or final outputs to /workspace/output and include a manifest.json when producing files. Use mode "preview" before ambiguous transformations and mode "persist" when the user wants saved CSV or chart outputs.',
      commandName: 'data_workbench.run_data_code',
      inputShape: {
        ...TRACE_INPUT_SHAPE,
        fileNames: z.array(z.string().trim().min(1)).min(1).max(10),
        code: z.string().trim().min(1),
        language: z.enum(DATA_CODE_LANGUAGE_OPTIONS),
        mode: z.enum(DATA_CODE_MODE_OPTIONS).optional(),
        outputKind: z.enum(DATA_CODE_OUTPUT_KIND_OPTIONS).optional(),
        scope: z.enum(ASSET_SCOPE_OPTIONS).optional(),
        timeoutMs: z.number().min(1).max(120_000).optional(),
      },
      timeoutMs: AI_TOOL_LONG_RPC_TIMEOUT_MS,
      payloadBuilder: args => {
        const payload: JsonObject = {
          fileNames: args.fileNames,
          code: readRequiredString(args, 'code'),
          language: readRequiredString(args, 'language'),
        }
        includeOptionalTraceId(payload, args)
        includeOptionalString(payload, args, 'mode')
        includeOptionalString(payload, args, 'outputKind')
        includeOptionalString(payload, args, 'scope')
        includeOptionalNumber(payload, args, 'timeoutMs')
        return payload
      },
    }),
    createRequestTool({
      name: 'debugStartRun',
      description:
        'Start an AI diagnostics run. Returns a traceId that can be passed into later tools so logs can be grouped into one run.',
      commandName: 'debug.start_run',
      inputShape: {
        traceId: z.string().trim().min(1).optional(),
        clearExisting: z.boolean().optional(),
        note: z.string().trim().min(1).optional(),
      },
      payloadBuilder: args => {
        const payload: JsonObject = {}
        includeOptionalTraceId(payload, args)
        const clearExisting = args.clearExisting
        if (typeof clearExisting === 'boolean') {
          payload.clearExisting = clearExisting
        }
        includeOptionalString(payload, args, 'note')
        return payload
      },
    }),
    createRequestTool({
      name: 'debugGetLogs',
      description:
        'Query extension debug logs by traceId, requestId, jobId, tabId, source, scope, level, time range, or search text.',
      commandName: 'debug.get_logs',
      inputShape: {
        ...TRACE_INPUT_SHAPE,
        levels: z.array(z.enum(DEBUG_LOG_LEVEL_OPTIONS)).optional(),
        sources: z.array(z.enum(DEBUG_LOG_SOURCE_OPTIONS)).optional(),
        scope: z.string().trim().min(1).optional(),
        requestId: z.string().trim().min(1).optional(),
        jobId: z.string().trim().min(1).optional(),
        tabId: z.number().min(1).optional(),
        since: z.string().trim().min(1).optional(),
        until: z.string().trim().min(1).optional(),
        searchText: z.string().trim().min(1).optional(),
        limit: z.number().min(1).optional(),
      },
      payloadBuilder: args => ({ ...args }),
    }),
    createRequestTool({
      name: 'debugClearLogs',
      description:
        'Clear extension debug logs. Prefer passing traceId so unrelated logs are preserved.',
      commandName: 'debug.clear_logs',
      inputShape: {
        ...TRACE_INPUT_SHAPE,
        levels: z.array(z.enum(DEBUG_LOG_LEVEL_OPTIONS)).optional(),
        sources: z.array(z.enum(DEBUG_LOG_SOURCE_OPTIONS)).optional(),
        scope: z.string().trim().min(1).optional(),
        requestId: z.string().trim().min(1).optional(),
        jobId: z.string().trim().min(1).optional(),
        tabId: z.number().min(1).optional(),
        since: z.string().trim().min(1).optional(),
        until: z.string().trim().min(1).optional(),
        searchText: z.string().trim().min(1).optional(),
      },
      payloadBuilder: args => ({ ...args }),
    }),
    createRequestTool({
      name: 'debugGetRunDiagnostics',
      description:
        'Return a trace-oriented diagnostics bundle with summary, timeline, raw logs, and the first warning/error boundary.',
      commandName: 'debug.get_run_diagnostics',
      inputShape: {
        ...TRACE_INPUT_SHAPE,
        requestId: z.string().trim().min(1).optional(),
        jobId: z.string().trim().min(1).optional(),
        tabId: z.number().min(1).optional(),
        since: z.string().trim().min(1).optional(),
        until: z.string().trim().min(1).optional(),
        searchText: z.string().trim().min(1).optional(),
        limit: z.number().min(1).optional(),
      },
      payloadBuilder: args => ({ ...args }),
    }),
    createRequestTool({
      name: 'debugLogin',
      description:
        'Dev-only e2e harness: inject a Supabase session into the extension (commits auth so guarded commands work). Requires PLASMO_PUBLIC_MCP_DEBUG_COMMANDS=1.',
      commandName: 'debug.login',
      inputShape: {
        accessToken: z.string().trim().min(1),
        refreshToken: z.string().trim().min(1),
      },
      payloadBuilder: args => ({
        accessToken: readRequiredString(args, 'accessToken'),
        refreshToken: readRequiredString(args, 'refreshToken'),
      }),
    }),
    createRequestTool({
      name: 'collectorList',
      description: 'Dev-only e2e harness: list the signed-in user\'s saved collectors.',
      commandName: 'collector.list',
      inputShape: {
        ...TRACE_INPUT_SHAPE,
      },
      payloadBuilder: args => {
        const payload: JsonObject = {}
        includeOptionalTraceId(payload, args)
        return payload
      },
    }),
    createRequestTool({
      name: 'collectorRun',
      description:
        'Dev-only e2e harness: run a collector (by collectorId or inline collector IR) against one or more URLs. Returns started job ids per URL plus any reveal workflow learned. Pair with collectorAwaitResult to read rows.',
      commandName: 'collector.run',
      inputShape: {
        ...TRACE_INPUT_SHAPE,
        collectorId: z.string().trim().min(1).optional(),
        collector: JsonObjectSchema.optional(),
        urls: z.array(z.string().trim().min(1)).min(1),
        limit: z.number().min(1).optional(),
        revealWorkflow: z.array(z.unknown()).optional(),
      },
      validateArgs: args => {
        const hasId = typeof args.collectorId === 'string'
        const hasInline = args.collector !== undefined && args.collector !== null
        if (hasId === hasInline) {
          throw new Error('Provide exactly one of collectorId or collector')
        }
      },
      timeoutMs: 300_000,
      payloadBuilder: args => {
        const payload: JsonObject = { urls: args.urls }
        includeOptionalTraceId(payload, args)
        includeOptionalString(payload, args, 'collectorId')
        includeOptionalObject(payload, args, 'collector')
        includeOptionalNumber(payload, args, 'limit')
        if (Array.isArray(args.revealWorkflow)) {
          payload.revealWorkflow = args.revealWorkflow
        }
        return payload
      },
    }),
    createRequestTool({
      name: 'collectorAwaitResult',
      description:
        'Dev-only e2e harness: wait for a collector job to reach a terminal state and return rows, drill-down list counts, consumed points, and any error.',
      commandName: 'collector.await_result',
      inputShape: {
        jobId: z.string().trim().min(1),
        timeoutMs: z.number().min(1).max(300_000).optional(),
        maxRows: z.number().min(1).max(10_000).optional(),
      },
      // Above the tool's internal 5-min await default so the RPC doesn't time out first.
      timeoutMs: 360_000,
      payloadBuilder: args => {
        const payload: JsonObject = { jobId: readRequiredString(args, 'jobId') }
        includeOptionalNumber(payload, args, 'timeoutMs')
        includeOptionalNumber(payload, args, 'maxRows')
        return payload
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
