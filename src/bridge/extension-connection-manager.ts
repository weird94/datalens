import { WebSocket } from 'ws'
import { logger } from '../obs/logger-metrics-trace'
import type { BridgeConnectionInfo, BridgeEnvelope } from './protocol'

type EnvelopeListener = (envelope: BridgeEnvelope) => void
export const BRIDGE_UNAVAILABLE_ERROR_MESSAGE = 'Bridge unavailable: extension not connected'

export class ExtensionConnectionManager {
  private socket: WebSocket | null = null
  private info: BridgeConnectionInfo | null = null
  private listeners = new Set<EnvelopeListener>()

  setConnection(socket: WebSocket, info: BridgeConnectionInfo): void {
    if (this.socket && this.socket !== socket) {
      this.socket.close()
    }

    this.socket = socket
    this.info = info

    logger.info('Bridge connection ready', {
      stateAfter: 'READY',
    })

    socket.on('close', () => {
      if (this.socket === socket) {
        this.socket = null
        this.info = null
        logger.warn('Bridge connection closed', {
          stateAfter: 'DISCONNECTED',
        })
      }
    })
  }

  hasConnection(): boolean {
    return this.socket !== null && this.socket.readyState === WebSocket.OPEN
  }

  getConnectionInfo(): BridgeConnectionInfo | null {
    return this.info
  }

  waitForConnection(timeoutMs: number = 60_000): Promise<void> {
    if (this.hasConnection()) {
      return Promise.resolve()
    }

    return new Promise<void>((resolve, reject) => {
      const startedAt = Date.now()
      const timer = setInterval(() => {
        if (this.hasConnection()) {
          clearInterval(timer)
          resolve()
          return
        }

        if (Date.now() - startedAt > timeoutMs) {
          clearInterval(timer)
          reject(new Error(BRIDGE_UNAVAILABLE_ERROR_MESSAGE))
        }
      }, 200)
    })
  }

  send(envelope: BridgeEnvelope): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error('Bridge disconnected')
    }

    this.socket.send(JSON.stringify(envelope))
  }

  onEnvelope(listener: EnvelopeListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  emitEnvelope(envelope: BridgeEnvelope): void {
    this.listeners.forEach(listener => {
      listener(envelope)
    })
  }
}
