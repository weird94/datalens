import { createServer, type Server, type Socket } from 'node:net'
import { nanoid } from 'nanoid'
import type { JsonObject } from '../bridge/protocol'
import type { ToolExecutionResult } from '../core/tool-registry'
import {
  CONTROL_ERROR_CODE_INTERNAL_ERROR,
  CONTROL_ERROR_CODE_INVALID_REQUEST,
  ControlError,
  createCancelSessionResponse,
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
    sessionId: string,
    abortSignal?: AbortSignal
  ) => Promise<ToolExecutionResult>
  closeSession: (sessionId: string) => void
}

function writeJsonLine(socket: Socket, payload: object): void {
  socket.write(`${JSON.stringify(payload)}\n`)
}

export class ControlServer {
  private server: Server | null = null
  private readonly activeInvocationAbortControllers = new Map<string, {
    abortController: AbortController
    sessionId: string
  }>()

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
    this.activeInvocationAbortControllers.forEach(activeInvocation => {
      activeInvocation.abortController.abort()
    })
    this.activeInvocationAbortControllers.clear()

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
        const abortController = new AbortController()
        const invocationId = request.invocationId ?? nanoid()
        this.activeInvocationAbortControllers.set(invocationId, {
          abortController,
          sessionId: request.sessionId,
        })

        try {
          const payload = await this.handler.invokeTool(
            request.toolName,
            request.args,
            request.sessionId,
            abortController.signal
          )
          writeJsonLine(socket, createInvokeToolResponse(payload))
        } finally {
          if (
            this.activeInvocationAbortControllers.get(invocationId)?.abortController ===
            abortController
          ) {
            this.activeInvocationAbortControllers.delete(invocationId)
          }
        }
        socket.end()
        return
      }

      if (request.kind === 'cancelSession') {
        if (request.invocationId) {
          this.activeInvocationAbortControllers
            .get(request.invocationId)
            ?.abortController.abort()
        } else {
          this.abortSessionInvocations(request.sessionId)
        }
        writeJsonLine(socket, createCancelSessionResponse())
        socket.end()
        return
      }

      if (request.kind === 'closeSession') {
        this.abortSessionInvocations(request.sessionId)
        this.handler.closeSession(request.sessionId)
        writeJsonLine(socket, createCloseSessionResponse())
        socket.end()
        return
      }

      writeJsonLine(
        socket,
        createErrorResponse({
          code: CONTROL_ERROR_CODE_INVALID_REQUEST,
          message: 'Unsupported control request kind',
          retriable: false,
        })
      )
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

  private abortSessionInvocations(sessionId: string): void {
    this.activeInvocationAbortControllers.forEach((activeInvocation, invocationId) => {
      if (activeInvocation.sessionId !== sessionId) {
        return
      }

      activeInvocation.abortController.abort()
      this.activeInvocationAbortControllers.delete(invocationId)
    })
  }
}
