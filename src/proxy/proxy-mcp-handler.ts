import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { stringify } from 'yaml'
import type { JsonObject } from '../bridge/protocol'
import { ControlError } from '../daemon/control-protocol'
import {
  isToolTextResult,
  type ToolExecutionResult,
  ToolRegistry,
} from '../core/tool-registry'

interface ProxyInvoker {
  invokeTool: (sessionId: string, toolName: string, args: JsonObject) => Promise<ToolExecutionResult>
}

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

export class ProxyMcpHandler {
  constructor(
    private readonly toolRegistry: ToolRegistry,
    private readonly proxyInvoker: ProxyInvoker,
    private readonly sessionId: string
  ) {}

  async invoke(toolName: string, rawArgs: JsonObject): Promise<ToolExecutionResult> {
    return await this.proxyInvoker.invokeTool(this.sessionId, toolName, rawArgs)
  }

  createServer(): McpServer {
    const mcpServer = new McpServer({
      name: 'datalens-mcp-proxy',
      version: '0.1.0',
    })

    this.toolRegistry.list().forEach(tool => {
      mcpServer.registerTool(
        tool.name,
        {
          description: tool.description,
          inputSchema: tool.inputShape,
        },
        async rawArgs => {
          try {
            const response = await this.invoke(tool.name, rawArgs as JsonObject)
            if (isToolTextResult(response)) {
              return toPlainTextResult(response.text)
            }

            return toTextResult(response)
          } catch (error) {
            if (error instanceof ControlError) {
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

    return mcpServer
  }
}
