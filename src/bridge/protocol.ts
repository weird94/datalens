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
  | 'browser.open_tab'
  | 'browser.list_tabs'
  | 'browser.use_tab'
  | 'browser.close_tab'
  | 'debug.get_logs'
  | 'debug.clear_logs'
  | 'scrape.detect_tables'
  | 'scrape.get_table_tree'
  | 'scrape.click_expand_and_redetect'
  | 'scrape.analyze_columns'
  | 'scrape.start'
  | 'scrape.status'
  | 'scrape.pause'
  | 'scrape.resume'
  | 'scrape.stop'
  | 'scrape.result'
  | 'scrape.export'

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
