import { nanoid } from 'nanoid'
import type { BridgeCommandName, JsonObject } from '../bridge/protocol'
import { JobOwnershipStore } from './job-ownership-store'
import { SessionStateStore } from './session-state-store'
import { TabLeaseManager } from './tab-lease-manager'
import {
  isToolTextResult,
  type SendCommandOptions,
  type ToolExecutionResult,
} from './tool-registry'
import { ToolRegistry } from './tool-registry'

const TOOL_NOT_FOUND_ERROR_PREFIX = 'Unknown tool:'
const TAB_SCOPED_COMMANDS = new Set<BridgeCommandName>([
  'ai_tool.read_page_a11y_tree',
  'ai_tool.operate_page',
  'ai_tool.detect_scrape_targets',
  'ai_tool.analyze_scrape_config',
  'ai_tool.apply_drill_down_scrape',
  'ai_tool.start_scrape',
])
const JOB_SCOPED_COMMANDS = new Set<BridgeCommandName>([
  'ai_tool.get_scrape_job_status',
  'ai_tool.stop_scrape',
])
const RESPONSE_LEASE_COMMANDS = new Set<BridgeCommandName>(['ai_tool.open_workspace_tab'])
const DATA_WORKBENCH_COMMANDS = new Set<BridgeCommandName>([
  'data_workbench.list_workspace_assets',
  'data_workbench.inspect_workspace_asset',
  'data_workbench.run_data_code',
])
const DATA_WORKBENCH_WORKSPACE_SCOPE = 'workspace'
const START_SCRAPE_TOOL_NAME = 'startScrape'
const RUN_DATA_CODE_TOOL_NAME = 'runDataCode'

export interface ToolExecutorInvokeOptions {
  abortSignal?: AbortSignal
}

type ToolExecutorSendCommand = (
  name: BridgeCommandName,
  payload: JsonObject,
  options?: SendCommandOptions
) => Promise<JsonObject>

function isTabScopedCommand(name: BridgeCommandName): boolean {
  return TAB_SCOPED_COMMANDS.has(name)
}

function isJobScopedCommand(name: BridgeCommandName): boolean {
  return JOB_SCOPED_COMMANDS.has(name)
}

function readPayloadNumber(payload: JsonObject, key: string): number | null {
  const value = payload[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function readPayloadString(payload: JsonObject, key: string): string | null {
  const value = payload[key]
  return typeof value === 'string' && value.length > 0 ? value : null
}

function extractTabIdFromPayload(payload: JsonObject): number | null {
  const tabValue = payload.tab
  if (tabValue && typeof tabValue === 'object' && !Array.isArray(tabValue)) {
    const tabIdValue = (tabValue as { id?: number }).id
    if (typeof tabIdValue === 'number' && Number.isFinite(tabIdValue)) {
      return tabIdValue
    }
  }

  const tabsValue = payload.tabs
  if (!Array.isArray(tabsValue)) {
    return null
  }

  const activeTab = tabsValue.find(
    item =>
      item &&
      typeof item === 'object' &&
      !Array.isArray(item) &&
      (item as { active?: boolean }).active === true
  )

  if (!activeTab || typeof activeTab !== 'object' || Array.isArray(activeTab)) {
    return null
  }

  const tabIdValue = (activeTab as { id?: number }).id
  return typeof tabIdValue === 'number' && Number.isFinite(tabIdValue) ? tabIdValue : null
}

function extractJobIdFromPayload(payload: JsonObject): string | null {
  const topLevelJobId = readPayloadString(payload, 'jobId')
  if (topLevelJobId) {
    return topLevelJobId
  }

  const job = payload.job
  if (!job || typeof job !== 'object' || Array.isArray(job)) {
    return null
  }

  const jobId = (job as JsonObject).jobId
  return typeof jobId === 'string' && jobId.length > 0 ? jobId : null
}

function isObjectValue(value: JsonObject[string]): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function extractRemoteFileIdFromScrapeResponse(payload: JsonObject): string | null {
  const job = payload.job
  if (!isObjectValue(job)) {
    return null
  }

  const remoteFileId = job.remoteFileId
  return typeof remoteFileId === 'string' && remoteFileId.length > 0 ? remoteFileId : null
}

function readStringArray(value: JsonObject[string]): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.flatMap(item => (typeof item === 'string' && item.length > 0 ? [item] : []))
}

function extractRunDataCodeOutputFileIds(payload: JsonObject): string[] {
  const metadata = payload.metadata
  if (isObjectValue(metadata)) {
    const metadataOutputIds = readStringArray(metadata.outputFileIds)
    if (metadataOutputIds.length > 0) {
      return metadataOutputIds
    }
  }

  const outputFileIds = readStringArray(payload.outputFileIds)
  if (outputFileIds.length > 0) {
    return outputFileIds
  }

  const outputFiles = payload.outputFiles
  if (!Array.isArray(outputFiles)) {
    return []
  }

  return outputFiles.flatMap(outputFile => {
    if (!isObjectValue(outputFile)) {
      return []
    }

    const fileId = outputFile.fileId
    return typeof fileId === 'string' && fileId.length > 0 ? [fileId] : []
  })
}

function stripInternalFileIdsFromOutputFiles(value: JsonObject[string]): JsonObject[string] {
  if (!Array.isArray(value)) {
    return value
  }

  return value.map(outputFile => {
    if (!isObjectValue(outputFile)) {
      return outputFile
    }

    const { fileId: _fileId, assetId: _assetId, ...aiFacingOutputFile } = outputFile
    return aiFacingOutputFile
  })
}

function stripInternalFileIdsFromCharts(value: JsonObject[string]): JsonObject[string] {
  if (!Array.isArray(value)) {
    return value
  }

  return value.map(chart => {
    if (!isObjectValue(chart)) {
      return chart
    }

    const { fileId: _fileId, ...aiFacingChart } = chart
    return aiFacingChart
  })
}

function normalizeRunDataCodeResponse(payload: JsonObject): JsonObject {
  const result = payload.result
  const aiFacing = isObjectValue(result) ? result : payload

  const { metadata: _metadata, outputFileIds: _outputFileIds, ...normalized } = aiFacing
  return {
    ...normalized,
    ...(Object.prototype.hasOwnProperty.call(normalized, 'outputFiles')
      ? { outputFiles: stripInternalFileIdsFromOutputFiles(normalized.outputFiles) }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(normalized, 'charts')
      ? { charts: stripInternalFileIdsFromCharts(normalized.charts) }
      : {}),
  }
}

function shouldIncludeSourceFileIds(commandName: BridgeCommandName, payload: JsonObject): boolean {
  if (!DATA_WORKBENCH_COMMANDS.has(commandName)) {
    return false
  }

  return payload.scope !== DATA_WORKBENCH_WORKSPACE_SCOPE
}

export class ToolExecutor {
  private readonly sourceFileIdsBySession = new Map<string, Set<string>>()

  constructor(
    private readonly toolRegistry: ToolRegistry,
    private readonly sendBridgeCommand: ToolExecutorSendCommand,
    private readonly sessionStateStore: SessionStateStore,
    private readonly tabLeaseManager: TabLeaseManager,
    private readonly jobOwnershipStore: JobOwnershipStore
  ) {}

  listTools() {
    return this.toolRegistry.list()
  }

  private getSourceFileIds(sessionId: string): string[] {
    return Array.from(this.sourceFileIdsBySession.get(sessionId) ?? [])
  }

  private recordSourceFileIds(sessionId: string | undefined, sourceFileIds: string[]): void {
    if (!sessionId || sourceFileIds.length === 0) {
      return
    }

    const existing = this.sourceFileIdsBySession.get(sessionId) ?? new Set<string>()
    sourceFileIds.forEach(sourceFileId => existing.add(sourceFileId))
    this.sourceFileIdsBySession.set(sessionId, existing)
  }

  private withSessionSourceFileIds(
    sessionId: string | undefined,
    commandName: BridgeCommandName,
    payload: JsonObject
  ): JsonObject {
    if (!sessionId || !shouldIncludeSourceFileIds(commandName, payload)) {
      return payload
    }

    return {
      ...payload,
      sourceFileIds: this.getSourceFileIds(sessionId),
    }
  }

  async invoke(
    toolName: string,
    rawArgs: JsonObject,
    sessionId: string | undefined,
    options: ToolExecutorInvokeOptions = {}
  ): Promise<ToolExecutionResult> {
    const tool = this.toolRegistry.get(toolName)
    if (!tool) {
      throw new Error(`${TOOL_NOT_FOUND_ERROR_PREFIX} ${toolName}`)
    }

    const requestId = nanoid()
    const selectedTabId = sessionId ? this.sessionStateStore.getSelectedTab(sessionId) : null
    const parsedArgs = tool.parseArgs(rawArgs)

    const sendCommand = async (
      commandName: BridgeCommandName,
      payload: JsonObject,
      options?: SendCommandOptions
    ): Promise<JsonObject> => {
      const commandPayload = this.withSessionSourceFileIds(sessionId, commandName, payload)
      const targetTabId = readPayloadNumber(commandPayload, 'tabId')
      if (sessionId && targetTabId !== null && isTabScopedCommand(commandName)) {
        this.tabLeaseManager.assertLeaseAvailable(sessionId, targetTabId)
      }

      const jobId = readPayloadString(commandPayload, 'jobId')
      if (sessionId && jobId && isJobScopedCommand(commandName)) {
        this.jobOwnershipStore.assertOwnership(sessionId, jobId)
      }

      const response = await this.sendBridgeCommand(commandName, commandPayload, options)

      if (sessionId && targetTabId !== null && isTabScopedCommand(commandName)) {
        this.tabLeaseManager.assignLease(sessionId, targetTabId)
      }

      if (sessionId) {
        const responseTabId = extractTabIdFromPayload(response)
        if (responseTabId !== null) {
          this.sessionStateStore.setSelectedTab(sessionId, responseTabId)
          if (RESPONSE_LEASE_COMMANDS.has(commandName)) {
            this.tabLeaseManager.assignLease(sessionId, responseTabId)
          }
        }

        if (commandName === 'ai_tool.start_scrape') {
          const responseJobId = extractJobIdFromPayload(response)
          if (responseJobId) {
            this.jobOwnershipStore.assignJob(sessionId, responseJobId)
          }
        }

        if (
          commandName === 'ai_tool.start_scrape' ||
          commandName === 'ai_tool.get_scrape_job_status'
        ) {
          const remoteFileId = extractRemoteFileIdFromScrapeResponse(response)
          if (remoteFileId) {
            this.recordSourceFileIds(sessionId, [remoteFileId])
          }
        }

        if (commandName === 'data_workbench.run_data_code') {
          this.recordSourceFileIds(sessionId, extractRunDataCodeOutputFileIds(response))
        }
      }

      return response
    }

    const response = await (async (): Promise<ToolExecutionResult> => {
      if (tool.execute) {
        return await tool.execute(parsedArgs, {
          ...(options.abortSignal ? { abortSignal: options.abortSignal } : {}),
          requestId,
          selectedTabId,
          sendCommand,
        })
      }

      if (tool.buildCommand) {
        const command = tool.buildCommand(parsedArgs, {
          ...(options.abortSignal ? { abortSignal: options.abortSignal } : {}),
          requestId,
          selectedTabId,
          sendCommand,
        })

        return await sendCommand(command.commandName, command.payload, {
          requestId: command.requestId,
          ...(command.timeoutMs ? { timeoutMs: command.timeoutMs } : {}),
        })
      }

      throw new Error(`Tool is misconfigured: ${toolName}`)
    })()

    if (isToolTextResult(response)) {
      return response
    }

    if (toolName === START_SCRAPE_TOOL_NAME) {
      const remoteFileId = extractRemoteFileIdFromScrapeResponse(response)
      if (remoteFileId) {
        this.recordSourceFileIds(sessionId, [remoteFileId])
      }
    }

    if (toolName === RUN_DATA_CODE_TOOL_NAME) {
      return normalizeRunDataCodeResponse(response)
    }

    return response
  }

  clearSession(sessionId: string | undefined): void {
    if (!sessionId) {
      return
    }

    this.sessionStateStore.clearSession(sessionId)
    this.tabLeaseManager.releaseLeaseBySession(sessionId)
    this.jobOwnershipStore.releaseSession(sessionId)
    this.sourceFileIdsBySession.delete(sessionId)
  }
}
