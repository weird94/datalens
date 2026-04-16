import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { stringify } from 'yaml'
import { BridgeCommandError } from '../bridge/command-router'
import type { JsonObject } from '../bridge/protocol'
import { logger } from '../obs/logger-metrics-trace'
import { isToolTextResult } from './tool-registry'
import { ToolExecutor } from './tool-executor'

function toTextResult(payload: JsonObject): { content: Array<{ type: 'text'; text: string }> } {
  const yamlText = (() => {
    try {
      return stringify(payload)
    } catch {
      return JSON.stringify(payload, null, 2)
    }
  })()

  return {
    content: [
      {
        type: 'text',
        text: yamlText,
      },
    ],
  }
}

function toPlainTextResult(text: string): { content: Array<{ type: 'text'; text: string }> } {
  return {
    content: [
      {
        type: 'text',
        text,
      },
    ],
  }
}

export class McpHandler {
  constructor(private readonly toolExecutor: ToolExecutor) {}

  createServer(): McpServer {
    const mcpServer = new McpServer({
      name: 'datalens-mcp-server',
      version: '0.1.0',
    })

    this.registerTools(mcpServer)

    return mcpServer
  }

  private registerTools(server: McpServer): void {
    this.toolExecutor.listTools().forEach(tool => {
      const inputSchema = tool.inputShape || {}

      server.registerTool(
        tool.name,
        {
          description: tool.description,
          inputSchema,
        },
        async (rawArgs: Record<string, unknown>, extra) => {
          try {
            const startedAt = Date.now()
            const response = await this.toolExecutor.invoke(
              tool.name,
              rawArgs as JsonObject,
              extra.sessionId
            )

            logger.info('Tool call completed', {
              requestId: 'mcp-tool-call',
              toolName: tool.name,
              latencyMs: Date.now() - startedAt,
            })

            if (isToolTextResult(response)) {
              return toPlainTextResult(response.text)
            }

            return toTextResult(response)
          } catch (error) {
            if (error instanceof BridgeCommandError) {
              logger.warn('Tool call failed', {
                requestId: 'mcp-tool-call',
                toolName: tool.name,
                errorCode: error.code,
              })

              return {
                isError: true,
                content: [
                  {
                    type: 'text' as const,
                    text: JSON.stringify(
                      {
                        code: error.code,
                        message: error.message,
                        retriable: error.retriable,
                      },
                      null,
                      2
                    ),
                  },
                ],
              }
            }

            const message = error instanceof Error ? error.message : String(error)

            logger.error('Tool call crashed', {
              requestId: 'mcp-tool-call',
              toolName: tool.name,
              errorCode: message,
            })

            return {
              isError: true,
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify(
                    {
                      code: 'INTERNAL_ERROR',
                      message,
                    },
                    null,
                    2
                  ),
                },
              ],
            }
          }
        }
      )
    })
  }
}
