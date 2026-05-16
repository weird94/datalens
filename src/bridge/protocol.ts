export type JsonValue = unknown

export interface JsonObject {
  [key: string]: unknown
}

export type BridgeMessageType = 'command' | 'ack' | 'progress' | 'response' | 'error' | 'event'

export type BridgeSource = 'mcp-server' | 'extension-bg'

export type BridgeTarget = 'extension-bg' | 'mcp-server'

export interface BridgeEnvelope<TPayload extends JsonObject = JsonObject> {
  id: string
  type: BridgeMessageType
  name: string
  source: BridgeSource
  target: BridgeTarget
  timestamp: string
  jobId?: string
  requestId?: string
  payload: TPayload
}

export type BridgeCommandName =
  | 'ai_tool.open_workspace_tab'
  | 'ai_tool.read_page_a11y_tree'
  | 'ai_tool.read_page_ref_pug'
  | 'ai_tool.operate_page'
  | 'ai_tool.detect_scrape_targets'
  | 'ai_tool.analyze_scrape_config'
  | 'ai_tool.apply_drill_down_scrape'
  | 'ai_tool.start_scrape'
  | 'ai_tool.get_scrape_job_status'
  | 'ai_tool.stop_scrape'
  | 'data_workbench.list_workspace_assets'
  | 'data_workbench.inspect_workspace_asset'
  | 'data_workbench.run_data_code'
  | 'debug.start_run'
  | 'debug.get_logs'
  | 'debug.clear_logs'
  | 'debug.get_run_diagnostics'

export interface BridgeErrorPayload extends JsonObject {
  code: string
  message: string
  retriable?: boolean
  detail?: JsonValue
}

export interface BridgeHelloPayload extends JsonObject {
  extensionId: string
  version: string
  capabilities: string[]
  nonce: string
  token?: string
}

export interface BridgeConnectionInfo {
  extensionId: string
  version: string
  capabilities: string[]
  connectedAt: string
}

export function createEnvelope<TPayload extends JsonObject>(input: {
  id: string
  type: BridgeMessageType
  name: string
  source: BridgeSource
  target: BridgeTarget
  requestId?: string
  jobId?: string
  payload: TPayload
}): BridgeEnvelope<TPayload> {
  return {
    id: input.id,
    type: input.type,
    name: input.name,
    source: input.source,
    target: input.target,
    timestamp: new Date().toISOString(),
    ...(input.requestId ? { requestId: input.requestId } : {}),
    ...(input.jobId ? { jobId: input.jobId } : {}),
    payload: input.payload,
  }
}

export function parseEnvelope(raw: string): BridgeEnvelope | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>

    if (
      typeof parsed.id !== 'string' ||
      typeof parsed.type !== 'string' ||
      typeof parsed.name !== 'string'
    ) {
      return null
    }

    if (
      typeof parsed.payload !== 'object' ||
      parsed.payload === null ||
      Array.isArray(parsed.payload)
    ) {
      return null
    }

    return {
      id: parsed.id,
      type: parsed.type as BridgeMessageType,
      name: parsed.name,
      source: parsed.source === 'extension-bg' ? 'extension-bg' : 'mcp-server',
      target: parsed.target === 'mcp-server' ? 'mcp-server' : 'extension-bg',
      timestamp: typeof parsed.timestamp === 'string' ? parsed.timestamp : new Date().toISOString(),
      ...(typeof parsed.jobId === 'string' ? { jobId: parsed.jobId } : {}),
      ...(typeof parsed.requestId === 'string' ? { requestId: parsed.requestId } : {}),
      payload: parsed.payload as JsonObject,
    }
  } catch {
    return null
  }
}
