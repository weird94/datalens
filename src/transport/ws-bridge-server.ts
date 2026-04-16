import { WebSocket, WebSocketServer } from 'ws'
import { BridgeAuthError, BridgeAuthService } from '../security/authn-authz'
import { logger } from '../obs/logger-metrics-trace'
import { ExtensionConnectionManager } from '../bridge/extension-connection-manager'
import { createEnvelope, parseEnvelope } from '../bridge/protocol'
import type {
  BridgeConnectionInfo,
  BridgeEnvelope,
  BridgeHelloPayload,
  JsonObject,
} from '../bridge/protocol'

interface WsBridgeServerOptions {
  host: string
  port: number
  path: string
}

function isBridgeHelloPayload(payload: JsonObject): payload is BridgeHelloPayload {
  return (
    typeof payload.extensionId === 'string' &&
    typeof payload.version === 'string' &&
    Array.isArray(payload.capabilities) &&
    payload.capabilities.every(item => typeof item === 'string') &&
    typeof payload.nonce === 'string'
  )
}

export class WsBridgeServer {
  private wss: WebSocketServer | null = null

  constructor(
    private readonly options: WsBridgeServerOptions,
    private readonly authService: BridgeAuthService,
    private readonly connectionManager: ExtensionConnectionManager
  ) {}

  async start(): Promise<void> {
    if (this.wss) {
      return
    }

    const wss = await new Promise<WebSocketServer>((resolve, reject) => {
      const nextServer = new WebSocketServer({
        host: this.options.host,
        port: this.options.port,
        path: this.options.path,
      })

      const handleListening = () => {
        nextServer.off('error', handleStartupError)
        resolve(nextServer)
      }

      const handleStartupError = (error: Error) => {
        nextServer.off('listening', handleListening)
        nextServer.close()
        reject(error)
      }

      nextServer.once('listening', handleListening)
      nextServer.once('error', handleStartupError)
      nextServer.on('connection', socket => {
        this.handleSocket(socket)
      })
    })

    this.wss = wss

    this.wss.on('error', error => {
      logger.error('WS bridge server error', {
        errorCode: error.message,
      })
    })

    logger.info('WS bridge server listening', {
      stateAfter: `ws://${this.options.host}:${this.options.port}${this.options.path}`,
    })
  }

  stop(): void {
    if (!this.wss) {
      return
    }

    this.wss.close()
    this.wss = null
  }

  private handleSocket(socket: WebSocket): void {
    let authenticated = false

    socket.on('message', raw => {
      const rawText = typeof raw === 'string' ? raw : raw.toString('utf8')
      const envelope = parseEnvelope(rawText)

      if (!envelope) {
        socket.close(1003, 'Invalid envelope')
        return
      }

      if (!authenticated) {
        const authenticatedNow = this.handleHandshake(socket, envelope)
        authenticated = authenticatedNow
        return
      }

      this.connectionManager.emitEnvelope(envelope)
    })

    socket.on('error', error => {
      logger.warn('WS socket error', {
        errorCode: error.message,
      })
    })
  }

  private handleHandshake(socket: WebSocket, envelope: BridgeEnvelope): boolean {
    if (envelope.type !== 'event' || envelope.name !== 'bridge.hello') {
      socket.close(1008, 'Handshake required')
      return false
    }

    if (!isBridgeHelloPayload(envelope.payload)) {
      socket.close(1008, 'Invalid hello payload')
      return false
    }

    try {
      this.authService.validateHello(envelope.payload)
    } catch (error) {
      if (error instanceof BridgeAuthError) {
        socket.close(1008, error.message)
        return false
      }

      socket.close(1011, 'Auth failed')
      return false
    }

    const info: BridgeConnectionInfo = {
      extensionId: envelope.payload.extensionId,
      version: envelope.payload.version,
      capabilities: envelope.payload.capabilities,
      connectedAt: new Date().toISOString(),
    }

    this.connectionManager.setConnection(socket, info)

    const ready = createEnvelope({
      id: envelope.id,
      type: 'event',
      name: 'bridge.ready',
      source: 'mcp-server',
      target: 'extension-bg',
      payload: {
        ok: true,
      },
    })

    socket.send(JSON.stringify(ready))

    logger.info('Bridge authenticated', {
      stateAfter: 'AUTHENTICATED',
    })

    return true
  }
}
