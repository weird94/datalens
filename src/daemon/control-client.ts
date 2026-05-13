import { createConnection } from 'node:net'
import { nanoid } from 'nanoid'
import type { JsonObject } from '../bridge/protocol'
import type { ToolExecutionResult } from '../core/tool-registry'
import {
  CONTROL_REQUEST_KIND_CLOSE_SESSION,
  CONTROL_REQUEST_KIND_CANCEL_SESSION,
  CONTROL_REQUEST_KIND_HEALTH,
  CONTROL_REQUEST_KIND_INVOKE_TOOL,
  CONTROL_RESPONSE_STATUS_ERROR,
  ControlError,
  parseControlResponse,
} from './control-protocol'

interface ControlClientOptions {
  host: string
  port: number
}

interface InvokeToolOptions {
  invocationId?: string
}

interface CancelSessionOptions {
  invocationId?: string
}

function toJsonLine(payload: object): string {
  return `${JSON.stringify(payload)}\n`
}

export class ControlClient {
  constructor(private readonly options: ControlClientOptions) {}

  async health(): Promise<{ status: 'ok' }> {
    const response = await this.request({
      kind: CONTROL_REQUEST_KIND_HEALTH,
    })

    if (response.status === CONTROL_RESPONSE_STATUS_ERROR) {
      throw new ControlError(response.error.code, response.error.message, response.error.retriable)
    }

    if (response.kind !== CONTROL_REQUEST_KIND_HEALTH) {
      throw new Error(`Unexpected control response kind: ${response.kind}`)
    }

    return response.payload
  }

  async invokeTool(
    sessionId: string,
    toolName: string,
    args: JsonObject,
    options: InvokeToolOptions = {}
  ): Promise<ToolExecutionResult> {
    const response = await this.request({
      kind: CONTROL_REQUEST_KIND_INVOKE_TOOL,
      sessionId,
      invocationId: options.invocationId ?? nanoid(),
      toolName,
      args,
    })

    if (response.status === CONTROL_RESPONSE_STATUS_ERROR) {
      throw new ControlError(response.error.code, response.error.message, response.error.retriable)
    }

    if (response.kind !== CONTROL_REQUEST_KIND_INVOKE_TOOL) {
      throw new Error(`Unexpected control response kind: ${response.kind}`)
    }

    return response.payload
  }

  async closeSession(sessionId: string): Promise<void> {
    const response = await this.request({
      kind: CONTROL_REQUEST_KIND_CLOSE_SESSION,
      sessionId,
    })

    if (response.status === CONTROL_RESPONSE_STATUS_ERROR) {
      throw new ControlError(response.error.code, response.error.message, response.error.retriable)
    }

    if (response.kind !== CONTROL_REQUEST_KIND_CLOSE_SESSION) {
      throw new Error(`Unexpected control response kind: ${response.kind}`)
    }
  }

  async cancelSession(sessionId: string, options: CancelSessionOptions = {}): Promise<void> {
    const response = await this.request({
      kind: CONTROL_REQUEST_KIND_CANCEL_SESSION,
      sessionId,
      ...(options.invocationId ? { invocationId: options.invocationId } : {}),
    })

    if (response.status === CONTROL_RESPONSE_STATUS_ERROR) {
      throw new ControlError(response.error.code, response.error.message, response.error.retriable)
    }

    if (response.kind !== CONTROL_REQUEST_KIND_CANCEL_SESSION) {
      throw new Error(`Unexpected control response kind: ${response.kind}`)
    }
  }

  private async request(payload: object) {
    return await new Promise<ReturnType<typeof parseControlResponse>>((resolve, reject) => {
      const socket = createConnection(this.options.port, this.options.host)
      let buffer = ''

      socket.once('error', reject)
      socket.on('data', chunk => {
        buffer += chunk.toString('utf8')
        const newlineIndex = buffer.indexOf('\n')
        if (newlineIndex === -1) {
          return
        }

        const line = buffer.slice(0, newlineIndex)
        try {
          resolve(parseControlResponse(line))
        } catch (error) {
          reject(error)
        } finally {
          socket.end()
        }
      })
      socket.on('connect', () => {
        socket.write(toJsonLine(payload))
      })
    })
  }
}
