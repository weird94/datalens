import { nanoid } from 'nanoid'
import { JobStore } from '../job/job-store'
import { logger } from '../obs/logger-metrics-trace'
import {
  BRIDGE_UNAVAILABLE_ERROR_MESSAGE,
  ExtensionConnectionManager,
} from './extension-connection-manager'
import { createEnvelope } from './protocol'
import type { BridgeCommandName, BridgeEnvelope, BridgeErrorPayload, JsonObject } from './protocol'

interface PendingCommand {
  resolve: (value: JsonObject) => void
  reject: (error: Error) => void
  timeout: NodeJS.Timeout
  commandName: BridgeCommandName
  createdAt: number
  requestId?: string
  jobId?: string
}

export class BridgeCommandError extends Error {
  readonly code: string
  readonly retriable: boolean

  constructor(payload: BridgeErrorPayload) {
    super(payload.message)
    this.name = 'BridgeCommandError'
    this.code = payload.code
    this.retriable = Boolean(payload.retriable)
  }
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export class CommandRouter {
  private pending = new Map<string, PendingCommand>()
  private disposeListener: (() => void) | null = null

  constructor(
    private readonly connectionManager: ExtensionConnectionManager,
    private readonly jobStore: JobStore
  ) {}

  start(): void {
    if (this.disposeListener) {
      return
    }

    this.disposeListener = this.connectionManager.onEnvelope(envelope => {
      this.handleEnvelope(envelope)
    })
  }

  stop(): void {
    if (this.disposeListener) {
      this.disposeListener()
      this.disposeListener = null
    }

    this.pending.forEach(pending => {
      clearTimeout(pending.timeout)
      pending.reject(new Error('Router stopped'))
      logger.warn('Bridge command cancelled because router stopped', {
        commandName: pending.commandName,
        ...(pending.requestId ? { requestId: pending.requestId } : {}),
        ...(pending.jobId ? { jobId: pending.jobId } : {}),
      })
    })

    this.pending.clear()
  }

  async sendCommand(
    name: BridgeCommandName,
    payload: JsonObject,
    options?: {
      requestId?: string
      jobId?: string
      timeoutMs?: number
    }
  ): Promise<JsonObject> {
    try {
      await this.connectionManager.waitForConnection(options?.timeoutMs)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)

      logger.warn('Bridge unavailable before command dispatch', {
        commandName: name,
        ...(options?.requestId ? { requestId: options.requestId } : {}),
        ...(options?.jobId ? { jobId: options.jobId } : {}),
        errorCode: errorMessage,
      })

      throw new Error(
        errorMessage === BRIDGE_UNAVAILABLE_ERROR_MESSAGE
          ? BRIDGE_UNAVAILABLE_ERROR_MESSAGE
          : errorMessage
      )
    }

    const id = nanoid()
    const timeoutMs = options?.timeoutMs || 60_000

    return await new Promise<JsonObject>((resolve, reject) => {
      const timeout = setTimeout(() => {
        const pending = this.pending.get(id)
        this.pending.delete(id)
        reject(new Error(`Bridge command timeout: ${name}`))
        logger.warn('Bridge command timeout', {
          commandName: name,
          ...(options?.requestId ? { requestId: options.requestId } : {}),
          ...(options?.jobId ? { jobId: options.jobId } : {}),
          ...(pending ? { latencyMs: Date.now() - pending.createdAt } : {}),
        })
      }, timeoutMs)

      this.pending.set(id, {
        resolve,
        reject,
        timeout,
        commandName: name,
        createdAt: Date.now(),
        ...(options?.requestId ? { requestId: options.requestId } : {}),
        ...(options?.jobId ? { jobId: options.jobId } : {}),
      })

      const envelope = createEnvelope({
        id,
        type: 'command',
        name,
        source: 'mcp-server',
        target: 'extension-bg',
        payload,
        ...(options?.requestId ? { requestId: options.requestId } : {}),
        ...(options?.jobId ? { jobId: options.jobId } : {}),
      })

      try {
        this.connectionManager.send(envelope)
        logger.info('Bridge command sent', {
          commandName: name,
          ...(options?.requestId ? { requestId: options.requestId } : {}),
          ...(options?.jobId ? { jobId: options.jobId } : {}),
        })
      } catch (error) {
        clearTimeout(timeout)
        this.pending.delete(id)
        logger.error('Bridge command send failed', {
          commandName: name,
          ...(options?.requestId ? { requestId: options.requestId } : {}),
          ...(options?.jobId ? { jobId: options.jobId } : {}),
          errorCode: 'SEND_FAILED',
        })
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  private handleEnvelope(envelope: BridgeEnvelope): void {
    if (envelope.type === 'progress' && envelope.name === 'scrape.progress') {
      this.handleProgressEnvelope(envelope)
      return
    }

    const pending = this.pending.get(envelope.id)
    if (!pending) {
      return
    }

    if (envelope.type === 'ack') {
      return
    }

    this.pending.delete(envelope.id)
    clearTimeout(pending.timeout)

    if (envelope.type === 'response') {
      pending.resolve(envelope.payload)
      logger.info('Bridge command completed', {
        commandName: pending.commandName,
        ...(pending.requestId ? { requestId: pending.requestId } : {}),
        ...(pending.jobId ? { jobId: pending.jobId } : {}),
        latencyMs: Date.now() - pending.createdAt,
      })
      return
    }

    if (envelope.type === 'error') {
      const bridgeError = new BridgeCommandError(envelope.payload as BridgeErrorPayload)
      pending.reject(bridgeError)
      logger.error('Bridge command failed', {
        commandName: pending.commandName,
        ...(pending.requestId ? { requestId: pending.requestId } : {}),
        ...(pending.jobId ? { jobId: pending.jobId } : {}),
        errorCode: bridgeError.code,
        latencyMs: Date.now() - pending.createdAt,
      })
      return
    }

    logger.warn('Bridge command received unexpected envelope type', {
      commandName: pending.commandName,
      ...(pending.requestId ? { requestId: pending.requestId } : {}),
      ...(pending.jobId ? { jobId: pending.jobId } : {}),
      stateAfter: envelope.type,
      latencyMs: Date.now() - pending.createdAt,
    })
    pending.reject(new Error(`Unexpected envelope type: ${envelope.type}`))
  }

  private handleProgressEnvelope(envelope: BridgeEnvelope): void {
    const payload = envelope.payload

    const jobId = payload.jobId
    const state = payload.state
    const progress = payload.progress

    if (typeof jobId !== 'string' || typeof state !== 'string' || !isJsonObject(progress)) {
      return
    }

    const hasProgressFields =
      typeof progress.mainCount === 'number' &&
      typeof progress.nestedCount === 'number' &&
      typeof progress.totalCount === 'number' &&
      typeof progress.step === 'string' &&
      typeof progress.updatedAt === 'string'

    if (!hasProgressFields) {
      return
    }

    const errorObject = isJsonObject(payload.error) ? payload.error : undefined
    const mainCount = progress.mainCount as number
    const nestedCount = progress.nestedCount as number
    const totalCount = progress.totalCount as number
    const step = progress.step as string
    const updatedAt = progress.updatedAt as string

    this.jobStore.updateFromProgress({
      jobId,
      state,
      progress: {
        mainCount,
        nestedCount,
        totalCount,
        step,
        updatedAt,
      },
      ...(errorObject && typeof errorObject.code === 'string' && typeof errorObject.message === 'string'
        ? {
            error: {
              code: errorObject.code,
              message: errorObject.message,
              ...(typeof errorObject.retriable === 'boolean'
                ? { retriable: errorObject.retriable }
                : {}),
            },
          }
        : {}),
      ...(typeof envelope.requestId === 'string' ? { requestId: envelope.requestId } : {}),
    })

    logger.info('Progress received', {
      ...(typeof envelope.requestId === 'string' ? { requestId: envelope.requestId } : {}),
      jobId,
      stateAfter: state,
      toolName: 'scrape.progress',
    })
  }
}
