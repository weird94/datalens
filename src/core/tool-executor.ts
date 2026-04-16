import { nanoid } from 'nanoid'
import type { BridgeCommandName, JsonObject } from '../bridge/protocol'
import { attachSuccessNextAction } from './next-action-hints'
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
  'browser.use_tab',
  'browser.close_tab',
  'scrape.detect_tables',
  'scrape.get_table_tree',
  'scrape.click_expand_and_redetect',
  'scrape.analyze_columns',
  'scrape.start',
])
const JOB_SCOPED_COMMANDS = new Set<BridgeCommandName>([
  'scrape.status',
  'scrape.pause',
  'scrape.resume',
  'scrape.stop',
  'scrape.result',
  'scrape.export',
])
const RESPONSE_LEASE_COMMANDS = new Set<BridgeCommandName>(['browser.open_tab', 'browser.use_tab'])

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
  return readPayloadString(payload, 'jobId')
}

export class ToolExecutor {
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

  async invoke(
    toolName: string,
    rawArgs: JsonObject,
    sessionId: string | undefined
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
      const targetTabId = readPayloadNumber(payload, 'tabId')
      if (sessionId && targetTabId !== null && isTabScopedCommand(commandName)) {
        this.tabLeaseManager.assertLeaseAvailable(sessionId, targetTabId)
      }

      const jobId = readPayloadString(payload, 'jobId')
      if (sessionId && jobId && isJobScopedCommand(commandName)) {
        this.jobOwnershipStore.assertOwnership(sessionId, jobId)
      }

      const response = await this.sendBridgeCommand(commandName, payload, options)

      if (sessionId && targetTabId !== null && isTabScopedCommand(commandName)) {
        if (commandName === 'browser.close_tab') {
          this.sessionStateStore.clearSelectedTabIfMatches(sessionId, targetTabId)
          this.tabLeaseManager.releaseLeaseByTab(targetTabId)
        } else {
          this.tabLeaseManager.assignLease(sessionId, targetTabId)
        }
      }

      if (sessionId) {
        const responseTabId = extractTabIdFromPayload(response)
        if (responseTabId !== null) {
          this.sessionStateStore.setSelectedTab(sessionId, responseTabId)
          if (RESPONSE_LEASE_COMMANDS.has(commandName)) {
            this.tabLeaseManager.assignLease(sessionId, responseTabId)
          }
        }

        if (commandName === 'scrape.start') {
          const responseJobId = extractJobIdFromPayload(response)
          if (responseJobId) {
            this.jobOwnershipStore.assignJob(sessionId, responseJobId)
          }
        }
      }

      return response
    }

    const response = await (async (): Promise<ToolExecutionResult> => {
      if (tool.execute) {
        return await tool.execute(parsedArgs, {
          requestId,
          selectedTabId,
          sendCommand,
        })
      }

      if (tool.buildCommand) {
        const command = tool.buildCommand(parsedArgs, {
          requestId,
          selectedTabId,
          sendCommand,
        })

        return await sendCommand(command.commandName, command.payload, {
          requestId: command.requestId,
        })
      }

      throw new Error(`Tool is misconfigured: ${toolName}`)
    })()

    if (isToolTextResult(response)) {
      return response
    }

    return attachSuccessNextAction(toolName, response)
  }

  clearSession(sessionId: string | undefined): void {
    if (!sessionId) {
      return
    }

    this.sessionStateStore.clearSession(sessionId)
    this.tabLeaseManager.releaseLeaseBySession(sessionId)
    this.jobOwnershipStore.releaseSession(sessionId)
  }
}
