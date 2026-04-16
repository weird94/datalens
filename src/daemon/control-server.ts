import { createServer, type Server, type Socket } from 'node:net'
import type { JsonObject } from '../bridge/protocol'
import type { ToolExecutionResult } from '../core/tool-registry'
import {
  CONTROL_ERROR_CODE_INTERNAL_ERROR,
  CONTROL_ERROR_CODE_INVALID_REQUEST,
  ControlError,
  createCloseSessionResponse,
  createErrorResponse,
  createHealthResponse,
  createInvokeToolResponse,
  parseControlRequest,
} from './control-protocol'

interface ControlServerOptions {
  host: string
  port: number
}

interface ControlServerHandler {
  invokeTool: (
    toolName: string,
    args: JsonObject,
    sessionId: string
  ) => Promise<ToolExecutionResult>
  closeSession: (sessionId: string) => void
}

function writeJsonLine(socket: Socket, payload: object): void {
  socket.write(`${JSON.stringify(payload)}\n`)
}

export class ControlServer {
  private server: Server | null = null

  constructor(
    private readonly options: ControlServerOptions,
    private readonly handler: ControlServerHandler
  ) {}

  async start(): Promise<void> {
    if (this.server) {
      return
    }

    this.server = await new Promise<Server>((resolve, reject) => {
      const nextServer = createServer(socket => {
        this.handleConnection(socket)
      })

      nextServer.once('error', reject)
      nextServer.listen(this.options.port, this.options.host, () => {
        resolve(nextServer)
      })
    })
  }

  async stop(): Promise<void> {
    if (!this.server) {
      return
    }

    const activeServer = this.server
    this.server = null

    await new Promise<void>((resolve, reject) => {
      activeServer.close(error => {
        if (error) {
          reject(error)
          return
        }

        resolve()
      })
    })
  }

  private handleConnection(socket: Socket): void {
    let buffer = ''

    socket.on('data', chunk => {
      buffer += chunk.toString('utf8')
      const newlineIndex = buffer.indexOf('\n')
      if (newlineIndex === -1) {
        return
      }

      const requestLine = buffer.slice(0, newlineIndex)
      buffer = ''

      void this.handleRequest(socket, requestLine)
    })
  }

  private async handleRequest(socket: Socket, requestLine: string): Promise<void> {
    try {
      const request = parseControlRequest(requestLine)

      if (request.kind === 'health') {
        writeJsonLine(socket, createHealthResponse())
        socket.end()
        return
      }

      if (request.kind === 'invokeTool') {
        const payload = await this.handler.invokeTool(request.toolName, request.args, request.sessionId)
        writeJsonLine(socket, createInvokeToolResponse(payload))
        socket.end()
        return
      }

      this.handler.closeSession(request.sessionId)
      writeJsonLine(socket, createCloseSessionResponse())
      socket.end()
    } catch (error) {
      if (error instanceof ControlError) {
        writeJsonLine(
          socket,
          createErrorResponse({
            code: error.code,
            message: error.message,
            retriable: error.retriable,
          })
        )
        socket.end()
        return
      }

      if (error instanceof Error && error.name === 'ZodError') {
        writeJsonLine(
          socket,
          createErrorResponse({
            code: CONTROL_ERROR_CODE_INVALID_REQUEST,
            message: error.message,
            retriable: false,
          })
        )
        socket.end()
        return
      }

      writeJsonLine(
        socket,
        createErrorResponse({
          code: CONTROL_ERROR_CODE_INTERNAL_ERROR,
          message: error instanceof Error ? error.message : String(error),
          retriable: false,
        })
      )
      socket.end()
    }
  }
}
